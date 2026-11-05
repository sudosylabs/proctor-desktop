use std::env;
use std::path::PathBuf;
use std::process::Command;

// ES uses Objective-C blocks and versioned C unions. This small compile-time C
// shim lets the target SDK own their ABI rather than duplicating unsafe block
// layouts in Rust. No compiler or source is shipped or invoked at app runtime.
fn main() {
    println!("cargo:rerun-if-changed=src/platform/macos_session_es.c");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let architecture = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        _ => panic!("Endpoint Security shim requires an admitted macOS architecture"),
    };
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    let object = output.join("macos_session_es.o");
    let archive = output.join("libmacos_session_es.a");
    run(Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "clang",
            "-std=c11",
            "-fblocks",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-arch",
            architecture,
            "-mmacosx-version-min=11.0",
            "-c",
            "src/platform/macos_session_es.c",
            "-o",
        ])
        .arg(&object));
    run(Command::new("xcrun")
        .args(["ar", "crs"])
        .arg(&archive)
        .arg(&object));
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=macos_session_es");
    println!("cargo:rustc-link-lib=dylib=EndpointSecurity");
}

fn run(command: &mut Command) {
    let status = command.status().expect("macOS SDK tool invocation");
    assert!(
        status.success(),
        "macOS Endpoint Security shim compilation failed"
    );
}
