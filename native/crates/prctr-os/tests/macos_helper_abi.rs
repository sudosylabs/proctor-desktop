#![cfg(target_os = "macos")]
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn helper_decoders_match_both_supported_macos_sdk_abis() {
    for target in ["arm64-apple-macos13", "x86_64-apple-macos13"] {
        let mut compiler = Command::new("xcrun")
            .args([
                "clang",
                "-target",
                target,
                "-x",
                "c",
                "-std=c11",
                "-fsyntax-only",
                "-",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Xcode command-line tools");
        compiler
            .stdin
            .take()
            .expect("compiler input")
            .write_all(include_bytes!("macos_helper_abi.c"))
            .expect("write SDK assertions");
        let output = compiler.wait_with_output().expect("compiler result");
        assert!(
            output.status.success(),
            "{target}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
