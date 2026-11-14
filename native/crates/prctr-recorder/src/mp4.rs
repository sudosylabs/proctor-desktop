//! A minimal fragmented-MP4 writer for one H.264 video track: an init segment, then one
//! fragment per segment. The timescale is milliseconds. The track is `avc3`, so keyframes carry
//! their parameter sets in-band and a recording can continue after an encoder restart.

use crate::media::{EncodedSample, StreamFormat};

/// Media time units per second.
pub const TIMESCALE: u32 = 1_000;

fn boxed(kind: [u8; 4], body: &[u8]) -> Vec<u8> {
    let size = u32::try_from(body.len() + 8).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&size.to_be_bytes());
    out.extend_from_slice(&kind);
    out.extend_from_slice(body);
    out
}

fn full(kind: [u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut content = Vec::with_capacity(body.len() + 4);
    content.extend_from_slice(&((u32::from(version) << 24) | (flags & 0x00FF_FFFF)).to_be_bytes());
    content.extend_from_slice(body);
    boxed(kind, &content)
}

fn concat(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.concat()
}

const MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

fn matrix() -> Vec<u8> {
    MATRIX
        .iter()
        .flat_map(|value| value.to_be_bytes())
        .collect()
}

fn avc_configuration(format: &StreamFormat) -> Vec<u8> {
    let profile = |index: usize| format.sps.get(index).copied().unwrap_or(0);
    let mut body = vec![1, profile(1), profile(2), profile(3), 0xFF, 0xE1];
    body.extend_from_slice(&u16::try_from(format.sps.len()).unwrap_or(0).to_be_bytes());
    body.extend_from_slice(&format.sps);
    body.push(1);
    body.extend_from_slice(&u16::try_from(format.pps.len()).unwrap_or(0).to_be_bytes());
    body.extend_from_slice(&format.pps);
    boxed(*b"avcC", &body)
}

fn sample_entry(format: &StreamFormat) -> Vec<u8> {
    let mut body = vec![0; 6];
    body.extend_from_slice(&1_u16.to_be_bytes());
    body.extend_from_slice(&[0; 16]);
    body.extend_from_slice(&format.width.to_be_bytes());
    body.extend_from_slice(&format.height.to_be_bytes());
    body.extend_from_slice(&0x0048_0000_u32.to_be_bytes());
    body.extend_from_slice(&0x0048_0000_u32.to_be_bytes());
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&1_u16.to_be_bytes());
    body.extend_from_slice(&[0; 32]);
    body.extend_from_slice(&0x0018_u16.to_be_bytes());
    body.extend_from_slice(&0xFFFF_u16.to_be_bytes());
    body.extend_from_slice(&avc_configuration(format));
    boxed(*b"avc3", &body)
}

/// The init segment: `ftyp` and `moov` with one video track and `mvex` for fragments.
#[must_use]
pub fn init_segment(format: &StreamFormat) -> Vec<u8> {
    let ftyp = boxed(
        *b"ftyp",
        &concat(&[
            b"isom".to_vec(),
            0x200_u32.to_be_bytes().to_vec(),
            b"isomiso6avc1mp41".to_vec(),
        ]),
    );
    let mut mvhd = Vec::new();
    mvhd.extend_from_slice(&[0; 8]);
    mvhd.extend_from_slice(&TIMESCALE.to_be_bytes());
    mvhd.extend_from_slice(&0_u32.to_be_bytes());
    mvhd.extend_from_slice(&0x0001_0000_u32.to_be_bytes());
    mvhd.extend_from_slice(&0x0100_u16.to_be_bytes());
    mvhd.extend_from_slice(&[0; 10]);
    mvhd.extend_from_slice(&matrix());
    mvhd.extend_from_slice(&[0; 24]);
    mvhd.extend_from_slice(&2_u32.to_be_bytes());
    let mut tkhd = Vec::new();
    tkhd.extend_from_slice(&[0; 8]);
    tkhd.extend_from_slice(&1_u32.to_be_bytes());
    tkhd.extend_from_slice(&[0; 4]);
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&[0; 8]);
    tkhd.extend_from_slice(&[0; 8]);
    tkhd.extend_from_slice(&matrix());
    tkhd.extend_from_slice(&(u32::from(format.width) << 16).to_be_bytes());
    tkhd.extend_from_slice(&(u32::from(format.height) << 16).to_be_bytes());
    let mut media_header = Vec::new();
    media_header.extend_from_slice(&[0; 8]);
    media_header.extend_from_slice(&TIMESCALE.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&0x55C4_u16.to_be_bytes());
    media_header.extend_from_slice(&[0; 2]);
    let mut hdlr = vec![0; 4];
    hdlr.extend_from_slice(b"vide");
    hdlr.extend_from_slice(&[0; 12]);
    hdlr.extend_from_slice(b"Proctor screen\0");
    let empty_table = || 0_u32.to_be_bytes().to_vec();
    let stbl = boxed(
        *b"stbl",
        &concat(&[
            full(
                *b"stsd",
                0,
                0,
                &concat(&[1_u32.to_be_bytes().to_vec(), sample_entry(format)]),
            ),
            full(*b"stts", 0, 0, &empty_table()),
            full(*b"stsc", 0, 0, &empty_table()),
            full(*b"stsz", 0, 0, &[0; 8]),
            full(*b"stco", 0, 0, &empty_table()),
        ]),
    );
    let dinf = boxed(
        *b"dinf",
        &full(
            *b"dref",
            0,
            0,
            &concat(&[1_u32.to_be_bytes().to_vec(), full(*b"url ", 0, 1, &[])]),
        ),
    );
    let minf = boxed(
        *b"minf",
        &concat(&[full(*b"vmhd", 0, 1, &[0; 8]), dinf, stbl]),
    );
    let mdia = boxed(
        *b"mdia",
        &concat(&[
            full(*b"mdhd", 0, 0, &media_header),
            full(*b"hdlr", 0, 0, &hdlr),
            minf,
        ]),
    );
    let trak = boxed(*b"trak", &concat(&[full(*b"tkhd", 0, 3, &tkhd), mdia]));
    let mut trex = Vec::new();
    for value in [1_u32, 1, 0, 0, 0] {
        trex.extend_from_slice(&value.to_be_bytes());
    }
    let mvex = boxed(*b"mvex", &full(*b"trex", 0, 0, &trex));
    let moov = boxed(
        *b"moov",
        &concat(&[full(*b"mvhd", 0, 0, &mvhd), trak, mvex]),
    );
    concat(&[ftyp, moov])
}

/// One fragment: `moof` and `mdat` for `samples`, starting at `decode_ms` on the media timeline,
/// each sample lasting `duration_ms`.
#[must_use]
pub fn fragment(
    sequence: u32,
    decode_ms: u64,
    duration_ms: u32,
    samples: &[EncodedSample],
) -> Vec<u8> {
    const DATA_OFFSET: u32 = 0x0000_0001;
    const SAMPLE_DURATION: u32 = 0x0000_0100;
    const SAMPLE_SIZE: u32 = 0x0000_0200;
    const SAMPLE_FLAGS: u32 = 0x0000_0400;
    const KEYFRAME: u32 = 0x0200_0000;
    const DEPENDENT: u32 = 0x0101_0000;
    let trun_body = |data_offset: u32| {
        let mut body = Vec::new();
        body.extend_from_slice(&u32::try_from(samples.len()).unwrap_or(0).to_be_bytes());
        body.extend_from_slice(&data_offset.to_be_bytes());
        for sample in samples {
            body.extend_from_slice(&duration_ms.to_be_bytes());
            body.extend_from_slice(&u32::try_from(sample.data.len()).unwrap_or(0).to_be_bytes());
            body.extend_from_slice(
                &(if sample.keyframe { KEYFRAME } else { DEPENDENT }).to_be_bytes(),
            );
        }
        body
    };
    let build = |data_offset: u32| {
        let tfhd = full(*b"tfhd", 0, 0x02_0000, &1_u32.to_be_bytes());
        let tfdt = full(*b"tfdt", 1, 0, &decode_ms.to_be_bytes());
        let trun = full(
            *b"trun",
            0,
            DATA_OFFSET | SAMPLE_DURATION | SAMPLE_SIZE | SAMPLE_FLAGS,
            &trun_body(data_offset),
        );
        let traf = boxed(*b"traf", &concat(&[tfhd, tfdt, trun]));
        boxed(
            *b"moof",
            &concat(&[full(*b"mfhd", 0, 0, &sequence.to_be_bytes()), traf]),
        )
    };
    // The data offset counts from the start of `moof` to the first sample byte inside `mdat`.
    let moof_size = u32::try_from(build(0).len()).unwrap_or(0);
    let moof = build(moof_size + 8);
    let mdat = boxed(
        *b"mdat",
        &samples
            .iter()
            .flat_map(|sample| sample.data.iter().copied())
            .collect::<Vec<_>>(),
    );
    concat(&[moof, mdat])
}

#[cfg(test)]
pub(crate) mod walker {
    //! An independent box reader for tests: it checks sizes nest exactly and finds boxes by path.

    pub struct Box<'a> {
        pub kind: [u8; 4],
        pub body: &'a [u8],
    }

    /// Splits `bytes` into boxes; panics if any size is wrong.
    pub fn boxes(bytes: &[u8]) -> Vec<Box<'_>> {
        let mut out = Vec::new();
        let mut at = 0;
        while at < bytes.len() {
            let size = u32::from_be_bytes(bytes[at..at + 4].try_into().expect("size")) as usize;
            assert!(
                size >= 8 && at + size <= bytes.len(),
                "box size {size} at {at} overruns"
            );
            out.push(Box {
                kind: bytes[at + 4..at + 8].try_into().expect("kind"),
                body: &bytes[at + 8..at + size],
            });
            at += size;
        }
        out
    }

    /// The body of the first box along `path`, descending into containers (full boxes skip 4
    /// bytes of version and flags, `stsd` skips its entry count, `avc3` its fixed fields).
    pub fn find<'a>(bytes: &'a [u8], path: &[&[u8; 4]]) -> &'a [u8] {
        let mut current = bytes;
        for (depth, kind) in path.iter().enumerate() {
            let found = boxes(current)
                .into_iter()
                .find(|candidate| &candidate.kind == *kind)
                .unwrap_or_else(|| {
                    panic!("no {} at depth {depth}", String::from_utf8_lossy(*kind))
                });
            current = found.body;
            if depth + 1 < path.len() {
                current = match *kind {
                    b"stsd" | b"dref" => &current[8..],
                    b"avc3" => &current[78..],
                    _ => current,
                };
            }
        }
        current
    }
}

#[cfg(test)]
mod tests {
    use super::walker::{boxes, find};
    use super::*;

    fn format() -> StreamFormat {
        StreamFormat {
            width: 1280,
            height: 800,
            sps: vec![0x67, 0x64, 0x00, 0x1F, 0xAC],
            pps: vec![0x68, 0xEE, 0x3C, 0x80],
        }
    }

    #[test]
    fn the_init_segment_nests_exactly_and_names_the_stream() {
        let init = init_segment(&format());
        let top: Vec<_> = boxes(&init).iter().map(|found| found.kind).collect();
        assert_eq!(top, vec![*b"ftyp", *b"moov"]);
        let avcc = find(
            &init,
            &[
                b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd", b"avc3", b"avcC",
            ],
        );
        assert_eq!(
            avcc[1..4],
            [0x64, 0x00, 0x1F],
            "profile and level come from the SPS"
        );
        let mdhd = find(&init, &[b"moov", b"trak", b"mdia", b"mdhd"]);
        assert_eq!(
            u32::from_be_bytes(mdhd[12..16].try_into().expect("timescale")),
            TIMESCALE
        );
        let tkhd = find(&init, &[b"moov", b"trak", b"tkhd"]);
        assert_eq!(
            u32::from_be_bytes(tkhd[76..80].try_into().expect("width")) >> 16,
            1280
        );
        find(&init, &[b"moov", b"mvex", b"trex"]);
    }

    #[test]
    fn a_fragment_points_at_its_samples_and_marks_keyframes() {
        let samples = vec![
            EncodedSample {
                data: vec![0, 0, 0, 2, 0x65, 1],
                keyframe: true,
            },
            EncodedSample {
                data: vec![0, 0, 0, 1, 0x41],
                keyframe: false,
            },
        ];
        let bytes = fragment(7, 4_000, 200, &samples);
        let top = boxes(&bytes);
        assert_eq!(
            top.iter().map(|found| found.kind).collect::<Vec<_>>(),
            vec![*b"moof", *b"mdat"]
        );
        assert_eq!(top[1].body, &[0, 0, 0, 2, 0x65, 1, 0, 0, 0, 1, 0x41]);
        let mfhd = find(&bytes, &[b"moof", b"mfhd"]);
        assert_eq!(
            u32::from_be_bytes(mfhd[4..8].try_into().expect("sequence")),
            7
        );
        let tfdt = find(&bytes, &[b"moof", b"traf", b"tfdt"]);
        assert_eq!(
            u64::from_be_bytes(tfdt[4..12].try_into().expect("decode time")),
            4_000
        );
        let trun = find(&bytes, &[b"moof", b"traf", b"trun"]);
        let offset = u32::from_be_bytes(trun[8..12].try_into().expect("offset")) as usize;
        let moof_size = 8 + top[0].body.len();
        assert_eq!(
            offset,
            moof_size + 8,
            "the data offset lands on the first mdat byte"
        );
        assert_eq!(bytes[offset], 0);
        assert_eq!(
            u32::from_be_bytes(trun[20..24].try_into().expect("flags")),
            0x0200_0000
        );
        assert_eq!(
            u32::from_be_bytes(trun[32..36].try_into().expect("flags")),
            0x0101_0000
        );
    }
}
