//! Length-prefixed frames: a 4-byte big-endian length, then that many bytes of UTF-8 JSON.
//! Oversized frames are refused from the length alone, before any byte of JSON is read.

use std::fmt;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// The largest frame body either side accepts.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
const PREFIX_BYTES: usize = 4;

#[derive(Debug)]
pub enum FrameError {
    /// The declared or encoded length is zero or exceeds [`MAX_FRAME_BYTES`].
    InvalidLength(usize),
    /// The body is not a valid message.
    InvalidMessage(serde_json::Error),
}

impl fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLength(length) => write!(formatter, "invalid frame length {length}"),
            Self::InvalidMessage(error) => write!(formatter, "invalid frame message: {error}"),
        }
    }
}

impl std::error::Error for FrameError {}

/// Encodes one message as a complete frame.
///
/// # Errors
/// Returns an error when the message cannot be serialized or is larger than [`MAX_FRAME_BYTES`].
pub fn encode<T: Serialize>(message: &T) -> Result<Vec<u8>, FrameError> {
    let body = serde_json::to_vec(message).map_err(FrameError::InvalidMessage)?;
    let length = u32::try_from(body.len())
        .ok()
        .filter(|length| *length > 0 && (*length as usize) <= MAX_FRAME_BYTES)
        .ok_or(FrameError::InvalidLength(body.len()))?;
    let mut frame = Vec::with_capacity(PREFIX_BYTES + body.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// Accumulates bytes from a stream and yields complete messages.
#[derive(Debug, Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}

impl Decoder {
    #[must_use]
    pub const fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    /// The next complete message, or `None` when more bytes are needed.
    ///
    /// # Errors
    /// Returns an error for an invalid length or an invalid message. The connection must then be
    /// closed: the stream position is no longer trustworthy.
    pub fn next_message<T: DeserializeOwned>(&mut self) -> Result<Option<T>, FrameError> {
        let Some(prefix) = self.buffer.get(..PREFIX_BYTES) else {
            return Ok(None);
        };
        let declared = u32::from_be_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
        if declared == 0 || declared > MAX_FRAME_BYTES {
            return Err(FrameError::InvalidLength(declared));
        }
        let end = PREFIX_BYTES + declared;
        if self.buffer.len() < end {
            return Ok(None);
        }
        let message = serde_json::from_slice(&self.buffer[PREFIX_BYTES..end])
            .map_err(FrameError::InvalidMessage);
        self.buffer.drain(..end);
        message.map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::MainMessage;
    use crate::scalars::Count;

    fn acknowledge(up_to: u64) -> MainMessage {
        MainMessage::Acknowledge {
            up_to: Count::new(up_to).expect("small count"),
        }
    }

    #[test]
    fn a_frame_split_across_reads_decodes_once_complete() {
        let frame = encode(&acknowledge(7)).expect("encodes");
        let mut decoder = Decoder::new();
        decoder.push(&frame[..3]);
        assert!(
            decoder
                .next_message::<MainMessage>()
                .expect("partial is fine")
                .is_none()
        );
        decoder.push(&frame[3..]);
        assert_eq!(
            decoder.next_message::<MainMessage>().expect("decodes"),
            Some(acknowledge(7))
        );
        assert!(
            decoder
                .next_message::<MainMessage>()
                .expect("empty")
                .is_none()
        );
    }

    #[test]
    fn two_frames_in_one_read_decode_in_order() {
        let mut bytes = encode(&acknowledge(1)).expect("encodes");
        bytes.extend(encode(&acknowledge(2)).expect("encodes"));
        let mut decoder = Decoder::new();
        decoder.push(&bytes);
        assert_eq!(
            decoder.next_message::<MainMessage>().expect("first"),
            Some(acknowledge(1))
        );
        assert_eq!(
            decoder.next_message::<MainMessage>().expect("second"),
            Some(acknowledge(2))
        );
    }

    #[test]
    fn an_oversized_length_is_refused_before_the_body_arrives() {
        let mut decoder = Decoder::new();
        let declared = u32::try_from(MAX_FRAME_BYTES + 1).expect("fits");
        decoder.push(&declared.to_be_bytes());
        assert!(matches!(
            decoder.next_message::<MainMessage>(),
            Err(FrameError::InvalidLength(length)) if length == MAX_FRAME_BYTES + 1
        ));
    }

    #[test]
    fn a_zero_length_frame_is_refused() {
        let mut decoder = Decoder::new();
        decoder.push(&[0, 0, 0, 0]);
        assert!(matches!(
            decoder.next_message::<MainMessage>(),
            Err(FrameError::InvalidLength(0))
        ));
    }

    #[test]
    fn an_unknown_field_is_a_protocol_error() {
        let body = br#"{"kind":"acknowledge","up_to":1,"extra":true}"#;
        let mut frame = u32::try_from(body.len())
            .expect("fits")
            .to_be_bytes()
            .to_vec();
        frame.extend_from_slice(body);
        let mut decoder = Decoder::new();
        decoder.push(&frame);
        assert!(matches!(
            decoder.next_message::<MainMessage>(),
            Err(FrameError::InvalidMessage(_))
        ));
    }
}
