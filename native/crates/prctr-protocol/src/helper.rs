//! Messages between the native agent and the privileged helper (the Windows service, the macOS
//! Endpoint Security daemon). The helper reports raw OS facts only: it never evaluates rules, and
//! it never sends paths, command lines, user names, account IDs or another user's processes.
//!
//! The agent connects, sends `hello`, then `subscribe`. The helper observes only while at least
//! one authenticated agent is subscribed.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::scalars::{CodeText, Count, Digest};

/// The most processes one snapshot may carry.
pub const MAX_SNAPSHOT_PROCESSES: usize = 8_192;
/// The most sessions one session report may carry.
pub const MAX_SESSIONS: usize = 256;

/// What the agent sends.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentToHelper {
    /// The first message, exactly once.
    Hello { protocol_digest: Digest },
    /// Start or change what the helper reports. Each newly enabled stream begins with a snapshot.
    Subscribe { processes: bool, sessions: bool },
}

/// What the helper sends.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HelperToAgent {
    /// The handshake succeeded.
    Welcome {
        helper_version: CodeText,
    },
    /// The helper will not serve this connection; it closes it after this message.
    Refused {
        code: HelperRefusal,
    },
    /// Every process the agent may see, observed after the event stream started, so no process
    /// falls between the snapshot and the events that follow it.
    ProcessSnapshot {
        processes: Vec<HelperProcess>,
    },
    ProcessStarted {
        process: HelperProcess,
    },
    /// A process reported with a `pending` identity has been verified.
    ProcessIdentified {
        instance: Count,
        identity: HelperIdentity,
    },
    ProcessExited {
        instance: Count,
    },
    /// The complete current session state, sent first and on every change.
    Sessions(HelperSessions),
    /// Events were lost: the helper follows with fresh snapshots of the affected streams.
    Lost {
        reason: HelperLoss,
    },
    /// Sent every second while subscribed, so a stalled helper is detected.
    Heartbeat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HelperRefusal {
    /// The agent's protocol digest differs from the helper's.
    ProtocolMismatch,
    /// The connecting process is not this release's agent.
    UnauthorizedPeer,
    /// A message arrived out of order or was invalid.
    InvalidMessage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HelperLoss {
    /// The OS event stream dropped events (ETW buffers, Endpoint Security queue).
    EventsDropped,
    /// The helper's queue to this agent overflowed.
    QueueOverflow,
    /// The OS event source stopped and was restarted.
    SourceRestarted,
}

/// One process. `instance` is unique for the process's lifetime (derived from its ID and start
/// time); process IDs alone are reused.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HelperProcess {
    pub instance: Count,
    pub pid: Count,
    /// The parent's `instance`, when the parent is still known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Count>,
    pub scope: ProcessScope,
    pub identity: HelperIdentity,
}

/// Where a process runs, relative to the connected agent. Processes in another user's session
/// are never reported.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProcessScope {
    /// The agent's own interactive session.
    CandidateSession,
    /// A system or service process (Windows session 0 or a service account; macOS root or a
    /// system account outside any user session).
    System,
}

/// A process's code identity. Paths and process names are never identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HelperIdentity {
    /// Still being verified; a `process_identified` follows.
    Pending,
    /// A macOS code signature.
    MacOs {
        signing_identifier: CodeText,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        team_id: Option<CodeText>,
        /// The signature satisfies `anchor apple`.
        apple: bool,
    },
    /// A Windows Authenticode or catalog signer and the version resource's original file name.
    Windows {
        publisher: CodeText,
        original_file_name: CodeText,
    },
    /// The code has no valid signature.
    Unsigned,
    /// The identity could not be read.
    Unavailable,
}

/// Every interactive session on the machine, as states only: no user names or account IDs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HelperSessions {
    /// The session attached to the physical console, when one is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub console: Option<Count>,
    /// The agent's own session.
    pub own: Count,
    pub sessions: Vec<HelperSession>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HelperSession {
    pub id: Count,
    pub state: SessionState,
    /// A person is signed in to this session.
    pub has_user: bool,
    /// Viewed or controlled remotely: a remote-desktop protocol session on Windows, or screen
    /// sharing attached on macOS.
    pub remote: bool,
    /// `None` when the OS does not report the lock state of this session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    /// Attached to a display and accepting input.
    Active,
    /// Signed in but not attached to any display.
    Disconnected,
    /// Any other state (listening, idle, being reset): no person is using it.
    Other,
}

impl HelperToAgent {
    /// Whether the message stays within the protocol's bounds.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        match self {
            Self::ProcessSnapshot { processes } => processes.len() <= MAX_SNAPSHOT_PROCESSES,
            Self::Sessions(sessions) => sessions.sessions.len() <= MAX_SESSIONS,
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{Decoder, encode};

    fn count(value: u64) -> Count {
        Count::new(value).expect("small count")
    }

    fn text(value: &str) -> CodeText {
        CodeText::new(value).expect("valid text")
    }

    fn round_trip(message: &HelperToAgent) -> HelperToAgent {
        let frame = encode(message).expect("encodes");
        let mut decoder = Decoder::new();
        decoder.push(&frame);
        decoder
            .next_message::<HelperToAgent>()
            .expect("decodes")
            .expect("complete")
    }

    #[test]
    fn every_helper_message_round_trips_through_a_frame() {
        let process = HelperProcess {
            instance: count(41),
            pid: count(4242),
            parent: Some(count(7)),
            scope: ProcessScope::System,
            identity: HelperIdentity::Windows {
                publisher: text("Microsoft Windows"),
                original_file_name: text("svchost.exe"),
            },
        };
        let messages = [
            HelperToAgent::Welcome {
                helper_version: text("0.1.0"),
            },
            HelperToAgent::Refused {
                code: HelperRefusal::UnauthorizedPeer,
            },
            HelperToAgent::ProcessSnapshot {
                processes: vec![process.clone()],
            },
            HelperToAgent::ProcessStarted { process },
            HelperToAgent::ProcessIdentified {
                instance: count(41),
                identity: HelperIdentity::MacOs {
                    signing_identifier: text("com.apple.Safari"),
                    team_id: None,
                    apple: true,
                },
            },
            HelperToAgent::ProcessExited {
                instance: count(41),
            },
            HelperToAgent::Sessions(HelperSessions {
                console: Some(count(1)),
                own: count(1),
                sessions: vec![HelperSession {
                    id: count(1),
                    state: SessionState::Active,
                    has_user: true,
                    remote: false,
                    locked: Some(false),
                }],
            }),
            HelperToAgent::Lost {
                reason: HelperLoss::EventsDropped,
            },
            HelperToAgent::Heartbeat,
        ];
        for message in messages {
            assert_eq!(round_trip(&message), message);
        }
    }

    #[test]
    fn the_agent_side_has_a_fixed_shape() {
        let hello = serde_json::to_value(AgentToHelper::Subscribe {
            processes: true,
            sessions: false,
        })
        .expect("serializes");
        assert_eq!(
            hello,
            serde_json::json!({ "kind": "subscribe", "processes": true, "sessions": false })
        );
    }

    #[test]
    fn unknown_kinds_fields_and_identities_are_refused() {
        for invalid in [
            r#"{"kind":"process_exited","instance":1,"path":"C:\\x.exe"}"#,
            r#"{"kind":"process_exited"}"#,
            r#"{"kind":"command_line","instance":1}"#,
            r#"{"kind":"process_identified","instance":1,"identity":{"kind":"path","value":"x"}}"#,
            r#"{"kind":"sessions","own":1,"sessions":[{"id":1,"state":"active","has_user":true,"remote":false,"user":"x"}]}"#,
            r#"{"kind":"process_identified","instance":1,"identity":{"kind":"windows","publisher":"","original_file_name":"a"}}"#,
        ] {
            assert!(
                serde_json::from_str::<HelperToAgent>(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        assert!(serde_json::from_str::<AgentToHelper>(r#"{"kind":"unsubscribe_all"}"#).is_err());
    }

    #[test]
    fn oversized_reports_are_out_of_bounds() {
        let process = HelperProcess {
            instance: count(1),
            pid: count(1),
            parent: None,
            scope: ProcessScope::CandidateSession,
            identity: HelperIdentity::Pending,
        };
        let large = HelperToAgent::ProcessSnapshot {
            processes: vec![process; MAX_SNAPSHOT_PROCESSES + 1],
        };
        assert!(!large.is_bounded());
        assert!(HelperToAgent::Heartbeat.is_bounded());
    }
}
