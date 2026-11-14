//! `cargo run -p prctr-xtask -- generate` rewrites every generated native artifact.
#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments != ["generate"] {
        eprintln!("usage: prctr-xtask generate");
        return ExitCode::from(2);
    }
    let root = prctr_xtask::workspace_root();
    for artifact in prctr_xtask::artifacts() {
        let path = root.join(artifact.path);
        if let Some(parent) = path.parent()
            && let Err(error) = std::fs::create_dir_all(parent)
        {
            eprintln!("cannot create {}: {error}", parent.display());
            return ExitCode::FAILURE;
        }
        if let Err(error) = std::fs::write(&path, artifact.contents) {
            eprintln!("cannot write {}: {error}", path.display());
            return ExitCode::FAILURE;
        }
        println!("wrote {}", artifact.path);
    }
    ExitCode::SUCCESS
}
