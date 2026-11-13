//! The release-owned application catalog. It is compiled into the agent, so it is covered by the
//! release's code signature, and its application IDs are published in the registry so the server
//! can validate rules. Identities are matched on the device and never leave it.
//!
//! This is a seed: every identity must be certified on real installations before release, and a
//! catalog change is a release change.
//! Contract: `docs/architecture/native-capability-families.md`, "Process and application".

use prctr_core::RegisteredApplication;
use prctr_os::RawIdentity;
use prctr_protocol::scalars::Identifier;

/// Whether an allowlist may name an application.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Allowable,
    /// Shells, interpreters, automation hosts, remote-control and capture tools, local servers.
    NeverAllowable,
}

/// One way an application identifies itself on a platform.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Identity {
    /// A macOS signing identifier; `team_id` is `None` for Apple's own code, which must then
    /// satisfy `anchor apple`.
    MacOs {
        signing_identifier: &'static str,
        team_id: Option<&'static str>,
    },
    /// A Windows Authenticode publisher and original file name, compared without case.
    Windows {
        publisher: &'static str,
        original_file_name: &'static str,
    },
    /// A Linux executable file name: weak, because Linux has no code identity.
    Linux { executable: &'static str },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CatalogApp {
    pub id: &'static str,
    pub class: Class,
    pub identities: &'static [Identity],
}

const fn mac(signing_identifier: &'static str, team_id: Option<&'static str>) -> Identity {
    Identity::MacOs {
        signing_identifier,
        team_id,
    }
}

const fn win(publisher: &'static str, original_file_name: &'static str) -> Identity {
    Identity::Windows {
        publisher,
        original_file_name,
    }
}

const fn linux(executable: &'static str) -> Identity {
    Identity::Linux { executable }
}

const MICROSOFT_WINDOWS: &str = "Microsoft Windows";
const MICROSOFT: &str = "Microsoft Corporation";

/// The seed catalog.
pub const APPS: &[CatalogApp] = &[
    CatalogApp {
        id: "terminal",
        class: Class::NeverAllowable,
        identities: &[
            mac("com.apple.Terminal", None),
            mac("com.googlecode.iterm2", Some("H7V7XYVQ7D")),
            win(MICROSOFT, "WindowsTerminal.exe"),
            win(MICROSOFT_WINDOWS, "Cmd.Exe"),
            win(MICROSOFT_WINDOWS, "PowerShell.EXE"),
            win(MICROSOFT_WINDOWS, "conhost.exe"),
            linux("gnome-terminal-server"),
            linux("konsole"),
            linux("xterm"),
            linux("kitty"),
            linux("alacritty"),
        ],
    },
    CatalogApp {
        id: "script_editor",
        class: Class::NeverAllowable,
        identities: &[
            mac("com.apple.ScriptEditor2", None),
            mac("com.apple.Automator", None),
        ],
    },
    CatalogApp {
        id: "screen_sharing",
        class: Class::NeverAllowable,
        identities: &[
            mac("com.apple.ScreenSharing", None),
            win(MICROSOFT_WINDOWS, "mstsc.exe"),
        ],
    },
    CatalogApp {
        id: "quicktime_player",
        class: Class::NeverAllowable,
        identities: &[mac("com.apple.QuickTimePlayerX", None)],
    },
    CatalogApp {
        id: "teamviewer",
        class: Class::NeverAllowable,
        identities: &[
            mac("com.teamviewer.TeamViewer", Some("H7UGFBUGV6")),
            win("TeamViewer Germany GmbH", "TeamViewer.exe"),
            linux("teamviewer"),
        ],
    },
    CatalogApp {
        id: "zoom",
        class: Class::NeverAllowable,
        identities: &[
            mac("us.zoom.xos", Some("BJ4HAAB9B3")),
            win("Zoom Video Communications, Inc.", "Zoom.exe"),
            linux("zoom"),
        ],
    },
    CatalogApp {
        id: "discord",
        class: Class::Allowable,
        identities: &[
            mac("com.hnc.Discord", Some("53Q6R32WPB")),
            win("Discord Inc.", "Discord.exe"),
            linux("Discord"),
        ],
    },
    CatalogApp {
        id: "slack",
        class: Class::Allowable,
        identities: &[
            mac("com.tinyspeck.slackmacgap", Some("BQR82RBBHL")),
            win("Slack Technologies, LLC", "slack.exe"),
            linux("slack"),
        ],
    },
    CatalogApp {
        id: "visual_studio_code",
        class: Class::Allowable,
        identities: &[
            mac("com.microsoft.VSCode", Some("UBF8T346G9")),
            win(MICROSOFT, "Code.exe"),
            linux("code"),
        ],
    },
    CatalogApp {
        id: "google_chrome",
        class: Class::Allowable,
        identities: &[
            mac("com.google.Chrome", Some("EQHXZ8M8AV")),
            win("Google LLC", "chrome.exe"),
            linux("chrome"),
        ],
    },
    CatalogApp {
        id: "firefox",
        class: Class::Allowable,
        identities: &[
            mac("org.mozilla.firefox", Some("43AQ936H96")),
            win("Mozilla Corporation", "firefox.exe"),
            linux("firefox"),
        ],
    },
    CatalogApp {
        id: "safari",
        class: Class::Allowable,
        identities: &[mac("com.apple.Safari", None)],
    },
];

/// Linux session processes that are part of the desktop rather than applications.
const LINUX_ESSENTIAL: &[&str] = &[
    "systemd",
    "dbus-daemon",
    "dbus-broker",
    "gnome-shell",
    "gnome-session-binary",
    "plasmashell",
    "kwin_wayland",
    "kwin_x11",
    "Xwayland",
    "Xorg",
    "pipewire",
    "pipewire-pulse",
    "wireplumber",
    "pulseaudio",
    "xdg-desktop-portal",
    "at-spi-bus-launcher",
    "at-spi2-registryd",
];

/// What a process is, for rule matching.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Classified {
    App(&'static CatalogApp),
    /// Part of the operating system: never counts against an allowlist.
    OsEssential,
    /// Identified, but not in the catalog.
    Unlisted,
    /// No usable identity: outside every allowlist, and matches no blocklist.
    Unidentified,
}

fn matches(identity: &Identity, raw: &RawIdentity) -> bool {
    match (identity, raw) {
        (
            Identity::MacOs {
                signing_identifier,
                team_id,
            },
            RawIdentity::MacOs {
                signing_identifier: raw_identifier,
                team_id: raw_team,
                apple,
            },
        ) => {
            signing_identifier == raw_identifier
                && match team_id {
                    Some(team) => raw_team.as_deref() == Some(*team),
                    None => *apple && raw_team.is_none(),
                }
        }
        (
            Identity::Windows {
                publisher,
                original_file_name,
            },
            RawIdentity::Windows {
                publisher: raw_publisher,
                original_file_name: raw_name,
            },
        ) => publisher == raw_publisher && original_file_name.eq_ignore_ascii_case(raw_name),
        (Identity::Linux { executable }, RawIdentity::Linux { executable: raw }) => {
            executable == raw
        }
        _ => false,
    }
}

/// Classifies one identity. Apple-anchored code and code Microsoft signs as Windows are part of
/// the OS unless the catalog lists them, so the catalog must list every such application a
/// candidate could use.
#[must_use]
pub fn classify(raw: &RawIdentity) -> Classified {
    if let Some(app) = APPS
        .iter()
        .find(|app| app.identities.iter().any(|identity| matches(identity, raw)))
    {
        return Classified::App(app);
    }
    match raw {
        RawIdentity::MacOs {
            team_id: None,
            apple: true,
            ..
        } => Classified::OsEssential,
        RawIdentity::Windows { publisher, .. } if publisher == MICROSOFT_WINDOWS => {
            Classified::OsEssential
        }
        RawIdentity::Linux { executable } if LINUX_ESSENTIAL.contains(&executable.as_str()) => {
            Classified::OsEssential
        }
        RawIdentity::MacOs { .. } | RawIdentity::Windows { .. } | RawIdentity::Linux { .. } => {
            Classified::Unlisted
        }
        RawIdentity::Unsigned | RawIdentity::Unavailable => Classified::Unidentified,
    }
}

/// The catalog as the registry publishes it.
///
/// # Panics
/// Never: a test checks that every catalog ID is a valid identifier.
#[must_use]
pub fn registered() -> Vec<RegisteredApplication> {
    APPS.iter()
        .map(|app| RegisteredApplication {
            id: Identifier::new(app.id).expect("catalog identifier is valid"),
            allowable: app.class == Class::Allowable,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    fn macos(identifier: &str, team: Option<&str>, apple: bool) -> RawIdentity {
        RawIdentity::MacOs {
            signing_identifier: identifier.to_owned(),
            team_id: team.map(str::to_owned),
            apple,
        }
    }

    #[test]
    fn catalog_ids_are_unique_and_valid() {
        let ids: BTreeSet<_> = APPS.iter().map(|app| app.id).collect();
        assert_eq!(ids.len(), APPS.len());
        assert_eq!(registered().len(), APPS.len());
    }

    #[test]
    fn a_signed_application_matches_only_with_its_team() {
        assert!(matches!(
            classify(&macos("us.zoom.xos", Some("BJ4HAAB9B3"), false)),
            Classified::App(app) if app.id == "zoom"
        ));
        assert_eq!(
            classify(&macos("us.zoom.xos", Some("ZZZZZZZZZZ"), false)),
            Classified::Unlisted,
            "a re-signed copy is not the catalog application"
        );
    }

    #[test]
    fn apple_code_is_essential_unless_listed_and_must_be_anchored() {
        assert!(matches!(
            classify(&macos("com.apple.Terminal", None, true)),
            Classified::App(app) if app.id == "terminal"
        ));
        assert_eq!(
            classify(&macos("com.apple.WindowServer", None, true)),
            Classified::OsEssential
        );
        assert_eq!(
            classify(&macos("com.apple.Terminal", None, false)),
            Classified::Unlisted,
            "an identifier claiming to be Apple's without Apple's anchor is not Terminal"
        );
    }

    #[test]
    fn windows_matches_publisher_and_file_name_without_case() {
        let raw = RawIdentity::Windows {
            publisher: MICROSOFT_WINDOWS.to_owned(),
            original_file_name: "cmd.exe".to_owned(),
        };
        assert!(matches!(classify(&raw), Classified::App(app) if app.id == "terminal"));
        let explorer = RawIdentity::Windows {
            publisher: MICROSOFT_WINDOWS.to_owned(),
            original_file_name: "EXPLORER.EXE".to_owned(),
        };
        assert_eq!(classify(&explorer), Classified::OsEssential);
    }

    #[test]
    fn missing_identity_is_unidentified() {
        assert_eq!(classify(&RawIdentity::Unsigned), Classified::Unidentified);
        assert_eq!(
            classify(&RawIdentity::Unavailable),
            Classified::Unidentified
        );
    }

    #[test]
    fn terminals_and_remote_tools_are_never_allowable() {
        for id in [
            "terminal",
            "script_editor",
            "screen_sharing",
            "teamviewer",
            "zoom",
        ] {
            let app = APPS.iter().find(|app| app.id == id).expect("listed");
            assert_eq!(app.class, Class::NeverAllowable, "{id}");
        }
    }
}
