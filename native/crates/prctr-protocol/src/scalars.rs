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
}
