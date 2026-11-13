//! One agent connection: `hello` with the matching protocol digest first, then any number of
//! `subscribe` messages. Anything else closes the connection with a refusal.

use prctr_protocol::helper::{AgentToHelper, HelperRefusal, HelperToAgent};
use prctr_protocol::scalars::CodeText;

/// What the agent currently wants reported.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Subscription {
    pub processes: bool,
    pub sessions: bool,
}

impl Subscription {
    #[must_use]
    pub const fn any(self) -> bool {
        self.processes || self.sessions
    }
}

/// The result of one agent message.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// Send this reply and keep the connection.
    Reply(HelperToAgent),
    /// The subscription changed: send snapshots for the streams that were just enabled.
    Subscribed {
        now: Subscription,
        newly: Subscription,
    },
    /// Send this refusal and close the connection.
    Close(HelperToAgent),
}

#[derive(Debug, Default)]
pub struct Connection {
    welcomed: bool,
    subscription: Subscription,
}

fn refuse(code: HelperRefusal) -> Step {
    Step::Close(HelperToAgent::Refused { code })
}

impl Connection {
    #[must_use]
    pub fn subscription(&self) -> Subscription {
        self.subscription
    }

    /// Handles one decoded message from the agent.
    pub fn receive(&mut self, message: AgentToHelper, digest: &str) -> Step {
        match (self.welcomed, message) {
            (false, AgentToHelper::Hello { protocol_digest }) => {
                if protocol_digest.as_str() != digest.trim() {
                    return refuse(HelperRefusal::ProtocolMismatch);
                }
                self.welcomed = true;
                match CodeText::new(crate::VERSION) {
                    Ok(helper_version) => Step::Reply(HelperToAgent::Welcome { helper_version }),
                    Err(_) => refuse(HelperRefusal::InvalidMessage),
                }
            }
            (
                true,
                AgentToHelper::Subscribe {
                    processes,
                    sessions,
                },
            ) => {
                let before = self.subscription;
                self.subscription = Subscription {
                    processes,
                    sessions,
                };
                Step::Subscribed {
                    now: self.subscription,
                    newly: Subscription {
                        processes: processes && !before.processes,
                        sessions: sessions && !before.sessions,
                    },
                }
            }
            _ => refuse(HelperRefusal::InvalidMessage),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prctr_protocol::scalars::Digest;

    const DIGEST: &str = "00000000000000000000000000000000000000000000000000000000000000aa";

    fn hello(value: &str) -> AgentToHelper {
        AgentToHelper::Hello {
            protocol_digest: Digest::new(value).expect("valid digest"),
        }
    }

    #[test]
    fn a_matching_hello_is_welcomed_and_then_subscriptions_report_what_is_new() {
        let mut connection = Connection::default();
        assert!(matches!(
            connection.receive(hello(DIGEST), &format!("{DIGEST}\n")),
            Step::Reply(HelperToAgent::Welcome { .. })
        ));
        let first = connection.receive(
            AgentToHelper::Subscribe {
                processes: true,
                sessions: false,
            },
            DIGEST,
        );
        assert_eq!(
            first,
            Step::Subscribed {
                now: Subscription {
                    processes: true,
                    sessions: false
                },
                newly: Subscription {
                    processes: true,
                    sessions: false
                },
            }
        );
        let second = connection.receive(
            AgentToHelper::Subscribe {
                processes: true,
                sessions: true,
            },
            DIGEST,
        );
        assert_eq!(
            second,
            Step::Subscribed {
                now: Subscription {
                    processes: true,
                    sessions: true
                },
                newly: Subscription {
                    processes: false,
                    sessions: true
                },
            }
        );
    }

    #[test]
    fn a_wrong_digest_a_second_hello_or_an_early_subscribe_closes_the_connection() {
        let mut mismatch = Connection::default();
        assert_eq!(
            mismatch.receive(
                hello("00000000000000000000000000000000000000000000000000000000000000bb"),
                DIGEST
            ),
            refuse(HelperRefusal::ProtocolMismatch)
        );
        let mut early = Connection::default();
        assert_eq!(
            early.receive(
                AgentToHelper::Subscribe {
                    processes: true,
                    sessions: true
                },
                DIGEST
            ),
            refuse(HelperRefusal::InvalidMessage)
        );
        let mut twice = Connection::default();
        let _ = twice.receive(hello(DIGEST), DIGEST);
        assert_eq!(
            twice.receive(hello(DIGEST), DIGEST),
            refuse(HelperRefusal::InvalidMessage)
        );
    }
}
