//! Reads platform files without trusting their reported size.

use std::fmt;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

#[derive(Debug)]
pub enum BoundedFileReadError {
    Io(io::Error),
    Overflow { max_bytes: usize },
    InvalidUtf8,
}

impl fmt::Display for BoundedFileReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "file read failed: {error}"),
            Self::Overflow { max_bytes } => {
                write!(formatter, "file exceeds its {max_bytes}-byte bound")
            }
            Self::InvalidUtf8 => formatter.write_str("file is not valid UTF-8"),
        }
    }
}

impl std::error::Error for BoundedFileReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Overflow { .. } | Self::InvalidUtf8 => None,
        }
    }
}

/// Reads at most one byte beyond a fixed file boundary without trusting file metadata.
///
/// # Errors
///
/// Returns [`BoundedFileReadError::Io`] when the file cannot be opened or read,
/// or [`BoundedFileReadError::Overflow`] when actual content exceeds `max_bytes`.
pub fn read_bounded_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>, BoundedFileReadError> {
    let file = File::open(path).map_err(BoundedFileReadError::Io)?;
    read_bounded(file, max_bytes)
}

/// Reads a fixed-size UTF-8 platform record without trusting file metadata.
///
/// # Errors
///
/// Returns the bounded byte-reader failures or
/// [`BoundedFileReadError::InvalidUtf8`] for malformed text.
pub fn read_bounded_utf8_file(
    path: &Path,
    max_bytes: usize,
) -> Result<String, BoundedFileReadError> {
    String::from_utf8(read_bounded_file(path, max_bytes)?)
        .map_err(|_error| BoundedFileReadError::InvalidUtf8)
}

pub(crate) fn read_bounded(
    reader: impl Read,
    max_bytes: usize,
) -> Result<Vec<u8>, BoundedFileReadError> {
    let read_limit = max_bytes
        .checked_add(1)
        .ok_or(BoundedFileReadError::Overflow { max_bytes })?;
    let mut bytes = Vec::new();
    reader
        .take(u64::try_from(read_limit).unwrap_or(u64::MAX))
        .read_to_end(&mut bytes)
        .map_err(BoundedFileReadError::Io)?;
    if bytes.len() > max_bytes {
        return Err(BoundedFileReadError::Overflow { max_bytes });
    }
    Ok(bytes)
}
