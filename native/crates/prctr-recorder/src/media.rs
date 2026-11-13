//! What capture and encoding hand the recorder.

/// One captured screen image: BGRA, 4 bytes per pixel, rows `stride` bytes apart.
#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub bgra: Vec<u8>,
    /// Wall-clock capture time, unix ms.
    pub captured_ms: u64,
    /// The captured display in global points, to map window bounds into pixels.
    pub display: Rect,
}

/// A rectangle in global display points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Frame {
    /// Fills `area` (global points) with a flat neutral grey, clipped to the frame. Used for
    /// Proctor's own window, which the OS capture omits: the recording must never show what was
    /// beneath it.
    pub fn fill_placeholder(&mut self, area: Rect) {
        if self.display.width <= 0.0 || self.display.height <= 0.0 {
            return;
        }
        let scale_x = f64::from(self.width) / self.display.width;
        let scale_y = f64::from(self.height) / self.display.height;
        let pixel = |value: f64, scale: f64, limit: u32| -> u32 {
            let value = (value * scale).round();
            if value <= 0.0 {
                0
            } else if value >= f64::from(limit) {
                limit
            } else {
                // In range by the checks above.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let value = value as u32;
                value
            }
        };
        let left = pixel(area.x - self.display.x, scale_x, self.width);
        let right = pixel(area.x + area.width - self.display.x, scale_x, self.width);
        let top = pixel(area.y - self.display.y, scale_y, self.height);
        let bottom = pixel(area.y + area.height - self.display.y, scale_y, self.height);
        for row in top..bottom {
            let start = usize::try_from(row * self.stride + left * 4).unwrap_or(usize::MAX);
            let end = usize::try_from(row * self.stride + right * 4).unwrap_or(usize::MAX);
            if let Some(pixels) = self.bgra.get_mut(start..end) {
                for pixel in pixels.chunks_exact_mut(4) {
                    pixel.copy_from_slice(&[0x80, 0x80, 0x80, 0xFF]);
                }
            }
        }
    }
}

/// Produces frames at the recording's rate.
pub trait FrameSource: Send {
    /// The next frame, waiting at most `timeout`; `Ok(None)` when none arrived in time.
    ///
    /// # Errors
    /// When capture has failed and cannot continue.
    fn next_frame(&mut self, timeout: std::time::Duration) -> Result<Option<Frame>, String>;
}

/// The H.264 parameters of an encoded stream.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamFormat {
    pub width: u16,
    pub height: u16,
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
}

/// One encoded H.264 sample: length-prefixed (AVCC, 4-byte lengths) NAL units. A keyframe carries
/// its SPS and PPS in-band, so a clip can cross an encoder restart.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedSample {
    pub data: Vec<u8>,
    pub keyframe: bool,
}

/// Encodes frames to H.264.
pub trait Encoder: Send {
    /// Encodes one frame; `keyframe` forces an IDR frame. Returns the samples ready now (an encoder
    /// may delay output) and the stream's format once known.
    ///
    /// # Errors
    /// When the encoder has failed and cannot continue.
    fn encode(&mut self, frame: &Frame, keyframe: bool) -> Result<Vec<EncodedSample>, String>;

    fn format(&self) -> Option<StreamFormat>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_placeholder_fills_only_the_window_in_pixels() {
        let mut frame = Frame {
            width: 4,
            height: 2,
            stride: 16,
            bgra: vec![0; 32],
            captured_ms: 0,
            display: Rect {
                x: 100.0,
                y: 0.0,
                width: 2.0,
                height: 1.0,
            },
        };
        frame.fill_placeholder(Rect {
            x: 101.0,
            y: 0.0,
            width: 50.0,
            height: 0.5,
        });
        assert_eq!(
            &frame.bgra[0..8],
            &[0; 8],
            "left of the window is untouched"
        );
        assert_eq!(
            &frame.bgra[8..16],
            &[0x80, 0x80, 0x80, 0xFF, 0x80, 0x80, 0x80, 0xFF]
        );
        assert_eq!(
            &frame.bgra[16..32],
            &[0; 16],
            "the row below the window is untouched"
        );
    }
}
