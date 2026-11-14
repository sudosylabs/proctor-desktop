//! Generated native artifacts. Each artifact is produced from the Rust types, written by the
//! `prctr-xtask generate` binary and compared with the committed copy by this crate's tests.
#![forbid(unsafe_code)]

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use sha2::{Digest as _, Sha256};

/// One committed file and the bytes it must contain.
pub struct Artifact {
    /// Path relative to the `native/` workspace root.
    pub path: &'static str,
    pub contents: String,
}

/// Every artifact, in a fixed order.
#[must_use]
pub fn artifacts() -> Vec<Artifact> {
    let schema = pretty(&prctr_protocol::agent_protocol_schema());
    let digest = sha256_hex(schema.as_bytes());
    vec![
        Artifact {
            path: "crates/prctr-protocol/schema/agent-protocol.schema.json",
            contents: schema,
        },
        Artifact {
            path: "crates/prctr-protocol/schema/agent-protocol.digest",
            contents: format!("{digest}\n"),
        },
        Artifact {
            path: "crates/prctr-capabilities/registry/registry.json",
            contents: pretty(&prctr_capabilities::registry_json()),
        },
        Artifact {
            path: "crates/prctr-core/conformance/rules.json",
            contents: pretty(&prctr_core::vectors::rule_vectors_json()),
        },
    ]
}

/// The `native/` workspace root, from this crate's manifest directory.
#[must_use]
pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

/// Lowercase hexadecimal SHA-256.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(64);
    for byte in digest {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

fn pretty(value: &serde_json::Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_committed_artifact_matches_the_rust_types() {
        let root = workspace_root();
        for artifact in artifacts() {
            let committed = std::fs::read_to_string(root.join(artifact.path)).unwrap_or_default();
            assert!(
                committed == artifact.contents,
                "{} is out of date: run `cargo run -p prctr-xtask -- generate` from native/",
                artifact.path
            );
        }
    }

    #[test]
    fn the_protocol_digest_is_the_hash_of_the_committed_schema() {
        let artifacts = artifacts();
        let schema = &artifacts[0].contents;
        let digest = artifacts[1].contents.trim();
        assert_eq!(sha256_hex(schema.as_bytes()), digest);
        assert_eq!(digest.len(), 64);
    }
}
