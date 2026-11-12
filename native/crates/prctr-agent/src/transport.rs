//! Reading frames from Electron main on its own thread, and writing frames back.

use std::io::{Read, Write};
use std::sync::mpsc::Sender;
use std::thread;

use prctr_protocol::frame::{self, Decoder, FrameError};
use prctr_protocol::messages::{AgentMessage, MainMessage};

use crate::agent::Event;

/// Reads `input` until it closes, decoding every frame and forwarding it. The first invalid frame
/// ends reading: after it the stream position cannot be trusted.
pub fn spawn_reader<R: Read + Send + 'static>(mut input: R, events: Sender<Event>) {
    let spawned = thread::Builder::new()
        .name("prctr-agent-reader".to_owned())
        .spawn(move || {
            let mut decoder = Decoder::new();
            let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
            loop {
                let read = match input.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let _ = events.send(Event::MainClosed);
                        return;
                    }
                    Ok(read) => read,
                };
                decoder.push(&buffer[..read]);
                loop {
                    match decoder.next_message::<MainMessage>() {
                        Ok(Some(message)) => {
                            if events.send(Event::Main(Box::new(message))).is_err() {
                                return;
                            }
                        }
                        Ok(None) => break,
                        Err(FrameError::InvalidLength(_) | FrameError::InvalidMessage(_)) => {
                            let _ = events.send(Event::MainInvalid);
                            return;
                        }
                    }
                }
            }
        });
    if spawned.is_err() {
        std::process::abort();
    }
}

/// Writes complete frames to Electron main.
pub struct Writer<W: Write> {
    output: W,
}

impl<W: Write> Writer<W> {
    pub const fn new(output: W) -> Self {
        Self { output }
    }

    /// # Errors
    /// When the message cannot be framed or the pipe is closed.
    pub fn send(&mut self, message: &AgentMessage) -> std::io::Result<()> {
        let bytes =
            frame::encode(message).map_err(|error| std::io::Error::other(error.to_string()))?;
        self.output.write_all(&bytes)?;
        self.output.flush()
    }
}
