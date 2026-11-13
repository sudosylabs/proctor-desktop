//! Bounded, process-local observations for the privileged helper. No wire types or policy.

pub const MAX_PROCESSES: usize = 32_768;
pub const MAX_SESSIONS: usize = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessStart {
    pub pid: u32,
    pub parent: u32,
    pub session: u32,
    /// 100 ns ticks since the Unix epoch, identical in snapshots and notifications.
    pub created: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attachment {
    Active,
    Disconnected,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: u32,
    pub attachment: Attachment,
    pub has_user: bool,
    pub remote: bool,
    pub locked: Option<bool>,
}

/// FILETIME uses the Windows epoch (1601). Invalid/pre-Unix times are unknown.
#[must_use]
pub fn filetime_to_unix(value: u64) -> Option<u64> {
    value.checked_sub(116_444_736_000_000_000)
}

#[must_use]
pub fn timeval_to_unix(seconds: u64, micros: u64) -> Option<u64> {
    if micros >= 1_000_000 {
        return None;
    }
    seconds.checked_mul(10_000_000)?.checked_add(micros * 10)
}

#[cfg(test)]
mod tests {
    #[test]
    fn both_platforms_use_the_same_epoch_and_units() {
        assert_eq!(
            super::filetime_to_unix(116_444_736_012_345_670),
            Some(12_345_670)
        );
        assert_eq!(super::timeval_to_unix(1, 234_567), Some(12_345_670));
        assert_eq!(super::filetime_to_unix(0), None);
        assert_eq!(super::timeval_to_unix(u64::MAX, 0), None);
        assert_eq!(super::timeval_to_unix(0, 1_000_000), None);
    }
}

#[cfg(unix)]
pub struct UnixWriter(std::os::unix::net::UnixStream);
#[cfg(unix)]
impl std::io::Write for UnixWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}
#[cfg(unix)]
impl Drop for UnixWriter {
    fn drop(&mut self) {
        let _ = self.0.shutdown(std::net::Shutdown::Both);
    }
}

/// The writer owns shutdown of both halves, including a reader blocked in an OS call.
/// # Errors
/// Returns a stream-clone or write-timeout configuration failure.
#[cfg(unix)]
pub fn unix_halves(
    stream: std::os::unix::net::UnixStream,
) -> std::io::Result<(std::os::unix::net::UnixStream, UnixWriter)> {
    stream.set_write_timeout(Some(std::time::Duration::from_secs(1)))?;
    Ok((stream.try_clone()?, UnixWriter(stream)))
}

#[cfg(all(test, unix))]
mod transport_tests {
    use std::io::Read;
    #[test]
    fn dropping_the_writer_releases_a_blocked_reader_and_the_peer() {
        let (stream, mut peer) = std::os::unix::net::UnixStream::pair().expect("sockets");
        let (mut reader, writer) = super::unix_halves(stream).expect("halves");
        peer.set_read_timeout(Some(std::time::Duration::from_secs(1)))
            .expect("deadline");
        let thread = std::thread::spawn(move || reader.read(&mut [0; 1]).expect("read shutdown"));
        drop(writer);
        assert_eq!(peer.read(&mut [0; 1]).expect("peer sees EOF"), 0);
        assert_eq!(thread.join().expect("reader exited"), 0);
    }
}
