use crate::helper::{ProcessStart, timeval_to_unix};
use crate::{OsError, RawIdentity};
use endpoint_sec_sys as es;
use es::es_event_type_t as T;
use std::ptr::NonNull;
use std::sync::{Mutex, mpsc};

#[derive(Clone, Debug)]
pub enum Event {
    /// `None` when the event cannot settle the identity on its own (see [`identity`]); the
    /// helper then verifies it like a snapshot process.
    Started(ProcessStart, Option<RawIdentity>),
    Stopped {
        pid: u32,
        created: u64,
    },
    Lost,
    /// Correlate login-window users without conflating graphical and audit session IDs.
    Lock {
        user_key: u64,
        locked: bool,
    },
    Sharing {
        graphical: u32,
        attached: bool,
        user_key: Option<u64>,
    },
    SessionsChanged,
    SessionUserChanged {
        user_key: u64,
    },
}

pub struct Watch {
    stop: mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Watch {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// ES client creation/deletion stays on one owner thread. Only NOTIFY events are subscribed;
/// this observer never authorizes or denies an operating-system action.
/// # Errors
/// Returns the numeric ES creation/subscription or thread creation error.
pub fn watch(processes: bool, sink: Box<dyn Fn(Event) + Send + Sync>) -> Result<Watch, OsError> {
    let (ready, startup) = mpsc::sync_channel(1);
    let (stop, shutdown) = mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("prctr-endpoint-security".into())
        .spawn(move || {
            let sequence = Mutex::new(None::<u64>);
            let handler = block2::RcBlock::new(
                move |_client: NonNull<es::es_client_t>, message: NonNull<es::es_message_t>| {
                    // SAFETY: ES guarantees this message is valid for the duration of this callback.
                    let message = unsafe { message.as_ref() };
                    if message.version < 4 {
                        sink(Event::Lost);
                        return;
                    }
                    if let Ok(mut previous) = sequence.lock() {
                        if previous
                            .is_some_and(|last| last.checked_add(1) != Some(message.global_seq_num))
                            || (previous.is_none() && message.global_seq_num != 0)
                        {
                            sink(Event::Lost);
                        }
                        *previous = Some(message.global_seq_num);
                    } else {
                        sink(Event::Lost);
                        return;
                    }
                    sink(decode(message).unwrap_or(Event::Lost));
                },
            );
            let mut client = std::ptr::null_mut();
            // SAFETY: client is a writable output; handler stays alive until the client is deleted.
            let status = unsafe { es::es_new_client(&raw mut client, &handler) };
            if status != es::es_new_client_result_t::ES_NEW_CLIENT_RESULT_SUCCESS
                || client.is_null()
            {
                let _ = ready.send(Err(OsError {
                    operation: "es_new_client",
                    status: i64::from(status.0),
                }));
                return;
            }
            // SAFETY: this newly created client is live; remove default executable path muting.
            let unmuted = unsafe { es::es_unmute_all_paths(client) };
            // SAFETY: the same live client supports target-path unmuting on macOS 13 and later.
            let targets_unmuted = unsafe { es::es_unmute_all_target_paths(client) };
            if unmuted != es::es_return_t::ES_RETURN_SUCCESS
                || targets_unmuted != es::es_return_t::ES_RETURN_SUCCESS
            {
                let _ = ready.send(Err(OsError {
                    operation: "es_unmute_all_paths",
                    status: -1,
                }));
                // SAFETY: cleanup remains on the client's creation thread.
                let _ = unsafe { es::es_delete_client(client) };
                return;
            }
            let types = subscriptions(processes);
            // SAFETY: client is live; types is initialized for the declared bounded count.
            let status = unsafe {
                es::es_subscribe(
                    client,
                    types.as_ptr(),
                    u32::try_from(types.len()).unwrap_or(0),
                )
            };
            if status == es::es_return_t::ES_RETURN_SUCCESS {
                if ready.send(Ok(())).is_ok() {
                    let _ = shutdown.recv();
                }
            } else {
                let _ = ready.send(Err(OsError {
                    operation: "es_subscribe",
                    status: i64::from(status.0),
                }));
            }
            // SAFETY: deleting this live client stops callbacks; this is its creation thread.
            let _ = unsafe { es::es_delete_client(client) };
        })
        .map_err(|error| OsError {
            operation: "ES thread",
            status: i64::from(error.raw_os_error().unwrap_or(-1)),
        })?;
    match startup.recv() {
        Ok(Ok(())) => Ok(Watch {
            stop,
            thread: Some(thread),
        }),
        result => {
            let _ = stop.send(());
            let _ = thread.join();
            Err(result.ok().and_then(Result::err).unwrap_or(OsError {
                operation: "ES startup",
                status: -1,
            }))
        }
    }
}

fn process(raw: &es::es_process_t) -> Option<ProcessStart> {
    Some(ProcessStart {
        pid: raw.audit_token.val[5],
        parent: u32::try_from(raw.ppid).ok()?,
        session: super::normalize_session(raw.audit_token.val[6]),
        created: timeval_to_unix(
            u64::try_from(raw.start_time.tv_sec).ok()?,
            u64::try_from(raw.start_time.tv_usec).ok()?,
        )?,
    })
}
fn text(token: &es::es_string_token_t) -> Option<String> {
    if token.length == 0 || token.length > 512 || token.data.is_null() {
        return None;
    }
    // SAFETY: ES supplies this bounded string's allocation for the lifetime of the message.
    let bytes = unsafe { std::slice::from_raw_parts(token.data.cast::<u8>(), token.length) };
    std::str::from_utf8(bytes).ok().map(str::to_owned)
}
/// The identity from the event itself. `apple` means the code satisfies `anchor apple`, as in a
/// snapshot's identity: a platform binary always does, and code with a Team ID never does. Signed
/// code with neither is answered `None`, so the helper checks the anchor the same way a snapshot
/// does instead of guessing.
fn identity(raw: &es::es_process_t) -> Option<RawIdentity> {
    // CS_VALID: a signed identity with invalid code pages must not be treated as verified.
    if raw.codesigning_flags & 1 == 0 {
        return Some(RawIdentity::Unsigned);
    }
    let Some(signing_identifier) = text(&raw.signing_id) else {
        return Some(RawIdentity::Unsigned);
    };
    let team_id = text(&raw.team_id);
    if !raw.is_platform_binary && team_id.is_none() {
        return None;
    }
    Some(RawIdentity::MacOs {
        signing_identifier,
        apple: raw.is_platform_binary,
        team_id,
    })
}
fn decode(message: &es::es_message_t) -> Option<Event> {
    match message.event_type {
        T::ES_EVENT_TYPE_NOTIFY_EXEC => {
            // SAFETY: event_type selects the exec union member.
            let event = unsafe { &message.event.exec };
            // SAFETY: ES owns target for this message's lifetime; null is handled.
            let target = unsafe { event.target.as_opt() }?;
            Some(Event::Started(process(target)?, identity(target)))
        }
        T::ES_EVENT_TYPE_NOTIFY_FORK => {
            // SAFETY: event_type selects the fork union member.
            let event = unsafe { &message.event.fork };
            // SAFETY: ES owns child for this message's lifetime; null is handled.
            let child = unsafe { event.child.as_opt() }?;
            Some(Event::Started(process(child)?, identity(child)))
        }
        T::ES_EVENT_TYPE_NOTIFY_EXIT => {
            // SAFETY: the message process belongs to ES and lives throughout this callback.
            let start = process(unsafe { message.process.as_opt() }?)?;
            Some(Event::Stopped {
                pid: start.pid,
                created: start.created,
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOCK => {
            // SAFETY: event_type selects the lock union member.
            let pointer = unsafe { message.event.lw_session_lock };
            // SAFETY: the selected event belongs to this live message; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            Some(Event::Lock {
                user_key: crate::fingerprint(text(&event.username)?.as_bytes()),
                locked: true,
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_UNLOCK => {
            // SAFETY: event_type selects the unlock union member.
            let pointer = unsafe { message.event.lw_session_unlock };
            // SAFETY: the selected event belongs to this live message; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            Some(Event::Lock {
                user_key: crate::fingerprint(text(&event.username)?.as_bytes()),
                locked: false,
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_SCREENSHARING_ATTACH => {
            // SAFETY: event_type selects the attach union member.
            let pointer = unsafe { message.event.screensharing_attach };
            // SAFETY: the selected event belongs to this live message; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            if !event.success {
                return Some(Event::SessionsChanged);
            }
            Some(Event::Sharing {
                graphical: event.graphical_session_id,
                attached: true,
                user_key: text(&event.session_username)
                    .map(|name| crate::fingerprint(name.as_bytes())),
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_SCREENSHARING_DETACH => {
            // SAFETY: event_type selects the detach union member.
            let pointer = unsafe { message.event.screensharing_detach };
            // SAFETY: the selected event belongs to this live message; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            Some(Event::Sharing {
                graphical: event.graphical_session_id,
                attached: false,
                user_key: None,
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGIN => {
            // SAFETY: event_type selects the login union member.
            let pointer = unsafe { message.event.lw_session_login };
            // SAFETY: the selected event lives through this callback; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            Some(Event::SessionUserChanged {
                user_key: crate::fingerprint(text(&event.username)?.as_bytes()),
            })
        }
        T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGOUT => {
            // SAFETY: event_type selects the logout union member.
            let pointer = unsafe { message.event.lw_session_logout };
            // SAFETY: the selected event lives through this callback; null is handled.
            let event = unsafe { pointer.as_opt() }?;
            Some(Event::SessionUserChanged {
                user_key: crate::fingerprint(text(&event.username)?.as_bytes()),
            })
        }
        _ => None,
    }
}

fn subscriptions(processes: bool) -> Vec<T> {
    if processes {
        vec![
            T::ES_EVENT_TYPE_NOTIFY_EXEC,
            T::ES_EVENT_TYPE_NOTIFY_FORK,
            T::ES_EVENT_TYPE_NOTIFY_EXIT,
        ]
    } else {
        vec![
            T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGIN,
            T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGOUT,
            T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOCK,
            T::ES_EVENT_TYPE_NOTIFY_LW_SESSION_UNLOCK,
            T::ES_EVENT_TYPE_NOTIFY_SCREENSHARING_ATTACH,
            T::ES_EVENT_TYPE_NOTIFY_SCREENSHARING_DETACH,
        ]
    }
}
