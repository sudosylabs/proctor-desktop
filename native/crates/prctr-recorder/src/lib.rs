//! The screen evidence recorder. It records the screen into encrypted fragmented-MP4 segments for
//! the whole Participation and cuts the clips the server requests, without re-encoding. It collects
//! content, not facts, and holds no OS handles: capture and encoding come in through
//! [`FrameSource`] and [`Encoder`], implemented in `prctr-os`.
//! Contract: `docs/architecture/native-capabilities.md`, "Screen evidence recorder".
#![forbid(unsafe_code)]

pub mod clip;
pub mod convert;
pub mod media;
pub mod mp4;
pub mod platform;
pub mod recorder;
pub mod store;

pub use clip::{
    CHUNK_BYTES, ClipError, ClipManifest, ClipRange, MAX_CHUNKS, MAX_CLIP_BYTES, MEDIA_TYPE,
};
pub use media::{EncodedSample, Encoder, Frame, FrameSource, Rect, StreamFormat};
pub use recorder::{
    ClipFailure, Disposition, Recorder, RecorderConfig, RecorderEvent, RecorderState, SaveRefusal,
};
pub use store::{Gap, GapReason, Store, StoreError};
