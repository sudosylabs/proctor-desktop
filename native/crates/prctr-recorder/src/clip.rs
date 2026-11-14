//! Cutting a clip: the init segment and the media segments overlapping the requested range, written
//! without re-encoding as one MP4. The file is stored as consecutive records, one per upload chunk,
//! each sealed with ChaCha20-Poly1305 under a fresh clip key with the chunk index as nonce, so
//! Electron main can decrypt and upload chunk by chunk with `node:crypto`.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use sha2::{Digest, Sha256};

use crate::store::{Gap, GapReason, Store, StoreError};

pub const MEDIA_TYPE: &str = "video/mp4";
/// The server's upload chunk size; every chunk but the last is exactly this long.
pub const CHUNK_BYTES: usize = 8_388_608;
pub const MAX_CHUNKS: usize = 384;
pub const MAX_CLIP_BYTES: u64 = 3 * 1024 * 1024 * 1024;
/// Associated data of every clip record.
pub const CLIP_AAD: &[u8] = b"proctor-screen-clip-v1";
/// Consecutive segments further apart than this, with no recorded gap, are a gap too.
const HOLE_MS: u64 = 1_000;

/// The range the server asked for, unix ms. `from_session_start` replaces `start_ms`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClipRange {
    pub from_session_start: bool,
    pub start_ms: Option<u64>,
    pub end_ms: u64,
}

/// A finished clip, ready to upload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClipManifest {
    pub path: PathBuf,
    pub key: [u8; 32],
    pub size_bytes: u64,
    /// SHA-256 of each plaintext chunk, in order.
    pub chunk_sha256: Vec<[u8; 32]>,
    pub content_digest: [u8; 32],
    /// The range actually covered, rounded out to segment boundaries.
    pub start_ms: u64,
    pub end_ms: u64,
    pub gaps: Vec<Gap>,
}

#[derive(Debug)]
pub enum ClipError {
    InvalidRange,
    /// Nothing was recorded in the range.
    Empty,
    TooLarge,
    Random,
    Store(StoreError),
}

impl From<StoreError> for ClipError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<std::io::Error> for ClipError {
    fn from(error: std::io::Error) -> Self {
        Self::Store(StoreError::Io(error))
    }
}

/// The server's `content_digest`: SHA-256 of `"proctor-screen-clip-v1\n" + media_type + "\n" +
/// size + "\n" + chunk size + "\n"`, then each chunk hash in lowercase hex followed by `"\n"`.
#[must_use]
pub fn content_digest(
    media_type: &str,
    size_bytes: u64,
    chunk_bytes: usize,
    chunks: &[[u8; 32]],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "proctor-screen-clip-v1\n{media_type}\n{size_bytes}\n{chunk_bytes}\n"
    ));
    for chunk in chunks {
        hasher.update(hex(chunk));
        hasher.update(b"\n");
    }
    hasher.finalize().into()
}

/// Lowercase hex.
#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// The nonce of record `index`: four zero bytes, then the index big-endian.
#[must_use]
pub fn record_nonce(index: u64) -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    nonce[4..].copy_from_slice(&index.to_be_bytes());
    nonce
}

struct Records {
    file: File,
    cipher: ChaCha20Poly1305,
    chunk_bytes: usize,
    pending: Vec<u8>,
    hashes: Vec<[u8; 32]>,
    size: u64,
}

impl Records {
    fn push(&mut self, mut bytes: &[u8]) -> Result<(), ClipError> {
        while !bytes.is_empty() {
            let take = (self.chunk_bytes - self.pending.len()).min(bytes.len());
            self.pending.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
            if self.pending.len() == self.chunk_bytes {
                self.seal()?;
            }
        }
        Ok(())
    }

    fn seal(&mut self) -> Result<(), ClipError> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.size += u64::try_from(self.pending.len()).unwrap_or(u64::MAX);
        if self.size > MAX_CLIP_BYTES || self.hashes.len() >= MAX_CHUNKS {
            return Err(ClipError::TooLarge);
        }
        self.hashes.push(Sha256::digest(&self.pending).into());
        let index = u64::try_from(self.hashes.len() - 1).unwrap_or(u64::MAX);
        let sealed = self
            .cipher
            .encrypt(
                &Nonce::from(record_nonce(index)),
                Payload {
                    msg: &self.pending,
                    aad: CLIP_AAD,
                },
            )
            .map_err(|_| ClipError::Random)?;
        self.file.write_all(&sealed)?;
        self.pending.clear();
        Ok(())
    }
}

fn gaps_within(
    store: &Store,
    start_ms: u64,
    end_ms: u64,
    segments: &[crate::store::Segment],
) -> Vec<Gap> {
    let mut gaps: Vec<Gap> = store
        .gaps()
        .iter()
        .filter(|gap| gap.end_ms > start_ms && gap.start_ms < end_ms)
        .map(|gap| Gap {
            start_ms: gap.start_ms.max(start_ms),
            end_ms: gap.end_ms.min(end_ms),
            reason: gap.reason,
        })
        .collect();
    for pair in segments.windows(2) {
        let (before, after) = (pair[0], pair[1]);
        let covered = gaps
            .iter()
            .any(|gap| gap.start_ms <= before.end_ms && gap.end_ms >= after.start_ms);
        if after.start_ms > before.end_ms + HOLE_MS && !covered {
            gaps.push(Gap {
                start_ms: before.end_ms,
                end_ms: after.start_ms,
                reason: GapReason::Failure,
            });
        }
    }
    gaps.sort_by_key(|gap| gap.start_ms);
    gaps
}

/// Cuts `range` from `store` into a sealed clip at `path` with a fresh key. `chunk_bytes` is
/// [`CHUNK_BYTES`] outside tests.
///
/// # Errors
/// On an invalid or empty range, a clip beyond the server's bounds, or a store failure. A partial
/// file is removed.
pub fn cut(
    store: &Store,
    range: &ClipRange,
    path: &Path,
    chunk_bytes: usize,
) -> Result<ClipManifest, ClipError> {
    let start_ms = if range.from_session_start {
        store.origin_ms()
    } else {
        range.start_ms.ok_or(ClipError::InvalidRange)?
    };
    if range.end_ms <= start_ms || chunk_bytes == 0 {
        return Err(ClipError::InvalidRange);
    }
    let segments: Vec<_> = store
        .segments()
        .iter()
        .copied()
        .filter(|segment| segment.end_ms > start_ms && segment.start_ms < range.end_ms)
        .collect();
    let (Some(first), Some(last)) = (segments.first(), segments.last()) else {
        return Err(ClipError::Empty);
    };
    let mut key = [0_u8; 32];
    if !prctr_os::random_bytes(&mut key) {
        return Err(ClipError::Random);
    }
    let result = (|| {
        let mut records = Records {
            file: File::create(path)?,
            cipher: ChaCha20Poly1305::new((&key).into()),
            chunk_bytes,
            pending: Vec::with_capacity(chunk_bytes.min(CHUNK_BYTES)),
            hashes: Vec::new(),
            size: 0,
        };
        records.push(&store.init()?)?;
        for segment in &segments {
            records.push(&store.segment(segment)?)?;
        }
        records.seal()?;
        records.file.sync_all()?;
        Ok::<_, ClipError>((records.size, records.hashes))
    })();
    let (size_bytes, chunk_sha256) = match result {
        Ok(done) => done,
        Err(error) => {
            let _ = fs::remove_file(path);
            return Err(error);
        }
    };
    Ok(ClipManifest {
        path: path.to_path_buf(),
        key,
        size_bytes,
        content_digest: content_digest(MEDIA_TYPE, size_bytes, chunk_bytes, &chunk_sha256),
        chunk_sha256,
        start_ms: first.start_ms,
        end_ms: last.end_ms,
        gaps: gaps_within(store, first.start_ms, last.end_ms, &segments),
    })
}

/// Decrypts a clip file back to its MP4 bytes; the uploader does the same chunk by chunk.
///
/// # Errors
/// When a record fails authentication or the file cannot be read.
pub fn open(manifest: &ClipManifest, chunk_bytes: usize) -> Result<Vec<u8>, ClipError> {
    let sealed = fs::read(&manifest.path)?;
    let cipher = ChaCha20Poly1305::new((&manifest.key).into());
    let mut plain = Vec::new();
    for (index, record) in sealed.chunks(chunk_bytes + 16).enumerate() {
        let nonce = record_nonce(u64::try_from(index).unwrap_or(u64::MAX));
        let chunk = cipher
            .decrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: record,
                    aad: CLIP_AAD,
                },
            )
            .map_err(|_| ClipError::Store(StoreError::Sealed))?;
        plain.extend_from_slice(&chunk);
    }
    Ok(plain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::{EncodedSample, StreamFormat};
    use crate::mp4::{self, walker};
    use crate::store::tests::temporary;

    fn recording(name: &str) -> Store {
        let format = StreamFormat {
            width: 64,
            height: 32,
            sps: vec![0x67, 0x42, 0, 0x1E],
            pps: vec![0x68, 0xCE],
        };
        let (mut store, _) =
            Store::open(&temporary(name), "rec1", &[3; 32], 1_000).expect("creates");
        store.set_init(&mp4::init_segment(&format)).expect("init");
        for (index, start) in [1_000_u64, 3_000, 5_000, 11_000].into_iter().enumerate() {
            let samples = vec![
                EncodedSample {
                    data: vec![0, 0, 0, 1, 0x65],
                    keyframe: true
                };
                10
            ];
            let decode = store.decode_ms(start);
            let fragment = mp4::fragment(
                u32::try_from(index).expect("small") + 1,
                decode,
                200,
                &samples,
            );
            store
                .append(start, start + 2_000, decode, &fragment)
                .expect("appends");
        }
        store
            .add_gap(Gap {
                start_ms: 7_000,
                end_ms: 9_000,
                reason: GapReason::Interruption,
            })
            .expect("gap");
        store
    }

    #[test]
    fn a_clip_rounds_out_to_segments_and_is_one_valid_mp4() {
        let store = recording("clip-round");
        let path = store.dir().join("clip.seal");
        let range = ClipRange {
            from_session_start: false,
            start_ms: Some(3_500),
            end_ms: 5_100,
        };
        let manifest = cut(&store, &range, &path, CHUNK_BYTES).expect("cuts");
        assert_eq!((manifest.start_ms, manifest.end_ms), (3_000, 7_000));
        let mp4 = open(&manifest, CHUNK_BYTES).expect("opens");
        let kinds: Vec<_> = walker::boxes(&mp4).iter().map(|found| found.kind).collect();
        assert_eq!(
            kinds,
            vec![*b"ftyp", *b"moov", *b"moof", *b"mdat", *b"moof", *b"mdat"]
        );
        assert_eq!(manifest.size_bytes, mp4.len() as u64);
        assert_eq!(
            manifest.chunk_sha256,
            vec![<[u8; 32]>::from(Sha256::digest(&mp4))]
        );
        store.delete().expect("deletes");
    }

    #[test]
    fn from_session_start_reports_recorded_gaps_and_unrecorded_holes() {
        let store = recording("clip-gaps");
        let path = store.dir().join("clip.seal");
        let range = ClipRange {
            from_session_start: true,
            start_ms: None,
            end_ms: 20_000,
        };
        let manifest = cut(&store, &range, &path, CHUNK_BYTES).expect("cuts");
        assert_eq!((manifest.start_ms, manifest.end_ms), (1_000, 13_000));
        assert_eq!(
            manifest.gaps,
            vec![
                Gap {
                    start_ms: 7_000,
                    end_ms: 9_000,
                    reason: GapReason::Interruption
                },
                Gap {
                    start_ms: 7_000,
                    end_ms: 11_000,
                    reason: GapReason::Failure
                },
            ],
            "the recorded interruption does not cover the whole hole, so the hole is reported too"
        );
        store.delete().expect("deletes");
    }

    #[test]
    fn small_chunks_split_exactly_and_each_record_opens_alone() {
        let store = recording("clip-chunks");
        let path = store.dir().join("clip.seal");
        let range = ClipRange {
            from_session_start: true,
            start_ms: None,
            end_ms: 4_000,
        };
        let manifest = cut(&store, &range, &path, 100).expect("cuts");
        let mp4 = open(&manifest, 100).expect("opens");
        let expected: Vec<[u8; 32]> = mp4
            .chunks(100)
            .map(|chunk| Sha256::digest(chunk).into())
            .collect();
        assert_eq!(manifest.chunk_sha256, expected);
        assert_eq!(
            fs::metadata(&path).expect("file").len(),
            mp4.len() as u64 + 16 * expected.len() as u64
        );
        store.delete().expect("deletes");
    }

    #[test]
    fn invalid_empty_and_oversized_ranges_are_refused_and_leave_no_file() {
        let store = recording("clip-refuse");
        let path = store.dir().join("clip.seal");
        let refuse = |range: ClipRange, chunk: usize| cut(&store, &range, &path, chunk);
        assert!(matches!(
            refuse(
                ClipRange {
                    from_session_start: false,
                    start_ms: None,
                    end_ms: 5
                },
                100
            ),
            Err(ClipError::InvalidRange)
        ));
        assert!(matches!(
            refuse(
                ClipRange {
                    from_session_start: false,
                    start_ms: Some(9),
                    end_ms: 5
                },
                100
            ),
            Err(ClipError::InvalidRange)
        ));
        assert!(matches!(
            refuse(
                ClipRange {
                    from_session_start: false,
                    start_ms: Some(50_000),
                    end_ms: 60_000
                },
                100
            ),
            Err(ClipError::Empty)
        ));
        assert!(
            matches!(
                refuse(
                    ClipRange {
                        from_session_start: true,
                        start_ms: None,
                        end_ms: 60_000
                    },
                    1
                ),
                Err(ClipError::TooLarge)
            ),
            "more than 384 chunks"
        );
        assert!(!path.exists());
        store.delete().expect("deletes");
    }

    #[test]
    fn a_clip_over_one_chunk_splits_at_exactly_eight_mebibytes() {
        let (mut store, _) =
            Store::open(&temporary("clip-full"), "rec1", &[3; 32], 0).expect("creates");
        store.set_init(b"init").expect("init");
        store
            .append(0, 2_000, 0, &vec![0x5A; CHUNK_BYTES + 10])
            .expect("appends");
        let path = store.dir().join("clip.seal");
        let range = ClipRange {
            from_session_start: true,
            start_ms: None,
            end_ms: 2_000,
        };
        let manifest = cut(&store, &range, &path, CHUNK_BYTES).expect("cuts");
        assert_eq!(manifest.size_bytes, CHUNK_BYTES as u64 + 14);
        assert_eq!(manifest.chunk_sha256.len(), 2);
        let mp4 = open(&manifest, CHUNK_BYTES).expect("opens");
        let first: [u8; 32] = Sha256::digest(&mp4[..CHUNK_BYTES]).into();
        assert_eq!(manifest.chunk_sha256[0], first);
        store.delete().expect("deletes");
    }

    #[test]
    fn the_content_digest_follows_the_server_formula() {
        let chunk = [0xAB_u8; 32];
        let expected: [u8; 32] = Sha256::digest(
            format!(
                "proctor-screen-clip-v1\nvideo/mp4\n10\n8388608\n{}\n",
                "ab".repeat(32)
            )
            .as_bytes(),
        )
        .into();
        assert_eq!(
            content_digest(MEDIA_TYPE, 10, CHUNK_BYTES, &[chunk]),
            expected
        );
    }
}
