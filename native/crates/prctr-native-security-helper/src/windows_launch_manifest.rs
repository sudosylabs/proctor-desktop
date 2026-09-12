//! Admission of a trusted release's complete controlled-client launch inventory.
//! This is not a wire schema: an untrusted launch request cannot supply entries,
//! digests, an executable, arguments, or a staging destination.
use std::collections::BTreeSet;

use crate::HelperTransportError;

const MAX_FILES: usize = 4_096;
const MAX_PATH_BYTES: usize = 240;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CLOSURE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// One exact release artifact. Digests originate from the trusted signed release
/// inventory, never the installed mutable application's own assertion.
#[derive(Clone)]
pub struct WindowsLaunchFile {
    pub relative_path: String,
    pub sha256: String,
    pub bytes: u64,
}

/// Validated package closure. The native staging owner still verifies every
/// file's bytes and protects the destination before creating any process.
pub struct WindowsLaunchManifest {
    executable: String,
    files: Vec<WindowsLaunchFile>,
}
impl WindowsLaunchManifest {
    /// # Errors
    /// Rejects unsafe/ambiguous Windows paths, conflicting entries, missing entry
    /// executable, malformed digests, empty files, or any inventory/resource bound.
    pub fn new(
        executable: String,
        files: Vec<WindowsLaunchFile>,
    ) -> Result<Self, HelperTransportError> {
        validate_path(&executable)?;
        if files.is_empty()
            || files.len() > MAX_FILES
            || !executable.to_ascii_lowercase().ends_with(".exe")
        {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut paths = BTreeSet::new();
        let mut total = 0_u64;
        for file in &files {
            validate_path(&file.relative_path)?;
            if file.bytes == 0
                || file.bytes > MAX_FILE_BYTES
                || file.sha256.len() != 64
                || !file
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                || !paths.insert(file.relative_path.to_ascii_lowercase())
            {
                return Err(HelperTransportError::ExecutableIdentity);
            }
            total = total
                .checked_add(file.bytes)
                .filter(|size| *size <= MAX_CLOSURE_BYTES)
                .ok_or(HelperTransportError::ExecutableIdentity)?;
        }
        if !paths.contains(&executable.to_ascii_lowercase()) {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        for path in &paths {
            let mut prefix = String::new();
            let parts = path.split('/').collect::<Vec<_>>();
            for part in parts.iter().take(parts.len() - 1) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                if paths.contains(&prefix) {
                    return Err(HelperTransportError::ExecutableIdentity);
                }
            }
        }
        Ok(Self { executable, files })
    }
    #[must_use]
    pub fn executable(&self) -> &str {
        &self.executable
    }
    #[must_use]
    pub fn files(&self) -> &[WindowsLaunchFile] {
        &self.files
    }
}

fn validate_path(path: &str) -> Result<(), HelperTransportError> {
    if path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || !path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-/".contains(&byte))
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    for component in path.split('/') {
        if component.is_empty() || component == "." || component == ".." || component.ends_with('.')
        {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let stem = component
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && (b'1'..=b'9').contains(&stem.as_bytes()[3]))
        {
            return Err(HelperTransportError::ExecutableIdentity);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(path: &str) -> WindowsLaunchFile {
        WindowsLaunchFile {
            relative_path: path.to_owned(),
            sha256: "ab".repeat(32),
            bytes: 100,
        }
    }
    #[test]
    fn admits_one_fixed_executable_and_explicit_nested_code_closure() {
        let manifest = WindowsLaunchManifest::new(
            "Proctor.exe".to_owned(),
            vec![
                file("Proctor.exe"),
                file("resources/app.asar"),
                file("resources/native/source.node"),
            ],
        )
        .unwrap();
        assert_eq!(manifest.executable(), "Proctor.exe");
        assert_eq!(manifest.files().len(), 3);
    }
    #[test]
    fn rejects_windows_aliases_devices_and_path_escapes() {
        for path in [
            "../x", "a/../x", "/x", "C:/x", "a\\x", "a//x", "./x", "x.", "NUL", "con.txt",
            "COM1.js", "lpt9.txt", "x:stream", "x y", "x\0y", "é.txt",
        ] {
            assert!(validate_path(path).is_err(), "{path}");
        }
    }
    #[test]
    fn case_aliases_and_file_directory_conflicts_are_rejected() {
        for extra in [
            vec![file("PROCTOR.exe")],
            vec![file("resources"), file("resources/app.asar")],
        ] {
            let mut files = vec![file("Proctor.exe")];
            files.extend(extra);
            assert!(WindowsLaunchManifest::new("Proctor.exe".to_owned(), files).is_err());
        }
    }
    #[test]
    fn requires_present_executable_and_exact_lowercase_digest() {
        assert!(
            WindowsLaunchManifest::new("Other.exe".to_owned(), vec![file("Proctor.exe")]).is_err()
        );
        for digest in ["AB".repeat(32), "ab".repeat(31), "gg".repeat(32)] {
            let mut entry = file("Proctor.exe");
            entry.sha256 = digest;
            assert!(WindowsLaunchManifest::new("Proctor.exe".to_owned(), vec![entry]).is_err());
        }
    }
    #[test]
    fn rejects_per_file_and_total_resource_overflow() {
        for size in [0, MAX_FILE_BYTES + 1, u64::MAX] {
            let mut entry = file("Proctor.exe");
            entry.bytes = size;
            assert!(WindowsLaunchManifest::new("Proctor.exe".to_owned(), vec![entry]).is_err());
        }
        let files = (0..5)
            .map(|index| {
                let mut entry = file(&format!("{index}.exe"));
                entry.bytes = MAX_FILE_BYTES;
                entry
            })
            .collect();
        assert!(WindowsLaunchManifest::new("0.exe".to_owned(), files).is_err());
    }
}
