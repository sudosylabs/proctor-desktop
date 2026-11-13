//! Test support: a helper link whose helper end a test drives over in-memory channels.

use std::io::{self, Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use prctr_protocol::frame::{Decoder, encode};
use prctr_protocol::helper::{AgentToHelper, HelperToAgent};

use crate::helper::{ComponentStatus, HelperClient, HelperLink, HelperStream, HelperView};

pub struct ChannelReader {
    inbox: Receiver<Vec<u8>>,
    pending: Vec<u8>,
}

impl Read for ChannelReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.pending.is_empty() {
            match self.inbox.recv() {
                Ok(bytes) => self.pending = bytes,
                Err(_) => return Ok(0),
            }
        }
        let count = buffer.len().min(self.pending.len());
        buffer[..count].copy_from_slice(&self.pending[..count]);
        self.pending.drain(..count);
        Ok(count)
    }
}

pub struct ChannelWriter(pub Sender<Vec<u8>>);

impl Write for ChannelWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .send(bytes.to_vec())
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// The agent's ends of one scripted connection: bytes from the helper, bytes to it.
pub type Ends = (Receiver<Vec<u8>>, Sender<Vec<u8>>);

/// A link whose helper end the test drives.
pub struct ScriptedLink {
    pub ends: Mutex<Option<Ends>>,
    pub status: ComponentStatus,
}

impl HelperLink for ScriptedLink {
    fn connect(&self) -> io::Result<HelperStream> {
        let (inbox, outbox) = self
            .ends
            .lock()
            .expect("lock")
            .take()
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        Ok(HelperStream {
            reader: Box::new(ChannelReader {
                inbox,
                pending: Vec::new(),
            }),
            writer: Box::new(ChannelWriter(outbox)),
        })
    }

    fn status(&self) -> ComponentStatus {
        self.status
    }
}

pub struct Helper {
    pub to_agent: Sender<Vec<u8>>,
    pub from_agent: Receiver<Vec<u8>>,
    pub decoder: Decoder,
}

impl Helper {
    pub fn send(&self, message: &HelperToAgent) {
        self.to_agent
            .send(encode(message).expect("encodes"))
            .expect("agent reads");
    }

    pub fn next(&mut self) -> AgentToHelper {
        loop {
            if let Some(message) = self.decoder.next_message().expect("valid") {
                return message;
            }
            let bytes = self
                .from_agent
                .recv_timeout(Duration::from_secs(5))
                .expect("agent writes");
            self.decoder.push(&bytes);
        }
    }
}

pub fn scripted() -> (Arc<HelperClient>, Helper) {
    let (to_agent, agent_inbox) = mpsc::channel();
    let (agent_outbox, from_agent) = mpsc::channel();
    let link = Arc::new(ScriptedLink {
        ends: Mutex::new(Some((agent_inbox, agent_outbox))),
        status: ComponentStatus::Running,
    });
    (
        HelperClient::new(link),
        Helper {
            to_agent,
            from_agent,
            decoder: Decoder::new(),
        },
    )
}

pub fn wait_for(client: &HelperClient, done: impl Fn(&HelperView) -> bool) -> HelperView {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let view = client.view();
        if done(&view) || Instant::now() > deadline {
            return view;
        }
        thread::sleep(Duration::from_millis(5));
    }
}
