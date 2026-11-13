//! Pixel and bitstream conversions for encoders that need them (the Windows Media Foundation
//! encoder takes NV12 and emits Annex-B). Pure functions, tested on every platform.

/// Scales a BGRA image down by an integer box filter so its width is at most `max_width`. Returns
/// the new width, height, stride and pixels; an image already small enough is returned as is.
#[must_use]
pub fn downscale_bgra(
    width: u32,
    height: u32,
    stride: u32,
    bgra: &[u8],
    max_width: u32,
) -> (u32, u32, u32, Vec<u8>) {
    let factor = width.div_ceil(max_width.max(1)).max(1);
    if factor == 1 {
        return (width, height, stride, bgra.to_vec());
    }
    let (out_width, out_height) = (width / factor, height / factor);
    let mut out = vec![0_u8; (out_width * out_height * 4) as usize];
    let area = factor * factor;
    for y in 0..out_height {
        for x in 0..out_width {
            let mut sum = [0_u32; 4];
            for dy in 0..factor {
                let row = ((y * factor + dy) * stride) as usize;
                for dx in 0..factor {
                    let at = row + ((x * factor + dx) * 4) as usize;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += u32::from(bgra.get(at + channel).copied().unwrap_or(0));
                    }
                }
            }
            let at = ((y * out_width + x) * 4) as usize;
            for (channel, total) in sum.iter().enumerate() {
                out[at + channel] = u8::try_from(total / area).unwrap_or(u8::MAX);
            }
        }
    }
    (out_width, out_height, out_width * 4, out)
}

/// Converts BGRA to NV12 (BT.709, limited range) at even dimensions: the luma plane, then
/// interleaved Cb/Cr at half resolution. Returns the even width and height and the buffer.
#[must_use]
pub fn bgra_to_nv12(width: u32, height: u32, stride: u32, bgra: &[u8]) -> (u32, u32, Vec<u8>) {
    let (width, height) = (width & !1, height & !1);
    let (columns, rows, stride) = (width as usize, height as usize, stride as usize);
    let mut out = vec![0_u8; columns * rows * 3 / 2];
    let pixel = |x: usize, y: usize| {
        let at = y * stride + x * 4;
        let get = |offset: usize| i32::from(bgra.get(at + offset).copied().unwrap_or(0));
        (get(2), get(1), get(0))
    };
    let clamp = |value: i32| u8::try_from(value.clamp(0, 255)).unwrap_or(0);
    for y in 0..rows {
        for x in 0..columns {
            let (red, green, blue) = pixel(x, y);
            out[y * columns + x] = clamp(((47 * red + 157 * green + 16 * blue + 128) >> 8) + 16);
        }
    }
    let chroma = columns * rows;
    for y in (0..rows).step_by(2) {
        for x in (0..columns).step_by(2) {
            let (mut red, mut green, mut blue) = (0, 0, 0);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let (r, g, b) = pixel(x + dx, y + dy);
                red += r;
                green += g;
                blue += b;
            }
            let (red, green, blue) = (red / 4, green / 4, blue / 4);
            let at = chroma + (y / 2) * columns + x;
            out[at] = clamp(((-26 * red - 87 * green + 112 * blue + 128) >> 8) + 128);
            out[at + 1] = clamp(((112 * red - 102 * green - 10 * blue + 128) >> 8) + 128);
        }
    }
    (width, height, out)
}

/// One Annex-B access unit as AVCC: every NAL unit length-prefixed (4 bytes), whether it holds
/// an IDR slice, and its SPS and PPS if present.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccessUnit {
    pub avcc: Vec<u8>,
    pub keyframe: bool,
    pub sps: Option<Vec<u8>>,
    pub pps: Option<Vec<u8>>,
}

/// Splits Annex-B (`00 00 01` or `00 00 00 01` start codes) into NAL units and rewrites them as
/// AVCC, dropping access-unit delimiters.
#[must_use]
pub fn annex_b_to_avcc(stream: &[u8]) -> AccessUnit {
    let mut starts = Vec::new();
    let mut at = 0;
    while at + 3 <= stream.len() {
        if stream[at] == 0 && stream[at + 1] == 0 && stream[at + 2] == 1 {
            starts.push(at + 3);
            at += 3;
        } else {
            at += 1;
        }
    }
    let mut unit = AccessUnit {
        avcc: Vec::new(),
        keyframe: false,
        sps: None,
        pps: None,
    };
    for (index, start) in starts.iter().enumerate() {
        let mut end = starts.get(index + 1).map_or(stream.len(), |next| next - 3);
        while end > *start && stream[end - 1] == 0 && starts.get(index + 1).is_some() {
            end -= 1;
        }
        let nal = &stream[*start..end];
        let Some(header) = nal.first() else { continue };
        match header & 0x1F {
            9 => continue,
            5 => unit.keyframe = true,
            7 => unit.sps = Some(nal.to_vec()),
            8 => unit.pps = Some(nal.to_vec()),
            _ => {}
        }
        unit.avcc
            .extend_from_slice(&u32::try_from(nal.len()).unwrap_or(0).to_be_bytes());
        unit.avcc.extend_from_slice(nal);
    }
    unit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annex_b_becomes_length_prefixed_and_finds_parameter_sets() {
        let stream = [
            0, 0, 0, 1, 0x09, 0xF0, // access unit delimiter: dropped
            0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1E, // SPS
            0, 0, 1, 0x68, 0xCE, // PPS, three-byte start code
            0, 0, 0, 1, 0x65, 0x88, 0x84, // IDR slice
        ];
        let unit = annex_b_to_avcc(&stream);
        assert!(unit.keyframe);
        assert_eq!(unit.sps.as_deref(), Some(&[0x67, 0x42, 0x00, 0x1E][..]));
        assert_eq!(unit.pps.as_deref(), Some(&[0x68, 0xCE][..]));
        assert_eq!(
            unit.avcc,
            vec![
                0, 0, 0, 4, 0x67, 0x42, 0x00, 0x1E, 0, 0, 0, 2, 0x68, 0xCE, 0, 0, 0, 3, 0x65, 0x88,
                0x84
            ]
        );
        assert!(
            !annex_b_to_avcc(&[0, 0, 0, 1, 0x41, 0x9A]).keyframe,
            "a P slice is not a keyframe"
        );
    }

    #[test]
    fn white_and_black_convert_to_limited_range_luma_and_neutral_chroma() {
        let white = vec![0xFF_u8; 4 * 4 * 2];
        let (width, height, nv12) = bgra_to_nv12(4, 2, 16, &white);
        assert_eq!((width, height, nv12.len()), (4, 2, 12));
        assert!(
            nv12[..8].iter().all(|luma| (234..=236).contains(luma)),
            "{:?}",
            &nv12[..8]
        );
        assert!(nv12[8..].iter().all(|chroma| (127..=129).contains(chroma)));
        let black: Vec<u8> = [0, 0, 0, 0xFF].repeat(8);
        let (_, _, nv12) = bgra_to_nv12(4, 2, 16, &black);
        assert!(nv12[..8].iter().all(|luma| *luma == 16));
    }

    #[test]
    fn odd_sizes_round_down_to_even() {
        let (width, height, nv12) = bgra_to_nv12(5, 3, 20, &[0; 60]);
        assert_eq!((width, height, nv12.len()), (4, 2, 12));
    }

    #[test]
    fn a_wide_image_is_averaged_down_and_a_small_one_kept() {
        let bgra: Vec<u8> = [[0, 0, 0, 255], [200, 200, 200, 255]].concat().repeat(2);
        let (width, height, stride, out) = downscale_bgra(2, 2, 8, &bgra, 1);
        assert_eq!((width, height, stride), (1, 1, 4));
        assert_eq!(out, vec![100, 100, 100, 255]);
        let (width, _, _, kept) = downscale_bgra(2, 2, 8, &bgra, 1_920);
        assert_eq!((width, kept), (2, bgra));
    }
}
