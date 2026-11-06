//! Opening sources under a deadline: the all-or-nothing initial manifest and
//! the checks every freshly opened source must pass.

use std::time::Duration;

use native_protocol::{
    NATIVE_SOURCE_COUNT, NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS, SourceFailureCode, SourceHealth,
};
use native_source_runtime::{
    BoundedTaskError, ensure_native_source_process_usable, poison_native_source_process,
    run_bounded_task,
};

use crate::erased::{
    ErasedFactory, ErasedSource, RestartBoundary, SourceParameters, SourceStartFailure,
};
use crate::factories::BaselineSourceFactories;
use crate::source::{NATIVE_SOURCE_KINDS, NativeSourceKind, NativeSourceSnapshot};
use crate::supervisor::{BaselineSourceSnapshots, SupervisorOpenError};

/// How long any single source may take to open before the process is poisoned.
pub(crate) const SOURCE_OPEN_DEADLINE: Duration =
    Duration::from_millis(NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS);

pub(crate) struct OpenedErasedSource {
    pub(crate) factory: Box<dyn ErasedFactory>,
    pub(crate) source: Box<dyn ErasedSource>,
    pub(crate) snapshot: NativeSourceSnapshot,
}

pub(crate) struct OpenedManifest {
    pub(crate) sources: Vec<OpenedErasedSource>,
    pub(crate) snapshots: BaselineSourceSnapshots,
}

pub(crate) fn open_initial_manifest(
    parameters: &SourceParameters,
    factories: BaselineSourceFactories,
) -> Result<OpenedManifest, SupervisorOpenError> {
    let manifest_order = factories.into_manifest_order();
    let manifest_kinds: Vec<_> = manifest_order
        .iter()
        .map(|(kind, _factory)| *kind)
        .collect();
    let expected_kinds: Vec<_> = NATIVE_SOURCE_KINDS
        .into_iter()
        .filter(|kind| manifest_kinds.contains(kind))
        .collect();
    let manifest_is_exact = !manifest_order.is_empty() && manifest_kinds == expected_kinds;
    if !manifest_is_exact {
        return Err(SupervisorOpenError {
            source: NativeSourceKind::DisplayTopology,
            failure: SourceFailureCode::Protocol,
            cleanup_failures: Vec::new(),
            process_replacement_required: false,
        });
    }

    let mut opened = Vec::with_capacity(NATIVE_SOURCE_COUNT);
    for (kind, factory) in manifest_order {
        match open_initial_source(kind, parameters, factory) {
            Ok(source) => opened.push(source),
            Err(failure) => {
                let cleanup_failures = cleanup_opened_sources(&mut opened);
                return Err(SupervisorOpenError {
                    source: kind,
                    failure: failure.code,
                    process_replacement_required: failure.process_replacement_required
                        || !cleanup_failures.is_empty(),
                    cleanup_failures,
                });
            }
        }
    }
    let snapshots = BaselineSourceSnapshots {
        sources: opened
            .iter()
            .map(|source| source.snapshot.clone())
            .collect(),
    };
    Ok(OpenedManifest {
        sources: opened,
        snapshots,
    })
}

fn open_initial_source(
    expected_kind: NativeSourceKind,
    parameters: &SourceParameters,
    factory: Box<dyn ErasedFactory>,
) -> Result<OpenedErasedSource, SourceStartFailure> {
    let (factory, opened) =
        match bounded_factory_open(expected_kind, factory, parameters.clone(), None) {
            FactoryOpenOutcome::Completed { factory, result } => (factory, result),
            FactoryOpenOutcome::LifecycleFailure(_failure) => {
                return Err(SourceStartFailure {
                    code: SourceFailureCode::Cleanup,
                    process_replacement_required: true,
                });
            }
        };
    let (source, snapshot) = validate_opened_source(
        expected_kind,
        opened?,
        None,
        ensure_native_source_process_usable().is_ok(),
    )?;
    Ok(OpenedErasedSource {
        factory,
        source,
        snapshot,
    })
}

pub(crate) fn validate_opened_source(
    expected_kind: NativeSourceKind,
    mut source: Box<dyn ErasedSource>,
    previous_source_instance_id: Option<&str>,
    process_usable: bool,
) -> Result<(Box<dyn ErasedSource>, NativeSourceSnapshot), SourceStartFailure> {
    if !process_usable {
        let _cleanup = source.stop();
        return Err(SourceStartFailure {
            code: SourceFailureCode::Cleanup,
            process_replacement_required: true,
        });
    }
    let snapshot = source.snapshot();
    if source.kind() != expected_kind
        || snapshot.kind() != expected_kind
        || previous_source_instance_id
            .is_some_and(|previous| snapshot.source_instance_id() == previous)
        || matches!(
            snapshot.health(),
            SourceHealth::Starting | SourceHealth::Failed | SourceHealth::Stopped
        )
        || matches!(
            source.health(),
            SourceHealth::Starting | SourceHealth::Failed | SourceHealth::Stopped
        )
    {
        let cleanup = source.stop();
        return Err(SourceStartFailure {
            code: cleanup
                .batch
                .terminal_error()
                .unwrap_or(SourceFailureCode::Protocol),
            process_replacement_required: !cleanup.closed_input_boundary,
        });
    }
    Ok((source, snapshot))
}

pub(crate) enum FactoryOpenOutcome {
    Completed {
        factory: Box<dyn ErasedFactory>,
        result: Result<Box<dyn ErasedSource>, SourceStartFailure>,
    },
    LifecycleFailure(BoundedTaskError),
}

fn bounded_factory_open(
    kind: NativeSourceKind,
    factory: Box<dyn ErasedFactory>,
    parameters: SourceParameters,
    restart: Option<RestartBoundary>,
) -> FactoryOpenOutcome {
    bounded_factory_open_with(
        kind,
        factory,
        parameters,
        restart,
        SOURCE_OPEN_DEADLINE,
        &poison_native_source_process,
    )
}

pub(crate) fn bounded_factory_open_with<P>(
    kind: NativeSourceKind,
    factory: Box<dyn ErasedFactory>,
    parameters: SourceParameters,
    restart: Option<RestartBoundary>,
    deadline: Duration,
    poison: &P,
) -> FactoryOpenOutcome
where
    P: Fn(),
{
    match run_bounded_task(source_open_thread_name(kind), deadline, move || {
        let mut factory = factory;
        let result = factory.open(&parameters, restart);
        (factory, result)
    }) {
        Ok((factory, result)) => FactoryOpenOutcome::Completed { factory, result },
        Err(error) => {
            poison();
            FactoryOpenOutcome::LifecycleFailure(error)
        }
    }
}

pub(crate) fn source_open_thread_name(kind: NativeSourceKind) -> &'static str {
    match kind {
        NativeSourceKind::DisplayTopology => "open-display-source",
        NativeSourceKind::CandidateWindow => "open-window-source",
        NativeSourceKind::CaptureSession => "open-session-source",
        NativeSourceKind::ProcessApplication => "open-process-source",
        NativeSourceKind::InteractiveSession => "open-interactive-session-source",
        NativeSourceKind::Clipboard => "open-clipboard-source",
        NativeSourceKind::PrintSpooler => "open-print-spooler-source",
        NativeSourceKind::RemovableStorage => "open-removable-storage-source",
        NativeSourceKind::Virtualization => "open-virtualization-source",
        NativeSourceKind::NetworkConfiguration => "open-network-source",
        NativeSourceKind::MediaDevice => "open-media-device-source",
    }
}

fn cleanup_opened_sources(sources: &mut [OpenedErasedSource]) -> Vec<NativeSourceKind> {
    sources
        .iter_mut()
        .rev()
        .filter_map(|opened| {
            let kind = opened.source.kind();
            let outcome = opened.source.stop();
            (!outcome.closed_input_boundary || outcome.batch.health() == SourceHealth::Failed)
                .then_some(kind)
        })
        .collect()
}
