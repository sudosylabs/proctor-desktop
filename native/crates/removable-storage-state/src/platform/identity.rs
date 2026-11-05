use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use hmac::{Hmac, Mac};
use native_protocol::{
    RemovableStorageAttachment, RemovableStorageCertainty, RemovableStorageCoverage,
    RemovableStorageFunction, RemovableStorageFunctionKind, RemovableStorageState,
    RemovableStorageTransport, RemovableStorageWritability,
};
use native_source_runtime::PassiveStateSourceError;
use sha2::Sha256;

const MAX_ATTACHED_FUNCTIONS: usize = 32;
const MAX_SESSION_IDENTITIES: usize = 256;

pub(super) struct RawStorageFunction {
    pub stable_key: String,
    pub kind: RemovableStorageFunctionKind,
    pub transport: RemovableStorageTransport,
    pub writability: RemovableStorageWritability,
    pub attachment: RemovableStorageAttachment,
}

pub(super) struct StorageIdentityMap {
    attempt_context: Vec<u8>,
    identities: BTreeMap<String, String>,
}

impl StorageIdentityMap {
    pub fn for_collection(collection_session_id: &str) -> Result<Self, PassiveStateSourceError> {
        if collection_session_id.is_empty() || collection_session_id.chars().count() > 128 {
            return Err(PassiveStateSourceError::Backend(
                "removable-storage collection context is invalid".to_owned(),
            ));
        }
        Ok(Self {
            attempt_context: collection_session_id.as_bytes().to_vec(),
            identities: BTreeMap::new(),
        })
    }

    pub fn state(
        &mut self,
        coverage: RemovableStorageCoverage,
        certainty: RemovableStorageCertainty,
        mut functions: Vec<RawStorageFunction>,
    ) -> Result<RemovableStorageState, PassiveStateSourceError> {
        functions.sort_by(|left, right| left.stable_key.cmp(&right.stable_key));
        if functions.len() > MAX_ATTACHED_FUNCTIONS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "removable-storage inventory exceeds the protocol bound".to_owned(),
            ));
        }
        let mut keys = BTreeSet::new();
        let mut attached_functions = Vec::with_capacity(functions.len());
        for function in functions {
            if !keys.insert(function.stable_key.clone()) {
                return Err(PassiveStateSourceError::Backend(
                    "removable-storage inventory contains a duplicate native function".to_owned(),
                ));
            }
            let function_instance_id = self.identity(&function.stable_key)?;
            attached_functions.push(RemovableStorageFunction {
                function_instance_id,
                kind: function.kind,
                transport: function.transport,
                writability: function.writability,
                attachment: function.attachment,
            });
        }
        Ok(RemovableStorageState {
            coverage,
            certainty,
            attached_functions,
        })
    }

    fn identity(&mut self, stable_key: &str) -> Result<String, PassiveStateSourceError> {
        if let Some(identity) = self.identities.get(stable_key) {
            return Ok(identity.clone());
        }
        if self.identities.len() >= MAX_SESSION_IDENTITIES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "removable-storage session identity map is exhausted".to_owned(),
            ));
        }
        let identity = attempt_pseudonym(&self.attempt_context, stable_key);
        if self
            .identities
            .values()
            .any(|existing| existing == &identity)
        {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "removable-storage Attempt pseudonym collision".to_owned(),
            ));
        }
        self.identities
            .insert(stable_key.to_owned(), identity.clone());
        Ok(identity)
    }
}

fn attempt_pseudonym(attempt_context: &[u8], stable_key: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(attempt_context)
        .expect("HMAC accepts every bounded Attempt context length");
    mac.update(b"prctr-removable-storage-v1\0");
    mac.update(stable_key.as_bytes());
    let digest = mac.finalize().into_bytes();
    let mut suffix = String::with_capacity(32);
    for byte in &digest[..16] {
        write!(suffix, "{byte:02x}").expect("writing to a String cannot fail");
    }
    format!("storage-function-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_session_identity_exhaustion_is_an_inventory_overflow() {
        let mut identities = StorageIdentityMap::for_collection("attempt-identity-test")
            .expect("collection context");
        for index in 0..MAX_SESSION_IDENTITIES {
            identities
                .identity(&format!("native-{index}"))
                .expect("bounded identity");
        }
        assert!(matches!(
            identities.identity("one-too-many"),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
    }

    #[test]
    fn raw_platform_identity_never_crosses_the_source_boundary() {
        let mut identities = StorageIdentityMap::for_collection("attempt-identity-test")
            .expect("collection context");
        let first = identities
            .state(
                RemovableStorageCoverage::SnapshotOnly,
                RemovableStorageCertainty::Partial,
                vec![raw("/dev/private-device")],
            )
            .expect("first state");
        let second = identities
            .state(
                RemovableStorageCoverage::SnapshotOnly,
                RemovableStorageCertainty::Partial,
                vec![raw("/dev/private-device")],
            )
            .expect("second state");
        assert_eq!(first, second);
        assert!(
            !first.attached_functions[0]
                .function_instance_id
                .contains("private")
        );
    }

    #[test]
    fn a_replacement_native_identity_never_reuses_the_previous_function_identity() {
        let mut identities = StorageIdentityMap::for_collection("attempt-identity-test")
            .expect("collection context");
        let first = identities
            .state(
                RemovableStorageCoverage::SnapshotOnly,
                RemovableStorageCertainty::Partial,
                vec![raw("volume-guid-device-a")],
            )
            .expect("first device");
        identities
            .state(
                RemovableStorageCoverage::SnapshotOnly,
                RemovableStorageCertainty::Partial,
                Vec::new(),
            )
            .expect("device removed");
        let replacement = identities
            .state(
                RemovableStorageCoverage::SnapshotOnly,
                RemovableStorageCertainty::Partial,
                vec![raw("volume-guid-device-b")],
            )
            .expect("replacement device");

        assert_ne!(
            first.attached_functions[0].function_instance_id,
            replacement.attached_functions[0].function_instance_id
        );
    }

    #[test]
    fn pseudonyms_survive_source_restart_but_are_unlinkable_across_attempts() {
        let first = StorageIdentityMap::for_collection("attempt-context-a")
            .expect("first collection")
            .identity("stable-device-key")
            .expect("first pseudonym");
        let restarted = StorageIdentityMap::for_collection("attempt-context-a")
            .expect("replacement collection")
            .identity("stable-device-key")
            .expect("replacement pseudonym");
        let next_attempt = StorageIdentityMap::for_collection("attempt-context-b")
            .expect("next collection")
            .identity("stable-device-key")
            .expect("next pseudonym");
        assert_eq!(first, restarted);
        assert_ne!(first, next_attempt);
        assert!(!first.contains("stable-device-key"));
    }

    #[test]
    fn collection_context_bound_counts_unicode_code_points() {
        StorageIdentityMap::for_collection(&"🧪".repeat(40))
            .expect("forty Unicode code points are within the protocol bound");
        assert!(matches!(
            StorageIdentityMap::for_collection(&"🧪".repeat(129)),
            Err(PassiveStateSourceError::Backend(_))
        ));
    }

    fn raw(stable_key: &str) -> RawStorageFunction {
        RawStorageFunction {
            stable_key: stable_key.to_owned(),
            kind: RemovableStorageFunctionKind::BlockStorage,
            transport: RemovableStorageTransport::Unknown,
            writability: RemovableStorageWritability::Unknown,
            attachment: RemovableStorageAttachment::Mounted,
        }
    }
}
