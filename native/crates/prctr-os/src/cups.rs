//! A minimal IPP client for the local CUPS scheduler, over its Unix domain socket. It sends one
//! `Get-Jobs` request for three attributes only (job number, state and owner) and reduces each
//! owner to candidate or other at once. Printer names, document names and hosts are never
//! requested.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::{RawJobOwner, RawPrintJob};

/// The scheduler sockets, in the order tried.
#[cfg(target_os = "macos")]
const SOCKETS: &[&str] = &["/private/var/run/cupsd"];
#[cfg(target_os = "linux")]
const SOCKETS: &[&str] = &["/run/cups/cups.sock", "/var/run/cups/cups.sock"];

/// The most jobs one read returns. CUPS keeps at most 500 jobs by default, history included.
pub const MAX_JOBS: usize = 1_000;
const MAX_RESPONSE: u64 = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(2);

const OPERATION_GET_JOBS: u16 = 0x000A;
const TAG_OPERATION: u8 = 0x01;
const TAG_JOB: u8 = 0x02;
const TAG_END: u8 = 0x03;
const TAG_INTEGER: u8 = 0x21;
const TAG_ENUM: u8 = 0x23;
const TAG_NAME_WITH_LANGUAGE: u8 = 0x36;
const TAG_NAME: u8 = 0x42;
const TAG_KEYWORD: u8 = 0x44;
const TAG_URI: u8 = 0x45;
const TAG_CHARSET: u8 = 0x47;
const TAG_LANGUAGE: u8 = 0x48;
/// `client-error-not-found`: CUPS answers it when there are no jobs.
const STATUS_NOT_FOUND: u16 = 0x0406;
/// Job states `pending` (3) to `processing-stopped` (6) are active.
const ACTIVE_STATES: std::ops::RangeInclusive<u32> = 3..=6;

/// A read of the scheduler's jobs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Jobs {
    pub jobs: Vec<RawPrintJob>,
    /// The response reached [`MAX_JOBS`]: older jobs may be missing.
    pub truncated: bool,
}

fn attribute(body: &mut Vec<u8>, tag: u8, name: &str, value: &[u8]) {
    body.push(tag);
    body.extend_from_slice(&u16::try_from(name.len()).unwrap_or(0).to_be_bytes());
    body.extend_from_slice(name.as_bytes());
    body.extend_from_slice(&u16::try_from(value.len()).unwrap_or(0).to_be_bytes());
    body.extend_from_slice(value);
}

/// The `Get-Jobs` request for every job, history included, with only the three attributes.
#[must_use]
pub fn request(user: &str) -> Vec<u8> {
    let mut body = vec![2, 0];
    body.extend_from_slice(&OPERATION_GET_JOBS.to_be_bytes());
    body.extend_from_slice(&1_u32.to_be_bytes());
    body.push(TAG_OPERATION);
    attribute(&mut body, TAG_CHARSET, "attributes-charset", b"utf-8");
    attribute(
        &mut body,
        TAG_LANGUAGE,
        "attributes-natural-language",
        b"en",
    );
    attribute(&mut body, TAG_URI, "printer-uri", b"ipp://localhost/");
    attribute(&mut body, TAG_NAME, "requesting-user-name", user.as_bytes());
    attribute(&mut body, TAG_KEYWORD, "which-jobs", b"all");
    let limit = u32::try_from(MAX_JOBS).unwrap_or(u32::MAX).to_be_bytes();
    attribute(&mut body, TAG_INTEGER, "limit", &limit);
    attribute(&mut body, TAG_KEYWORD, "requested-attributes", b"job-id");
    attribute(&mut body, TAG_KEYWORD, "", b"job-state");
    attribute(&mut body, TAG_KEYWORD, "", b"job-originating-user-name");
    body.push(TAG_END);
    body
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let slice = self.bytes.get(self.at..self.at.checked_add(count)?)?;
        self.at += count;
        Some(slice)
    }

    fn byte(&mut self) -> Option<u8> {
        self.take(1).map(|bytes| bytes[0])
    }

    fn short(&mut self) -> Option<u16> {
        self.take(2)
            .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn word(value: &[u8]) -> Option<u32> {
        Some(u32::from_be_bytes(value.try_into().ok()?))
    }
}

#[derive(Default)]
struct Partial {
    id: Option<u32>,
    state: Option<u32>,
    owner: Option<bool>,
}

impl Partial {
    fn finish(self) -> Option<RawPrintJob> {
        Some(RawPrintJob {
            id: self.id?,
            owner: match self.owner {
                Some(true) => RawJobOwner::Candidate,
                Some(false) => RawJobOwner::Other,
                None => RawJobOwner::Unknown,
            },
            active: self
                .state
                .is_some_and(|state| ACTIVE_STATES.contains(&state)),
        })
    }
}

/// Decodes a `Get-Jobs` response. A job without a number is skipped; one without an owner has an
/// unknown owner. Returns `None` for a malformed or failed response.
#[must_use]
pub fn decode(response: &[u8], user: &str) -> Option<Jobs> {
    let mut cursor = Cursor {
        bytes: response,
        at: 0,
    };
    cursor.take(2)?;
    let status = cursor.short()?;
    cursor.take(4)?;
    if status == STATUS_NOT_FOUND {
        return Some(Jobs {
            jobs: Vec::new(),
            truncated: false,
        });
    }
    if status > 0x00FF {
        return None;
    }
    let mut jobs = Vec::new();
    let mut current: Option<Partial> = None;
    let mut name = Vec::new();
    loop {
        let tag = cursor.byte()?;
        if tag < 0x10 {
            if let Some(job) = current.take().and_then(Partial::finish) {
                jobs.push(job);
            }
            if tag == TAG_END {
                break;
            }
            if tag == TAG_JOB {
                current = Some(Partial::default());
            }
            continue;
        }
        let name_length = usize::from(cursor.short()?);
        let this_name = cursor.take(name_length)?;
        if !this_name.is_empty() {
            name = this_name.to_vec();
        }
        let value_length = usize::from(cursor.short()?);
        let value = cursor.take(value_length)?;
        let Some(job) = current.as_mut() else {
            continue;
        };
        match (name.as_slice(), tag) {
            (b"job-id", TAG_INTEGER) => job.id = Cursor::word(value),
            (b"job-state", TAG_ENUM) => job.state = Cursor::word(value),
            (b"job-originating-user-name", TAG_NAME) => job.owner = Some(value == user.as_bytes()),
            (b"job-originating-user-name", TAG_NAME_WITH_LANGUAGE) => {
                // A language-tagged name: a 2-byte language length, the language, then the name.
                let mut inner = Cursor {
                    bytes: value,
                    at: 0,
                };
                let language = usize::from(inner.short()?);
                inner.take(language)?;
                let length = usize::from(inner.short()?);
                job.owner = Some(inner.take(length)? == user.as_bytes());
            }
            _ => {}
        }
        if jobs.len() >= MAX_JOBS {
            break;
        }
    }
    let truncated = jobs.len() >= MAX_JOBS;
    jobs.truncate(MAX_JOBS);
    Some(Jobs { jobs, truncated })
}

/// The body of an HTTP/1.1 response, plain or chunked. `None` unless the status is 200.
#[must_use]
pub fn http_body(response: &[u8]) -> Option<Vec<u8>> {
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&response[..split]).ok()?;
    let body = &response[split + 4..];
    let mut lines = head.split("\r\n");
    let status = lines.next()?.split(' ').nth(1)?;
    if status != "200" {
        return None;
    }
    let chunked = lines.any(|line| {
        line.to_ascii_lowercase()
            .replace(' ', "")
            .starts_with("transfer-encoding:chunked")
    });
    if !chunked {
        return Some(body.to_vec());
    }
    let mut decoded = Vec::new();
    let mut rest = body;
    loop {
        let end = rest.windows(2).position(|window| window == b"\r\n")?;
        let size = std::str::from_utf8(&rest[..end]).ok()?;
        let size = usize::from_str_radix(size.split(';').next()?.trim(), 16).ok()?;
        rest = &rest[end + 2..];
        if size == 0 {
            return Some(decoded);
        }
        decoded.extend_from_slice(rest.get(..size)?);
        rest = rest.get(size + 2..)?;
    }
}

fn exchange(socket: &Path, body: &[u8]) -> Option<Vec<u8>> {
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    let head = format!(
        "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/ipp\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).ok()?;
    stream.write_all(body).ok()?;
    let mut response = Vec::new();
    stream.take(MAX_RESPONSE).read_to_end(&mut response).ok()?;
    http_body(&response)
}

/// The login name the agent runs as.
fn user() -> Option<String> {
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut buffer = vec![0 as libc::c_char; 4096];
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: `getuid` has no preconditions.
    let uid = unsafe { libc::getuid() };
    // SAFETY: `entry`, `buffer` and `result` are valid for the stated sizes; on success `result`
    // points at `entry`, whose strings live in `buffer`.
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &raw mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    // SAFETY: `getpwuid_r` succeeded, so `entry` is initialized.
    let name = unsafe { entry.assume_init() }.pw_name;
    if name.is_null() {
        return None;
    }
    // SAFETY: `pw_name` is a NUL-terminated string inside `buffer`, which is still alive.
    let name = unsafe { std::ffi::CStr::from_ptr(name) };
    Some(name.to_string_lossy().into_owned())
}

/// Every job the local scheduler knows, active and finished. `None` when no scheduler answers.
#[must_use]
pub fn jobs() -> Option<Jobs> {
    let user = user()?;
    let body = request(&user);
    SOCKETS
        .iter()
        .find_map(|socket| exchange(Path::new(socket), &body))
        .and_then(|response| decode(&response, &user))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job_group(out: &mut Vec<u8>, id: u32, state: u32, owner: Option<&str>) {
        out.push(TAG_JOB);
        attribute(out, TAG_INTEGER, "job-id", &id.to_be_bytes());
        attribute(out, TAG_ENUM, "job-state", &state.to_be_bytes());
        if let Some(owner) = owner {
            attribute(out, TAG_NAME, "job-originating-user-name", owner.as_bytes());
        }
    }

    fn response(status: u16, groups: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut out = vec![2, 0];
        out.extend_from_slice(&status.to_be_bytes());
        out.extend_from_slice(&1_u32.to_be_bytes());
        out.push(TAG_OPERATION);
        attribute(&mut out, TAG_CHARSET, "attributes-charset", b"utf-8");
        groups(&mut out);
        out.push(TAG_END);
        out
    }

    #[test]
    fn owners_reduce_to_candidate_other_or_unknown() {
        let bytes = response(0, |out| {
            job_group(out, 7, 3, Some("alex"));
            job_group(out, 8, 9, Some("sam"));
            job_group(out, 9, 5, None);
        });
        let jobs = decode(&bytes, "alex").expect("decodes");
        assert!(!jobs.truncated);
        assert_eq!(
            jobs.jobs,
            vec![
                RawPrintJob {
                    id: 7,
                    owner: RawJobOwner::Candidate,
                    active: true
                },
                RawPrintJob {
                    id: 8,
                    owner: RawJobOwner::Other,
                    active: false
                },
                RawPrintJob {
                    id: 9,
                    owner: RawJobOwner::Unknown,
                    active: true
                },
            ]
        );
    }

    #[test]
    fn a_language_tagged_owner_is_compared_by_name() {
        let bytes = response(0, |out| {
            out.push(TAG_JOB);
            attribute(out, TAG_INTEGER, "job-id", &4_u32.to_be_bytes());
            let mut value = Vec::new();
            value.extend_from_slice(&2_u16.to_be_bytes());
            value.extend_from_slice(b"en");
            value.extend_from_slice(&4_u16.to_be_bytes());
            value.extend_from_slice(b"alex");
            attribute(
                out,
                TAG_NAME_WITH_LANGUAGE,
                "job-originating-user-name",
                &value,
            );
        });
        let jobs = decode(&bytes, "alex").expect("decodes");
        assert_eq!(jobs.jobs[0].owner, RawJobOwner::Candidate);
        assert!(!jobs.jobs[0].active, "a job without a state is not active");
    }

    #[test]
    fn no_jobs_is_an_empty_read_and_an_error_is_none() {
        assert_eq!(
            decode(&response(STATUS_NOT_FOUND, |_| {}), "alex").map(|jobs| jobs.jobs.len()),
            Some(0)
        );
        assert_eq!(decode(&response(0x0401, |_| {}), "alex"), None);
        assert_eq!(
            decode(&[2, 0, 0], "alex"),
            None,
            "a short response is malformed"
        );
        let mut cut = response(0, |out| job_group(out, 1, 3, Some("alex")));
        cut.truncate(cut.len() - 6);
        assert_eq!(decode(&cut, "alex"), None, "a cut response is malformed");
    }

    #[test]
    fn the_request_asks_for_three_attributes_only() {
        let body = request("alex");
        let text = String::from_utf8_lossy(&body);
        for wanted in [
            "job-id",
            "job-state",
            "job-originating-user-name",
            "which-jobs",
            "all",
        ] {
            assert!(text.contains(wanted), "{wanted}");
        }
        for never in [
            "job-name",
            "printer-name",
            "document-name",
            "job-originating-host-name",
        ] {
            assert!(!text.contains(never), "{never}");
        }
        assert_eq!(body.last(), Some(&TAG_END));
    }

    #[test]
    fn plain_and_chunked_http_bodies_are_read() {
        assert_eq!(
            http_body(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc").as_deref(),
            Some(&b"abc"[..])
        );
        assert_eq!(
            http_body(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n1\r\nc\r\n0\r\n\r\n")
                .as_deref(),
            Some(&b"abc"[..])
        );
        assert_eq!(http_body(b"HTTP/1.1 403 Forbidden\r\n\r\n"), None);
        assert_eq!(
            http_body(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nff\r\nab"),
            None,
            "a cut chunk is malformed"
        );
    }

    /// Real OS: the local scheduler answers. Nothing is printed.
    #[test]
    fn the_local_scheduler_answers_a_job_query() {
        if !SOCKETS.iter().any(|socket| Path::new(socket).exists()) {
            return;
        }
        assert!(
            jobs().is_some(),
            "the scheduler socket exists, so the query answers"
        );
    }
}
