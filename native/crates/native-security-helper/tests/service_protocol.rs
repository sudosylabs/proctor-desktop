use native_protocol::{
    HelperServiceRequest, HelperServiceResponse, HelperServiceWorkerBootstrap, ProtocolValidatable,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn accepts<T: DeserializeOwned + ProtocolValidatable>(value: Value) -> bool {
    serde_json::from_value::<T>(value).is_ok_and(|message| message.validate_protocol().is_ok())
}

fn assert_closed_envelope<T: DeserializeOwned + ProtocolValidatable>(valid: &Value) {
    assert!(accepts::<T>(valid.clone()));
    for (field, replacement) in [
        ("protocol_version", json!(0)),
        ("protocol_version", json!(2)),
        ("protocol_version", json!(1.5)),
        ("channel_nonce", json!("A".repeat(64))),
        ("channel_nonce", json!("g".repeat(64))),
        ("channel_nonce", json!("a".repeat(63))),
        ("channel_nonce", json!("a".repeat(65))),
        ("channel_nonce", Value::Null),
        ("pid", json!(42)),
        ("audit_session_id", json!(42)),
        ("uid", json!(501)),
        ("extra", json!(true)),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = replacement;
        assert!(!accepts::<T>(invalid), "invalid field {field}");
    }
    for field in valid.as_object().expect("test envelope").keys() {
        let mut invalid = valid.clone();
        invalid
            .as_object_mut()
            .expect("test envelope")
            .remove(field);
        assert!(!accepts::<T>(invalid), "missing field {field}");
    }
}

#[test]
fn lifecycle_controls_accept_only_their_own_closed_kinds() {
    for kind in ["open", "attach", "stop"] {
        let request =
            json!({"protocol_version": 1, "channel_nonce": "a0".repeat(32), "kind": kind});
        assert_closed_envelope::<HelperServiceRequest>(&request);
        assert!(!accepts::<HelperServiceResponse>(request));
    }
    for kind in ["ready", "started", "stopped"] {
        let response =
            json!({"protocol_version": 1, "channel_nonce": "a0".repeat(32), "kind": kind});
        assert_closed_envelope::<HelperServiceResponse>(&response);
        assert!(!accepts::<HelperServiceRequest>(response));
    }
    for kind in [json!("launch"), Value::Null, json!(42)] {
        let value = json!({"protocol_version": 1, "channel_nonce": "a0".repeat(32), "kind": kind});
        assert!(!accepts::<HelperServiceRequest>(value.clone()));
        assert!(!accepts::<HelperServiceResponse>(value));
    }
}

#[test]
fn worker_bootstrap_enforces_requirement_character_bounds_and_closed_fields() {
    let valid = json!({
        "protocol_version": 1,
        "channel_nonce": "0a".repeat(32),
        "client_designated_requirement": "anchor apple generic"
    });
    assert_closed_envelope::<HelperServiceWorkerBootstrap>(&valid);
    for requirement in ["a".to_owned(), "a".repeat(2048), "😀".repeat(2048)] {
        let mut value = valid.clone();
        value["client_designated_requirement"] = json!(requirement);
        assert!(accepts::<HelperServiceWorkerBootstrap>(value));
    }
    for requirement in [
        json!(""),
        json!("a".repeat(2049)),
        json!("😀".repeat(2049)),
        Value::Null,
        json!(42),
    ] {
        let mut value = valid.clone();
        value["client_designated_requirement"] = requirement;
        assert!(!accepts::<HelperServiceWorkerBootstrap>(value));
    }
}
