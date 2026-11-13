//! This platform's capture and encoder for the recorder.

use crate::media::{Encoder, FrameSource};

/// Recording frames per second.
pub const FPS: u32 = 5;
/// Frames are scaled down to at most this width.
pub const MAX_WIDTH: u32 = 1_920;

/// Starts capturing the display and opens an H.264 encoder, or `None` where this platform cannot
/// record yet.
#[must_use]
pub fn backend() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> {
    None
}

/// Bytes available on the volume holding `path`.
#[must_use]
pub fn free_space(path: &std::path::Path) -> Option<u64> {
    prctr_os::free_space(path)
}
