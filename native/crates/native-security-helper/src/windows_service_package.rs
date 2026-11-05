//! Strict compile-time release input. This decoder is never a service request.
//! The build owner embeds an independently admitted signed release inventory.
use crate::{
    HelperTransportError,
    windows_launch_manifest::{WindowsLaunchFile, WindowsLaunchManifest},
};
use serde::Deserialize;

const MAX_PACKAGE_JSON_BYTES: usize = 2 * 1024 * 1024;

pub struct WindowsServicePackage {
    release_id: String,
    manifest: WindowsLaunchManifest,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageInput {
    schema_version: u16,
    release_id: String,
    executable: String,
    files: Vec<FileInput>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileInput {
    relative_path: String,
    sha256: String,
    bytes: u64,
}

impl WindowsServicePackage {
    #[must_use]
    pub fn release_id(&self) -> &str {
        &self.release_id
    }
    #[must_use]
    pub fn into_manifest(self) -> WindowsLaunchManifest {
        self.manifest
    }
    #[cfg(target_os = "windows")]
    /// # Errors
    /// Returns missing/invalid OS known-folder or an elapsed setup deadline.
    pub fn installed_root(
        &self,
        deadline: std::time::Instant,
    ) -> Result<std::path::PathBuf, HelperTransportError> {
        let mut root = crate::windows_service_installation::program_files(deadline)?;
        root.push("Proctor");
        root.push("releases");
        root.push(&self.release_id);
        Ok(root)
    }

    /// Only the fixed build-generated resource may supply this string. A missing
    /// resource leaves ordinary development builds unable to enter service mode.
    /// # Errors
    /// Rejects missing, oversized, ambiguous, unknown or unsupported release input.
    pub fn decode(embedded: &str) -> Result<Self, HelperTransportError> {
        if embedded.is_empty() {
            return Err(HelperTransportError::UnsupportedPlatform);
        }
        if embedded.len() > MAX_PACKAGE_JSON_BYTES {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let input: PackageInput = serde_json::from_str(embedded)?;
        if input.schema_version != 1
            || input.release_id.is_empty()
            || input.release_id.len() > 64
            || !input
                .release_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let manifest = WindowsLaunchManifest::new(
            input.executable,
            input
                .files
                .into_iter()
                .map(|file| WindowsLaunchFile {
                    relative_path: file.relative_path,
                    sha256: file.sha256,
                    bytes: file.bytes,
                })
                .collect(),
        )?;
        Ok(Self {
            release_id: input.release_id,
            manifest,
        })
    }
}
/// Resolve only the compile-time admitted release. Runtime environment, command
/// arguments and pipe requests cannot substitute this inventory or installation root.
/// # Errors
/// Missing package input, invalid inventory, OS root discovery and deadline failures refuse service mode.
#[cfg(target_os = "windows")]
pub fn packaged_windows_service_configuration()
-> Result<(std::path::PathBuf, WindowsLaunchManifest), HelperTransportError> {
    const EMBEDDED: &str = include_str!(concat!(env!("OUT_DIR"), "/windows-service-package.json"));
    let deadline = std::time::Instant::now() + crate::HELPER_STARTUP_DEADLINE;
    crate::run_startup_task("prctr-service-package", deadline, move || {
        let package = WindowsServicePackage::decode(EMBEDDED)?;
        let root = package.installed_root(deadline)?;
        Ok((root, package.into_manifest()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> serde_json::Value {
        serde_json::json!({"schema_version":1,"release_id":"release-123","executable":"Proctor.exe","files":[{"relative_path":"Proctor.exe","sha256":"a".repeat(64),"bytes":1}]})
    }
    #[test]
    fn accepts_only_fixed_versioned_release_inventory() {
        let package =
            WindowsServicePackage::decode(&input().to_string()).expect("admitted structure");
        assert_eq!(package.release_id(), "release-123");
        assert_eq!(package.into_manifest().executable(), "Proctor.exe");
    }
    #[test]
    fn rejects_caller_path_arguments_and_unknown_file_metadata() {
        for field in ["root", "arguments", "session_id"] {
            let mut input = input();
            input[field] = serde_json::json!("injected");
            assert!(WindowsServicePackage::decode(&input.to_string()).is_err());
        }
        let mut input = input();
        input["files"][0]["allow_unsigned"] = serde_json::json!(true);
        assert!(WindowsServicePackage::decode(&input.to_string()).is_err());
    }
    #[test]
    fn rejects_unversioned_or_escaping_release_selection() {
        for id in ["", "../other", "C:\\app", "release.1", "release/next"] {
            let mut input = input();
            input["release_id"] = serde_json::json!(id);
            assert!(WindowsServicePackage::decode(&input.to_string()).is_err());
        }
        let mut input = input();
        input["schema_version"] = serde_json::json!(2);
        assert!(WindowsServicePackage::decode(&input.to_string()).is_err());
    }
    #[test]
    fn missing_release_is_unavailable_and_oversize_refused() {
        assert!(matches!(
            WindowsServicePackage::decode(""),
            Err(HelperTransportError::UnsupportedPlatform)
        ));
        assert!(matches!(
            WindowsServicePackage::decode(&" ".repeat(MAX_PACKAGE_JSON_BYTES + 1)),
            Err(HelperTransportError::ExecutableIdentity)
        ));
    }
}
