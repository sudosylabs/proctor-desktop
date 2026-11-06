//! Source identities and the source-neutral snapshot and batch enums that
//! carry each capability's typed protocol values.

use std::fmt;

use native_protocol::{
    CandidateWindowDrain, CandidateWindowSourceSnapshot, CaptureSessionDrain,
    CaptureSessionSourceSnapshot, ClipboardDrain, ClipboardSourceSnapshot, DisplayTopologyDrain,
    DisplayTopologySourceSnapshot, InteractiveSessionDrain, InteractiveSessionSourceSnapshot,
    MediaDeviceDrain, MediaDeviceSourceSnapshot, NATIVE_SOURCE_COUNT, NetworkConfigurationDrain,
    NetworkConfigurationSourceSnapshot, PermissionState, PrintSpoolerDrain,
    PrintSpoolerSourceSnapshot, ProcessApplicationDrain, ProcessApplicationSourceSnapshot,
    RemovableStorageDrain, RemovableStorageSourceSnapshot, SourceFailureCode, SourceHealth,
    VirtualizationDrain, VirtualizationSourceSnapshot,
};

pub const NATIVE_SOURCE_KINDS: [NativeSourceKind; NATIVE_SOURCE_COUNT] = [
    NativeSourceKind::DisplayTopology,
    NativeSourceKind::CandidateWindow,
    NativeSourceKind::CaptureSession,
    NativeSourceKind::ProcessApplication,
    NativeSourceKind::InteractiveSession,
    NativeSourceKind::Clipboard,
    NativeSourceKind::PrintSpooler,
    NativeSourceKind::RemovableStorage,
    NativeSourceKind::Virtualization,
    NativeSourceKind::NetworkConfiguration,
    NativeSourceKind::MediaDevice,
];

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum NativeSourceKind {
    DisplayTopology,
    CandidateWindow,
    CaptureSession,
    ProcessApplication,
    InteractiveSession,
    Clipboard,
    PrintSpooler,
    RemovableStorage,
    Virtualization,
    NetworkConfiguration,
    MediaDevice,
}

impl fmt::Display for NativeSourceKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::DisplayTopology => "display-topology",
            Self::CandidateWindow => "candidate-window",
            Self::CaptureSession => "capture-session",
            Self::ProcessApplication => "process-application",
            Self::InteractiveSession => "interactive-session",
            Self::Clipboard => "clipboard",
            Self::PrintSpooler => "print-spooler",
            Self::RemovableStorage => "removable-storage",
            Self::Virtualization => "virtualization",
            Self::NetworkConfiguration => "network-configuration",
            Self::MediaDevice => "media-device",
        })
    }
}

impl NativeSourceKind {
    #[must_use]
    pub fn from_source_id(source_id: &str) -> Option<Self> {
        NATIVE_SOURCE_KINDS
            .into_iter()
            .find(|kind| kind.to_string() == source_id)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeSourceSnapshot {
    DisplayTopology(DisplayTopologySourceSnapshot),
    CandidateWindow(CandidateWindowSourceSnapshot),
    CaptureSession(CaptureSessionSourceSnapshot),
    ProcessApplication(ProcessApplicationSourceSnapshot),
    InteractiveSession(InteractiveSessionSourceSnapshot),
    Clipboard(ClipboardSourceSnapshot),
    PrintSpooler(PrintSpoolerSourceSnapshot),
    RemovableStorage(RemovableStorageSourceSnapshot),
    Virtualization(VirtualizationSourceSnapshot),
    NetworkConfiguration(NetworkConfigurationSourceSnapshot),
    MediaDevice(MediaDeviceSourceSnapshot),
}

impl NativeSourceSnapshot {
    #[must_use]
    pub fn kind(&self) -> NativeSourceKind {
        match self {
            Self::DisplayTopology(_) => NativeSourceKind::DisplayTopology,
            Self::CandidateWindow(_) => NativeSourceKind::CandidateWindow,
            Self::CaptureSession(_) => NativeSourceKind::CaptureSession,
            Self::ProcessApplication(_) => NativeSourceKind::ProcessApplication,
            Self::InteractiveSession(_) => NativeSourceKind::InteractiveSession,
            Self::Clipboard(_) => NativeSourceKind::Clipboard,
            Self::PrintSpooler(_) => NativeSourceKind::PrintSpooler,
            Self::RemovableStorage(_) => NativeSourceKind::RemovableStorage,
            Self::Virtualization(_) => NativeSourceKind::Virtualization,
            Self::NetworkConfiguration(_) => NativeSourceKind::NetworkConfiguration,
            Self::MediaDevice(_) => NativeSourceKind::MediaDevice,
        }
    }

    #[must_use]
    pub fn source_instance_id(&self) -> &str {
        match self {
            Self::DisplayTopology(snapshot) => &snapshot.source_instance_id,
            Self::CandidateWindow(snapshot) => &snapshot.source_instance_id,
            Self::CaptureSession(snapshot) => &snapshot.source_instance_id,
            Self::ProcessApplication(snapshot) => &snapshot.source_instance_id,
            Self::InteractiveSession(snapshot) => &snapshot.source_instance_id,
            Self::Clipboard(snapshot) => &snapshot.source_instance_id,
            Self::PrintSpooler(snapshot) => &snapshot.source_instance_id,
            Self::RemovableStorage(snapshot) => &snapshot.source_instance_id,
            Self::Virtualization(snapshot) => &snapshot.source_instance_id,
            Self::NetworkConfiguration(snapshot) => &snapshot.source_instance_id,
            Self::MediaDevice(snapshot) => &snapshot.source_instance_id,
        }
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        match self {
            Self::DisplayTopology(snapshot) => snapshot.health,
            Self::CandidateWindow(snapshot) => snapshot.health,
            Self::CaptureSession(snapshot) => snapshot.health,
            Self::ProcessApplication(snapshot) => snapshot.health,
            Self::InteractiveSession(snapshot) => snapshot.health,
            Self::Clipboard(snapshot) => snapshot.health,
            Self::PrintSpooler(snapshot) => snapshot.health,
            Self::RemovableStorage(snapshot) => snapshot.health,
            Self::Virtualization(snapshot) => snapshot.health,
            Self::NetworkConfiguration(snapshot) => snapshot.health,
            Self::MediaDevice(snapshot) => snapshot.health,
        }
    }

    #[must_use]
    pub fn permission(&self) -> PermissionState {
        match self {
            Self::DisplayTopology(snapshot) => snapshot.permission,
            Self::CandidateWindow(snapshot) => snapshot.permission,
            Self::CaptureSession(snapshot) => snapshot.permission,
            Self::ProcessApplication(snapshot) => snapshot.permission,
            Self::InteractiveSession(snapshot) => snapshot.permission,
            Self::Clipboard(snapshot) => snapshot.permission,
            Self::PrintSpooler(snapshot) => snapshot.permission,
            Self::RemovableStorage(snapshot) => snapshot.permission,
            Self::Virtualization(snapshot) => snapshot.permission,
            Self::NetworkConfiguration(snapshot) => snapshot.permission,
            Self::MediaDevice(snapshot) => snapshot.permission,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeSourceBatch {
    DisplayTopology(DisplayTopologyDrain),
    CandidateWindow(CandidateWindowDrain),
    CaptureSession(CaptureSessionDrain),
    ProcessApplication(ProcessApplicationDrain),
    InteractiveSession(InteractiveSessionDrain),
    Clipboard(ClipboardDrain),
    PrintSpooler(PrintSpoolerDrain),
    RemovableStorage(RemovableStorageDrain),
    Virtualization(VirtualizationDrain),
    NetworkConfiguration(NetworkConfigurationDrain),
    MediaDevice(MediaDeviceDrain),
}

impl NativeSourceBatch {
    #[must_use]
    pub fn kind(&self) -> NativeSourceKind {
        match self {
            Self::DisplayTopology(_) => NativeSourceKind::DisplayTopology,
            Self::CandidateWindow(_) => NativeSourceKind::CandidateWindow,
            Self::CaptureSession(_) => NativeSourceKind::CaptureSession,
            Self::ProcessApplication(_) => NativeSourceKind::ProcessApplication,
            Self::InteractiveSession(_) => NativeSourceKind::InteractiveSession,
            Self::Clipboard(_) => NativeSourceKind::Clipboard,
            Self::PrintSpooler(_) => NativeSourceKind::PrintSpooler,
            Self::RemovableStorage(_) => NativeSourceKind::RemovableStorage,
            Self::Virtualization(_) => NativeSourceKind::Virtualization,
            Self::NetworkConfiguration(_) => NativeSourceKind::NetworkConfiguration,
            Self::MediaDevice(_) => NativeSourceKind::MediaDevice,
        }
    }

    #[must_use]
    pub fn source_instance_id(&self) -> &str {
        match self {
            Self::DisplayTopology(batch) => &batch.source_instance_id,
            Self::CandidateWindow(batch) => &batch.source_instance_id,
            Self::CaptureSession(batch) => &batch.source_instance_id,
            Self::ProcessApplication(batch) => &batch.source_instance_id,
            Self::InteractiveSession(batch) => &batch.source_instance_id,
            Self::Clipboard(batch) => &batch.source_instance_id,
            Self::PrintSpooler(batch) => &batch.source_instance_id,
            Self::RemovableStorage(batch) => &batch.source_instance_id,
            Self::Virtualization(batch) => &batch.source_instance_id,
            Self::NetworkConfiguration(batch) => &batch.source_instance_id,
            Self::MediaDevice(batch) => &batch.source_instance_id,
        }
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        match self {
            Self::DisplayTopology(batch) => batch.health,
            Self::CandidateWindow(batch) => batch.health,
            Self::CaptureSession(batch) => batch.health,
            Self::ProcessApplication(batch) => batch.health,
            Self::InteractiveSession(batch) => batch.health,
            Self::Clipboard(batch) => batch.health,
            Self::PrintSpooler(batch) => batch.health,
            Self::RemovableStorage(batch) => batch.health,
            Self::Virtualization(batch) => batch.health,
            Self::NetworkConfiguration(batch) => batch.health,
            Self::MediaDevice(batch) => batch.health,
        }
    }

    #[must_use]
    pub fn terminal_error(&self) -> Option<SourceFailureCode> {
        match self {
            Self::DisplayTopology(batch) => batch.terminal_error,
            Self::CandidateWindow(batch) => batch.terminal_error,
            Self::CaptureSession(batch) => batch.terminal_error,
            Self::ProcessApplication(batch) => batch.terminal_error,
            Self::InteractiveSession(batch) => batch.terminal_error,
            Self::Clipboard(batch) => batch.terminal_error,
            Self::PrintSpooler(batch) => batch.terminal_error,
            Self::RemovableStorage(batch) => batch.terminal_error,
            Self::Virtualization(batch) => batch.terminal_error,
            Self::NetworkConfiguration(batch) => batch.terminal_error,
            Self::MediaDevice(batch) => batch.terminal_error,
        }
    }

    #[must_use]
    pub fn fact_count(&self) -> usize {
        match self {
            Self::DisplayTopology(batch) => batch.observations.len() + batch.resets.len(),
            Self::CandidateWindow(batch) => batch.observations.len() + batch.resets.len(),
            Self::CaptureSession(batch) => batch.observations.len() + batch.resets.len(),
            Self::ProcessApplication(batch) => batch.observations.len() + batch.resets.len(),
            Self::InteractiveSession(batch) => batch.observations.len() + batch.resets.len(),
            Self::Clipboard(batch) => batch.observations.len() + batch.resets.len(),
            Self::PrintSpooler(batch) => batch.observations.len() + batch.resets.len(),
            Self::RemovableStorage(batch) => batch.observations.len() + batch.resets.len(),
            Self::Virtualization(batch) => batch.observations.len() + batch.resets.len(),
            Self::NetworkConfiguration(batch) => batch.observations.len() + batch.resets.len(),
            Self::MediaDevice(batch) => batch.observations.len() + batch.resets.len(),
        }
    }
}
