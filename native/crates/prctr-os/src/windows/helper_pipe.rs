//! Cancellable byte-pipe halves. Dropping the writer also releases a waiting reader.
use interprocess::os::windows::named_pipe::{
    PipeStream, RecvPipeStream, SendPipeStream, pipe_mode::Bytes,
};
use std::io::{self, Read, Write};
use std::os::windows::io::AsRawHandle;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

/// The write retry interval while the pipe buffer is full.
const POLL: Duration = Duration::from_millis(10);
/// An idle reader's poll interval: short right after data, doubling to `MAX_IDLE_POLL`.
const MIN_IDLE_POLL: Duration = Duration::from_millis(1);
const MAX_IDLE_POLL: Duration = Duration::from_millis(50);
pub struct Reader {
    stream: RecvPipeStream<Bytes>,
    closed: Arc<AtomicBool>,
}
pub struct Writer {
    stream: SendPipeStream<Bytes>,
    closed: Arc<AtomicBool>,
}

/// # Errors
/// Returns a pipe-mode configuration failure.
pub fn split(stream: PipeStream<Bytes, Bytes>) -> io::Result<(Reader, Writer)> {
    stream.set_nonblocking(true)?;
    let (reader, writer) = stream.split();
    let closed = Arc::new(AtomicBool::new(false));
    Ok((
        Reader {
            stream: reader,
            closed: Arc::clone(&closed),
        },
        Writer {
            stream: writer,
            closed,
        },
    ))
}
impl Read for Reader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let mut idle = MIN_IDLE_POLL;
        while !self.closed.load(Ordering::Acquire) {
            if bytes.is_empty() {
                return Ok(0);
            }
            let mut available = 0;
            // SAFETY: the pipe handle stays borrowed; available is a writable scalar output.
            unsafe {
                windows::Win32::System::Pipes::PeekNamedPipe(
                    windows::Win32::Foundation::HANDLE(self.stream.as_raw_handle()),
                    None,
                    0,
                    None,
                    Some(&raw mut available),
                    None,
                )
            }
            .map_err(io::Error::from)?;
            if available == 0 {
                std::thread::park_timeout(idle);
                idle = (idle * 2).min(MAX_IDLE_POLL);
                continue;
            }
            // Only this half reads, so a successful peek bounds a non-waiting read. In
            // PIPE_NOWAIT mode interprocess can collapse ERROR_NO_DATA to EOF; never call
            // its reader on an empty pipe.
            let count = bytes.len().min(available as usize);
            match self.stream.read(&mut bytes[..count]) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::park_timeout(idle);
                }
                result => return result,
            }
        }
        Ok(0)
    }
}
impl Write for Writer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let deadline = Instant::now() + Duration::from_secs(1);
        while !self.closed.load(Ordering::Acquire) {
            match self.stream.write(bytes) {
                Ok(0) if !bytes.is_empty() => {
                    if Instant::now() >= deadline {
                        return Err(io::ErrorKind::TimedOut.into());
                    }
                    std::thread::park_timeout(POLL);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(io::ErrorKind::TimedOut.into());
                    }
                    std::thread::park_timeout(POLL);
                }
                result => return result,
            }
        }
        Err(io::ErrorKind::BrokenPipe.into())
    }
    fn flush(&mut self) -> io::Result<()> {
        // WriteFile already hands bytes to the pipe. FlushFileBuffers would instead wait for
        // the peer to consume them and could hold the helper/client lock indefinitely.
        Ok(())
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Release);
        // Teardown abandons unconsumed bytes. It must not spawn a limbo flush thread waiting
        // forever for a disconnected/stalled peer to consume the final bytes.
        self.stream.assume_flushed();
    }
}

#[cfg(test)]
mod tests {
    use interprocess::os::windows::named_pipe::{
        PipeListenerOptions, PipeStream, pipe_mode::Bytes,
    };
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;
    #[test]
    fn an_idle_pipe_waits_for_bytes_and_writer_teardown_releases_the_reader() {
        let name = format!(r"\\.\pipe\ProctorNativeIoTest-{}", std::process::id());
        let listener = PipeListenerOptions::new()
            .path(name.as_str())
            .create_duplex::<Bytes>()
            .expect("listener");
        let client = PipeStream::<Bytes, Bytes>::connect_by_path_with_wait_mode(
            name.as_str(),
            interprocess::ConnectWaitMode::Timeout(Duration::from_secs(1)),
        )
        .expect("client");
        let server = listener.accept().expect("accept");
        let (mut reader, writer) = super::split(server).expect("server halves");
        let (_peer_reader, mut peer_writer) = super::split(client).expect("client halves");
        let (sender, received) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let mut bytes = [0; 2];
            reader.read_exact(&mut bytes).expect("first bytes");
            sender.send(bytes).expect("observer");
            assert_eq!(reader.read(&mut bytes).expect("shutdown"), 0);
        });
        assert!(
            received.recv_timeout(Duration::from_millis(50)).is_err(),
            "an idle pipe must not return EOF"
        );
        peer_writer.write_all(b"ok").expect("write");
        assert_eq!(
            received
                .recv_timeout(Duration::from_secs(2))
                .expect("bytes"),
            *b"ok"
        );
        drop(writer);
        thread.join().expect("reader terminated");
    }
}
