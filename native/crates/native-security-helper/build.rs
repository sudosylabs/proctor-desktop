use std::env;
use std::io::Read;
use std::path::PathBuf;
use std::process::Command;

// Like the existing Endpoint Security shim, this build-only adapter lets the
// selected Apple SDK own a nested C layout. No compiler runs in the product.
fn main() {
    println!("cargo:rerun-if-env-changed=WINDOWS_SERVICE_PACKAGE");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        emit_windows_service_package();
        return;
    }
    println!("cargo:rerun-if-changed=src/macos_socket.c");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let architecture = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        _ => panic!("native helper requires an admitted macOS architecture"),
    };
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    let object = output.join("macos_socket.o");
    let archive = output.join("libmacos_socket.a");
    run(Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "clang",
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-arch",
            architecture,
            "-mmacosx-version-min=11.0",
            "-c",
            "src/macos_socket.c",
            "-o",
        ])
        .arg(&object));
    run(Command::new("xcrun")
        .args(["ar", "crs"])
        .arg(&archive)
        .arg(&object));
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=macos_socket");
    println!("cargo:rustc-link-lib=dylib=proc");
}

fn run(command: &mut Command) {
    let status = command.status().expect("macOS SDK tool invocation");
    assert!(
        status.success(),
        "macOS native helper shim compilation failed"
    );
}

// The path is a protected build input, never runtime configuration. Ordinary
// development builds embed no inventory and cannot enter Windows service mode.
fn emit_windows_service_package() {
    const MAXIMUM: u64 = 2 * 1024 * 1024;
    let mut bytes = Vec::new();
    if let Some(path) = env::var_os("WINDOWS_SERVICE_PACKAGE") {
        let path = PathBuf::from(path);
        println!("cargo:rerun-if-changed={}", path.display());
        let file = std::fs::File::open(&path).expect("Windows service release inventory");
        assert!(
            file.metadata().expect("release metadata").is_file(),
            "release inventory must be a file"
        );
        file.take(MAXIMUM + 1)
            .read_to_end(&mut bytes)
            .expect("bounded release inventory read");
        assert!(
            !bytes.is_empty() && bytes.len() as u64 <= MAXIMUM,
            "Windows release inventory size"
        );
        std::str::from_utf8(&bytes).expect("Windows release inventory UTF-8");
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    std::fs::write(output.join("windows-service-package.json"), bytes)
        .expect("embedded Windows service inventory");
}
