//! Bounded scalar types shared by every message. Each one rejects invalid values when it is
//! constructed or deserialized, so a value that exists is valid.

use std::borrow::Cow;
use std::fmt;

use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The largest integer JavaScript can represent exactly; every count stays at or below it.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// A value was outside the bounds of its scalar type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidScalar {
    kind: &'static str,
}

impl InvalidScalar {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        self.kind
    }
}

impl fmt::Display for InvalidScalar {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid {}", self.kind)
    }
}

impl std::error::Error for InvalidScalar {}

/// A non-negative integer that JavaScript can represent exactly: sequences, counts, times.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Count(u64);

impl Count {
    pub const ZERO: Self = Self(0);

    /// # Errors
    /// Returns an error when `value` exceeds [`MAX_SAFE_INTEGER`].
    pub const fn new(value: u64) -> Result<Self, InvalidScalar> {
        if value > MAX_SAFE_INTEGER {
            Err(InvalidScalar { kind: "count" })
        } else {
            Ok(Self(value))
        }
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The next value, saturating at [`MAX_SAFE_INTEGER`].
    #[must_use]
    pub const fn next(self) -> Self {
        if self.0 >= MAX_SAFE_INTEGER {
            self
        } else {
            Self(self.0 + 1)
        }
    }

    /// Adds `amount`, saturating at [`MAX_SAFE_INTEGER`].
    #[must_use]
    pub fn saturating_add(self, amount: u64) -> Self {
        Self(self.0.saturating_add(amount).min(MAX_SAFE_INTEGER))
    }
}

impl Serialize for Count {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(self.0)
    }
}

impl<'de> Deserialize<'de> for Count {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = u64::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

impl JsonSchema for Count {
    fn schema_name() -> Cow<'static, str> {
        "Count".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_SAFE_INTEGER })
    }
}

macro_rules! bounded_string {
    ($(#[$doc:meta])* $name:ident, $kind:literal, $schema_name:literal, $pattern:literal, $valid:expr) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            /// # Errors
            /// Returns an error when `value` does not match the type's pattern.
            pub fn new(value: impl Into<String>) -> Result<Self, InvalidScalar> {
                let value = value.into();
                let valid: fn(&str) -> bool = $valid;
                if valid(&value) {
                    Ok(Self(value))
                } else {
                    Err(InvalidScalar { kind: $kind })
                }
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let value = String::deserialize(deserializer)?;
                Self::new(value).map_err(serde::de::Error::custom)
            }
        }

        impl JsonSchema for $name {
            fn schema_name() -> Cow<'static, str> {
                $schema_name.into()
            }

            fn json_schema(_: &mut SchemaGenerator) -> Schema {
                json_schema!({ "type": "string", "pattern": $pattern })
            }
        }
    };
}

bounded_string!(
    /// A registered name: capability, rule, reason, field, category, change kind or catalog app.
    /// Lowercase ASCII letters, digits, `_` and `.`, starting with a letter, at most 64 bytes.
    Identifier,
    "identifier",
    "Identifier",
    "^[a-z][a-z0-9_.]{0,63}$",
    |value| {
        let bytes = value.as_bytes();
        !bytes.is_empty()
            && bytes.len() <= 64
            && bytes[0].is_ascii_lowercase()
            && bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_' || *byte == b'.')
    }
);

bounded_string!(
    /// An opaque per-session identity (source instance, collection session): 8 to 64 URL-safe characters.
    OpaqueId,
    "opaque id",
    "OpaqueId",
    "^[A-Za-z0-9_-]{8,64}$",
    |value| {
        (8..=64).contains(&value.len())
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    }
);

bounded_string!(
    /// A one-time handshake secret: 43 base64url characters (32 random bytes).
    Secret,
    "secret",
    "Secret",
    "^[A-Za-z0-9_-]{43}$",
    |value| {
        value.len() == 43
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    }
);

bounded_string!(
    /// An absolute local path chosen by Electron main: at most 1024 bytes, no NUL.
    LocalPath,
    "local path",
    "LocalPath",
    "^(/|[A-Za-z]:\\\\)[^\\u0000]{0,1020}$",
    |value| {
        let bytes = value.as_bytes();
        let absolute = bytes.first() == Some(&b'/')
            || (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\');
        absolute && bytes.len() <= 1024 && !bytes.contains(&0)
    }
);

impl Secret {
    /// The 32 bytes a secret encodes (base64url without padding).
    #[must_use]
    pub fn bytes(&self) -> [u8; 32] {
        let value = |byte: u8| match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            _ => 63,
        };
        let mut out = [0_u8; 32];
        let mut bits = 0_u32;
        let mut count = 0;
        let mut index = 0;
        for byte in self.0.bytes() {
            bits = (bits << 6) | u32::from(value(byte));
            count += 6;
            if count >= 8 && index < out.len() {
                count -= 8;
                out[index] = u8::try_from((bits >> count) & 0xFF).unwrap_or(0);
                index += 1;
            }
        }
        out
    }

    /// Encodes 32 bytes as a secret.
    #[must_use]
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::with_capacity(43);
        let mut bits = 0_u32;
        let mut count = 0;
        for byte in bytes {
            bits = (bits << 8) | u32::from(*byte);
            count += 8;
            while count >= 6 {
                count -= 6;
                out.push(char::from(
                    ALPHABET[usize::try_from((bits >> count) & 0x3F).unwrap_or(0)],
                ));
            }
        }
        if count > 0 {
            out.push(char::from(
                ALPHABET[usize::try_from((bits << (6 - count)) & 0x3F).unwrap_or(0)],
            ));
        }
        Self(out)
    }
}

bounded_string!(
    /// A lowercase hexadecimal SHA-256 digest.
    Digest,
    "digest",
    "Digest",
    "^[0-9a-f]{64}$",
    |value| {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }
);

bounded_string!(
    /// A build identity: 1 to 128 printable ASCII characters without spaces.
    BuildIdentity,
    "build identity",
    "BuildIdentity",
    "^[!-~]{1,128}$",
    |value| (1..=128).contains(&value.len()) && value.bytes().all(|byte| (b'!'..=b'~').contains(&byte))
);

bounded_string!(
    /// Code-signing text from the OS (a publisher, file name, signing ID or Team ID): 1 to 256
    /// bytes of UTF-8 without control characters.
    CodeText,
    "code text",
    "CodeText",
    "^[^\\u0000-\\u001f\\u007f]{1,256}$",
    |value| (1..=256).contains(&value.len()) && !value.chars().any(char::is_control)
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_count_above_the_javascript_safe_integer_is_refused() {
        assert!(Count::new(MAX_SAFE_INTEGER).is_ok());
        assert!(Count::new(MAX_SAFE_INTEGER + 1).is_err());
        assert!(serde_json::from_str::<Count>("9007199254740992").is_err());
    }

    #[test]
    fn counting_saturates_instead_of_overflowing() {
        let top = Count::new(MAX_SAFE_INTEGER).expect("bound is valid");
        assert_eq!(top.next(), top);
        assert_eq!(Count::ZERO.saturating_add(u64::MAX), top);
    }

    #[test]
    fn identifiers_accept_only_registered_name_shapes() {
        for valid in ["display", "display.summary.active_physical", "a1_b"] {
            assert!(Identifier::new(valid).is_ok(), "{valid}");
        }
        for invalid in [
            "",
            "Display",
            "1display",
            "display-topology",
            "a b",
            &"a".repeat(65),
        ] {
            assert!(Identifier::new(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn deserializing_an_invalid_string_fails_instead_of_producing_a_value() {
        assert!(serde_json::from_str::<OpaqueId>("\"short\"").is_err());
        assert!(serde_json::from_str::<Digest>("\"ABC\"").is_err());
        assert!(serde_json::from_str::<Secret>(&format!("\"{}\"", "a".repeat(43))).is_ok());
    }

    #[test]
    fn a_secret_round_trips_its_bytes() {
        let bytes: [u8; 32] = std::array::from_fn(|index| u8::try_from(index * 7 + 3).unwrap_or(0));
        let secret = Secret::from_bytes(&bytes);
        assert!(Secret::new(secret.as_str()).is_ok(), "a valid secret");
        assert_eq!(secret.bytes(), bytes);
        assert_eq!(
            Secret::from_bytes(&[0xFF; 32]).as_str(),
            format!("{}8", "_".repeat(42))
        );
    }

    #[test]
    fn code_text_is_bounded_and_has_no_control_characters() {
        assert!(CodeText::new("Microsoft Windows").is_ok());
        assert!(CodeText::new("").is_err());
        assert!(CodeText::new("a\nb").is_err());
        assert!(CodeText::new("é".repeat(128)).is_ok());
        assert!(CodeText::new("a".repeat(257)).is_err());
    }

    #[test]
    fn local_paths_are_absolute_and_bounded() {
        assert!(LocalPath::new("/var/lib/proctor/recording").is_ok());
        assert!(LocalPath::new("D:\\Data\\recording").is_ok());
        assert!(LocalPath::new("relative/x").is_err());
        assert!(LocalPath::new(format!("/{}", "a".repeat(1024))).is_err());
        assert!(LocalPath::new("/a\0b").is_err());
    }
}
