//! The encrypted local recording: one init segment, numbered media segments and an index. Every
//! file is sealed with XChaCha20-Poly1305 under the recording key, with a random nonce and the
//! recording ID and the file's role as associated data, so a file cannot be swapped, reordered or
//! moved into another recording. Writes go to a temporary file and are renamed, so a crash never
//! leaves a half-written file behind.

use std::fs;
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};

const NONCE_BYTES: usize = 24;
const AAD_PREFIX: &[u8] = b"prctr-recording-v1\0";
const INDEX: &str = "index.seal";
const INIT: &str = "init.seal";

/// Why a span of the timeline has no video.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GapReason {
    /// The machine slept, or the screen was locked or switched away.
    Interruption,
    /// The agent or the app restarted, or the candidate re-entered.
    Restart,
    /// Capture or encoding failed, or the disk ran out of space.
    Failure,
}

/// A span with no video, in unix ms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gap {
    pub start_ms: u64,
    pub end_ms: u64,
    pub reason: GapReason,
}

/// One media segment: a fragment that starts with a keyframe.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub number: u64,
    /// Wall-clock span, unix ms.
    pub start_ms: u64,
    pub end_ms: u64,
    /// Start on the media timeline (ms since the recording began).
    pub decode_ms: u64,
    pub bytes: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    origin_ms: u64,
    segments: Vec<Segment>,
    gaps: Vec<Gap>,
}

#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    /// A file failed authentication: a wrong key, or tampering.
    Sealed,
    /// The OS random source is unavailable.
    Random,
    Corrupt,
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for StoreError {}

pub struct Store {
    dir: PathBuf,
    recording_id: String,
    cipher: XChaCha20Poly1305,
    index: Index,
}

impl Store {
    /// Opens the recording in `dir`, or creates it at `now_ms`. Reopening an existing recording
    /// records a restart gap from its last segment to `now_ms`. Returns whether it was resumed.
    ///
    /// # Errors
    /// When the directory cannot be used, or an existing index does not open with `key`.
    pub fn open(
        dir: &Path,
        recording_id: &str,
        key: &[u8; 32],
        now_ms: u64,
    ) -> Result<(Self, bool), StoreError> {
        fs::create_dir_all(dir)?;
        let mut store = Self {
            dir: dir.to_path_buf(),
            recording_id: recording_id.to_owned(),
            cipher: XChaCha20Poly1305::new(key.into()),
            index: Index {
                origin_ms: now_ms,
                ..Index::default()
            },
        };
        let resumed = store.dir.join(INDEX).exists();
        if resumed {
            let bytes = store.unseal(INDEX, "index")?;
            store.index = serde_json::from_slice(&bytes).map_err(|_| StoreError::Corrupt)?;
            let since = store
                .index
                .segments
                .last()
                .map_or(store.index.origin_ms, |segment| segment.end_ms);
            if now_ms > since {
                store.index.gaps.push(Gap {
                    start_ms: since,
                    end_ms: now_ms,
                    reason: GapReason::Restart,
                });
            }
        }
        store.write_index()?;
        Ok((store, resumed))
    }

    fn aad(&self, role: &str) -> Vec<u8> {
        [
            AAD_PREFIX,
            self.recording_id.as_bytes(),
            b"\0",
            role.as_bytes(),
        ]
        .concat()
    }

    fn seal(&self, name: &str, role: &str, plaintext: &[u8]) -> Result<u64, StoreError> {
        let mut nonce = [0_u8; NONCE_BYTES];
        if !prctr_os::random_bytes(&mut nonce) {
            return Err(StoreError::Random);
        }
        let aad = self.aad(role);
        let sealed = self
            .cipher
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| StoreError::Sealed)?;
        let temporary = self.dir.join(format!("{name}.tmp"));
        fs::write(&temporary, [nonce.as_slice(), &sealed].concat())?;
        fs::rename(&temporary, self.dir.join(name))?;
        Ok(u64::try_from(NONCE_BYTES + sealed.len()).unwrap_or(u64::MAX))
    }

    fn unseal(&self, name: &str, role: &str) -> Result<Vec<u8>, StoreError> {
        let bytes = fs::read(self.dir.join(name))?;
        if bytes.len() < NONCE_BYTES {
            return Err(StoreError::Corrupt);
        }
        let (nonce, sealed) = bytes.split_at(NONCE_BYTES);
        let aad = self.aad(role);
        self.cipher
            .decrypt(
                &XNonce::try_from(nonce).map_err(|_| StoreError::Corrupt)?,
                Payload {
                    msg: sealed,
                    aad: &aad,
                },
            )
            .map_err(|_| StoreError::Sealed)
    }

    fn write_index(&self) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec(&self.index).map_err(|_| StoreError::Corrupt)?;
        self.seal(INDEX, "index", &bytes).map(|_| ())
    }

    fn segment_name(number: u64) -> String {
        format!("{number:010}.seal")
    }

    /// Stores the init segment once; later calls keep the first, because keyframes carry their
    /// parameters in-band.
    ///
    /// # Errors
    /// When the file cannot be written.
    pub fn set_init(&self, init: &[u8]) -> Result<(), StoreError> {
        if self.dir.join(INIT).exists() {
            return Ok(());
        }
        self.seal(INIT, "init", init).map(|_| ())
    }

    /// # Errors
    /// When the init segment is missing or fails authentication.
    pub fn init(&self) -> Result<Vec<u8>, StoreError> {
        self.unseal(INIT, "init")
    }

    /// The media-timeline start for a segment beginning at `start_ms`: its wall-clock offset from
    /// the recording's start, never earlier than the end of the previous segment.
    #[must_use]
    pub fn decode_ms(&self, start_ms: u64) -> u64 {
        let wall = start_ms.saturating_sub(self.index.origin_ms);
        let previous = self.index.segments.last().map_or(0, |segment| {
            segment.decode_ms + (segment.end_ms - segment.start_ms)
        });
        wall.max(previous)
    }

    /// Appends one sealed segment and records it in the index.
    ///
    /// # Errors
    /// When the segment or the index cannot be written.
    pub fn append(
        &mut self,
        start_ms: u64,
        end_ms: u64,
        decode_ms: u64,
        fragment: &[u8],
    ) -> Result<Segment, StoreError> {
        let number = self
            .index
            .segments
            .last()
            .map_or(0, |segment| segment.number + 1);
        let bytes = self.seal(
            &Self::segment_name(number),
            &format!("segment:{number}"),
            fragment,
        )?;
        let segment = Segment {
            number,
            start_ms,
            end_ms: end_ms.max(start_ms),
            decode_ms,
            bytes,
        };
        self.index.segments.push(segment);
        self.write_index()?;
        Ok(segment)
    }

    /// # Errors
    /// When the segment is missing or fails authentication.
    pub fn segment(&self, segment: &Segment) -> Result<Vec<u8>, StoreError> {
        self.unseal(
            &Self::segment_name(segment.number),
            &format!("segment:{}", segment.number),
        )
    }

    /// Records a span with no video.
    ///
    /// # Errors
    /// When the index cannot be written.
    pub fn add_gap(&mut self, gap: Gap) -> Result<(), StoreError> {
        if gap.end_ms > gap.start_ms {
            self.index.gaps.push(gap);
            self.write_index()?;
        }
        Ok(())
    }

    #[must_use]
    pub fn segments(&self) -> &[Segment] {
        &self.index.segments
    }

    #[must_use]
    pub fn gaps(&self) -> &[Gap] {
        &self.index.gaps
    }

    /// When the recording began, unix ms.
    #[must_use]
    pub const fn origin_ms(&self) -> u64 {
        self.index.origin_ms
    }

    /// Bytes the recording uses on disk.
    #[must_use]
    pub fn bytes(&self) -> u64 {
        self.index
            .segments
            .iter()
            .map(|segment| segment.bytes)
            .sum()
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Deletes the whole recording.
    ///
    /// # Errors
    /// When the directory cannot be removed.
    pub fn delete(self) -> Result<(), StoreError> {
        fs::remove_dir_all(&self.dir).map_err(StoreError::from)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn temporary(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("prctr-recorder-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    const KEY: [u8; 32] = [7; 32];

    #[test]
    fn segments_round_trip_and_survive_a_reopen_with_a_restart_gap() {
        let dir = temporary("reopen");
        let (mut store, resumed) = Store::open(&dir, "rec1", &KEY, 1_000).expect("creates");
        assert!(!resumed);
        store.set_init(b"init").expect("init");
        let decode = store.decode_ms(1_000);
        store
            .append(1_000, 3_000, decode, b"first")
            .expect("appends");
        drop(store);
        let (store, resumed) = Store::open(&dir, "rec1", &KEY, 10_000).expect("reopens");
        assert!(resumed);
        assert_eq!(store.init().expect("init"), b"init");
        assert_eq!(
            store.segment(&store.segments()[0]).expect("reads"),
            b"first"
        );
        assert_eq!(
            store.gaps(),
            &[Gap {
                start_ms: 3_000,
                end_ms: 10_000,
                reason: GapReason::Restart
            }]
        );
        assert_eq!(
            store.decode_ms(10_000),
            9_000,
            "the media timeline keeps the gap"
        );
        store.delete().expect("deletes");
        assert!(!dir.exists());
    }

    #[test]
    fn a_wrong_key_a_tampered_file_or_a_moved_segment_is_refused() {
        let dir = temporary("tamper");
        let (mut store, _) = Store::open(&dir, "rec1", &KEY, 0).expect("creates");
        store.append(0, 2_000, 0, b"zero").expect("appends");
        store.append(2_000, 4_000, 2_000, b"one").expect("appends");
        let segments = store.segments().to_vec();
        drop(store);
        assert!(matches!(
            Store::open(&dir, "rec1", &[8; 32], 0),
            Err(StoreError::Sealed)
        ));
        assert!(
            matches!(Store::open(&dir, "rec2", &KEY, 0), Err(StoreError::Sealed)),
            "another recording"
        );
        fs::copy(dir.join("0000000000.seal"), dir.join("0000000001.seal")).expect("swaps");
        let (store, _) = Store::open(&dir, "rec1", &KEY, 0).expect("index still opens");
        assert!(
            matches!(store.segment(&segments[1]), Err(StoreError::Sealed)),
            "a moved segment"
        );
        let mut bytes = fs::read(dir.join("0000000000.seal")).expect("reads");
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(dir.join("0000000000.seal"), bytes).expect("tampers");
        assert!(matches!(
            store.segment(&segments[0]),
            Err(StoreError::Sealed)
        ));
        store.delete().expect("deletes");
    }

    #[test]
    fn a_wall_clock_set_back_never_moves_the_media_timeline_back() {
        let dir = temporary("clock");
        let (mut store, _) = Store::open(&dir, "rec1", &KEY, 10_000).expect("creates");
        store.append(10_000, 12_000, 0, b"a").expect("appends");
        assert_eq!(store.decode_ms(5_000), 2_000);
        store.delete().expect("deletes");
    }
}
