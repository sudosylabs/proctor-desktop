//! Fixed privileged service entry point. Installation/registration is a separate setup action.
#![forbid(unsafe_code)]
fn main() {
    #[cfg(target_os = "windows")]
    let result = prctr_helper::windows::windows_service_main(|context| {
        prctr_helper::windows::run(&context).is_ok()
    })
    .map_err(|_| ());
    #[cfg(target_os = "macos")]
    let result = prctr_helper::macos::run().map_err(|_| ());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result: Result<(), ()> = Err(());
    if result.is_err() {
        std::process::exit(1);
    }
}
