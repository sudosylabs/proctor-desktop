//! Passive, bounded Windows kernel-process ETW ingress for a privileged helper.
//!
//! This is an event-feed building block, not a complete inventory, executable
//! identity verifier, WTS service, or supported-platform claim. Source startup
//! must still reconcile inventory and event capture before declaring readiness.
//! No path, image name, argument, environment, SID or executable content is read.
//! Schema evidence: microsoft/Tx `Generated/Microsoft_Windows_Kernel_Process.cs`,
//! ProcessStart/Stop v0/v1. Only the fixed scalar prefix is decoded.

#![allow(unsafe_code)]

use std::mem::{offset_of, size_of};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::Ordering;
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::windows_etw_core::{
    BACKEND_FAILURE, Ingress, SCHEMA_FAILURE, decode_prefix, handoff_and_consume, settle_cleanup,
    validate_open_boundary,
};
pub use super::windows_etw_core::{
    WindowsEtwDrain, WindowsEtwFailure, WindowsEtwProcessEvent, WindowsProcessLifetime,
};
use prctr_native_source_runtime::{
    ensure_native_source_process_usable, poison_native_source_process,
};
use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_CANCELLED, ERROR_SUCCESS};
use windows_sys::Win32::System::Diagnostics::Etw::{
    CONTROLTRACE_HANDLE, CloseTrace, ControlTraceW, ENABLE_TRACE_PARAMETERS,
    ENABLE_TRACE_PARAMETERS_VERSION_2, EVENT_CONTROL_CODE_ENABLE_PROVIDER, EVENT_FILTER_DESCRIPTOR,
    EVENT_FILTER_TYPE_EVENT_ID, EVENT_RECORD, EVENT_TRACE_CONTROL_QUERY, EVENT_TRACE_CONTROL_STOP,
    EVENT_TRACE_INDEPENDENT_SESSION_MODE, EVENT_TRACE_LOGFILEW,
    EVENT_TRACE_NO_PER_PROCESSOR_BUFFERING, EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE,
    EnableTraceEx2, OpenTraceW, PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_RAW_TIMESTAMP,
    PROCESS_TRACE_MODE_REAL_TIME, PROCESSTRACE_HANDLE, ProcessTrace, StartTraceW,
    WNODE_FLAG_TRACED_GUID,
};
use windows_sys::core::GUID;

const PROVIDER: GUID = GUID::from_u128(0x22fb2cd6_0e7b_422b_a0c7_2fad1fd0e716);
const PROCESS_KEYWORD: u64 = 0x10;
const MAX_QUEUE: usize = 1024;

#[repr(C)]
struct TraceProperties {
    properties: EVENT_TRACE_PROPERTIES,
    logger_name: [u16; 96],
}

impl TraceProperties {
    fn new(identity: [u8; 16]) -> Self {
        let mut value = Self {
            properties: EVENT_TRACE_PROPERTIES::default(),
            logger_name: [0; 96],
        };
        let name = format!("Proctor.Process.{:032x}", u128::from_be_bytes(identity));
        for (slot, unit) in value.logger_name.iter_mut().zip(name.encode_utf16()) {
            *slot = unit;
        }
        value.properties.Wnode.BufferSize =
            u32::try_from(size_of::<Self>()).expect("fixed trace properties fit u32");
        value.properties.Wnode.Guid = GUID::from_u128(u128::from_be_bytes(identity));
        value.properties.Wnode.ClientContext = 1; // QPC; matches RAW_TIMESTAMP below.
        value.properties.Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        value.properties.BufferSize = 64; // KiB, no on-disk log.
        value.properties.MinimumBuffers = 2;
        value.properties.MaximumBuffers = 8;
        // Independent mode prevents another enabled logger's EventWrite
        // failure from suppressing this feed without local loss counters.
        // https://learn.microsoft.com/en-us/windows/win32/etw/logging-mode-constants
        value.properties.LogFileMode = EVENT_TRACE_REAL_TIME_MODE
            | EVENT_TRACE_NO_PER_PROCESSOR_BUFFERING
            | EVENT_TRACE_INDEPENDENT_SESSION_MODE;
        value.properties.FlushTimer = 1;
        value.properties.LoggerNameOffset =
            u32::try_from(offset_of!(Self, logger_name)).expect("fixed offset fits u32");
        value
    }
}

#[repr(C)]
struct ProcessEventFilter {
    filter_in: bool,
    reserved: u8,
    count: u16,
    ids: [u16; 2],
}

/// Owns one real-time logger and its consumer worker. Run only in the separately
/// killable service/helper: Windows controller APIs have no per-call deadline.
/// The external broker must kill and observe exit on an SDK stall.
pub struct WindowsEtwProcessFeed {
    controller: Option<CONTROLTRACE_HANDLE>,
    ingress: Arc<Ingress>,
    receiver: mpsc::Receiver<WindowsEtwProcessEvent>,
    done: mpsc::Receiver<()>,
    worker: Option<JoinHandle<Result<(), WindowsEtwFailure>>>,
    capacity: usize,
}

impl WindowsEtwProcessFeed {
    /// Opens an isolated logger using a fresh opaque broker-generated identity.
    /// It never attaches to, stops or modifies another logger on name collision.
    ///
    /// # Errors
    /// Returns explicit permission, startup, schema, or cleanup failure. The
    /// absolute deadline covers all phases; an unjoined worker poisons reuse.
    pub fn open(
        identity: [u8; 16],
        capacity: usize,
        deadline: Instant,
    ) -> Result<Self, WindowsEtwFailure> {
        ensure_native_source_process_usable().map_err(|_| WindowsEtwFailure::Cleanup)?;
        if identity == [0; 16] || !(2..=MAX_QUEUE).contains(&capacity) || Instant::now() >= deadline
        {
            return Err(WindowsEtwFailure::Backend);
        }
        let mut properties = TraceProperties::new(identity);
        let mut controller = CONTROLTRACE_HANDLE::default();
        // SAFETY: properties is one aligned contiguous allocation containing the
        // required logger-name buffer, with fixed validated size/offsets.
        let status = unsafe {
            StartTraceW(
                &raw mut controller,
                properties.logger_name.as_ptr(),
                &raw mut properties.properties,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        let (sender, receiver) = mpsc::sync_channel(capacity);
        let ingress = Arc::new(Ingress::new(sender));
        let (ready_send, ready_receive) = mpsc::sync_channel(1);
        let (done_send, done) = mpsc::sync_channel(1);
        let mut feed = Self {
            controller: Some(controller),
            ingress,
            receiver,
            done,
            worker: None,
            capacity,
        };
        let enabled = enable_process_events(controller, deadline);
        if let Err(error) = enabled {
            feed.close(deadline)?;
            return Err(error);
        }
        let worker_ingress = Arc::clone(&feed.ingress);
        let logger_name = properties.logger_name;
        let spawned = thread::Builder::new()
            .name("proctor-process-etw".to_owned())
            .spawn(move || {
                let outcome = consume_trace(logger_name, &worker_ingress, &ready_send);
                let _sent = done_send.try_send(());
                outcome
            });
        if let Ok(worker) = spawned {
            feed.worker = Some(worker);
        } else {
            feed.close(deadline)?;
            return Err(WindowsEtwFailure::Backend);
        }
        match ready_receive.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                feed.close(deadline)?;
                return Err(error);
            }
            Err(_) => {
                feed.close(deadline)?;
                return Err(WindowsEtwFailure::Backend);
            }
        }
        // Query controller loss even before the first buffer callback. An open
        // consumer is not evidence that startup buffers were never dropped.
        feed.query_loss();
        if let Some(error) = feed.ingress.failure() {
            feed.close(deadline)?;
            return Err(error);
        }
        if let Err(error) = validate_open_boundary(deadline, || {
            ensure_native_source_process_usable().map_err(|_| WindowsEtwFailure::Cleanup)
        }) {
            feed.close(deadline)?;
            return Err(error);
        }
        Ok(feed)
    }

    /// Drains at most the configured queue bound and reports terminal loss even
    /// when no ordinary slot remains. Poll while active to inspect logger loss.
    pub fn drain(&mut self) -> WindowsEtwDrain {
        self.query_loss();
        self.ingress.drain(&self.receiver, self.capacity)
    }

    fn query_loss(&self) {
        let Some(controller) = self.controller else {
            return;
        };
        let mut properties = TraceProperties::new([1; 16]);
        // SAFETY: the handle is owned, query selects by handle and output has a
        // bounded logger-name buffer. No foreign logger name is supplied.
        let status = unsafe {
            ControlTraceW(
                controller,
                std::ptr::null(),
                &raw mut properties.properties,
                EVENT_TRACE_CONTROL_QUERY,
            )
        };
        if status != ERROR_SUCCESS {
            self.ingress.fail(BACKEND_FAILURE);
            return;
        }
        self.ingress.loss(
            properties.properties.EventsLost,
            properties
                .properties
                .RealTimeBuffersLost
                .saturating_add(properties.properties.LogBuffersLost),
        );
    }

    /// Fences callback intake, stops only the owned logger and proves the worker
    /// exited. Accepted queued events remain available through `drain`.
    ///
    /// # Errors
    /// A failed controller call or unobserved worker exit poisons the helper.
    pub fn close(&mut self, deadline: Instant) -> Result<(), WindowsEtwFailure> {
        self.ingress.accepting.store(false, Ordering::Release);
        let mut failed = false;
        let mut worker_outcome = Ok(());
        if let Some(controller) = self.controller.take() {
            let mut properties = TraceProperties::new([1; 16]);
            // SAFETY: only this feed owns the controller handle; output storage
            // remains live throughout the synchronous stop operation.
            let status = unsafe {
                ControlTraceW(
                    controller,
                    std::ptr::null(),
                    &raw mut properties.properties,
                    EVENT_TRACE_CONTROL_STOP,
                )
            };
            self.ingress.loss(
                properties.properties.EventsLost,
                properties
                    .properties
                    .RealTimeBuffersLost
                    .saturating_add(properties.properties.LogBuffersLost),
            );
            failed |= status != ERROR_SUCCESS;
        }
        if let Some(worker) = self.worker.take() {
            if self
                .done
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .is_ok()
                || worker.is_finished()
            {
                worker_outcome = worker.join().unwrap_or(Err(WindowsEtwFailure::Cleanup));
            } else {
                // The worker owns callback memory. Detach rather than release
                // it under native callbacks; the poisoned process must be killed.
                drop(worker);
                worker_outcome = Err(WindowsEtwFailure::Cleanup);
            }
        }
        if settle_cleanup(failed, worker_outcome, poison_native_source_process)?.is_some() {
            // ProcessTrace failure is a source outcome, not proof of a leaked
            // consumer. Preserve it in the ordinary terminal source channel.
            self.ingress.fail(BACKEND_FAILURE);
        }
        Ok(())
    }
}

impl Drop for WindowsEtwProcessFeed {
    fn drop(&mut self) {
        let _closed = self.close(Instant::now() + Duration::from_secs(2));
    }
}

fn enable_process_events(
    controller: CONTROLTRACE_HANDLE,
    deadline: Instant,
) -> Result<(), WindowsEtwFailure> {
    let timeout = deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .min(1000);
    if timeout == 0 {
        return Err(WindowsEtwFailure::Backend);
    }
    let filter = ProcessEventFilter {
        filter_in: true,
        reserved: 0,
        count: 2,
        ids: [1, 2],
    };
    let mut descriptor = EVENT_FILTER_DESCRIPTOR {
        Ptr: std::ptr::from_ref(&filter) as u64,
        Size: u32::try_from(size_of::<ProcessEventFilter>()).expect("fixed filter size"),
        Type: EVENT_FILTER_TYPE_EVENT_ID,
    };
    let parameters = ENABLE_TRACE_PARAMETERS {
        Version: ENABLE_TRACE_PARAMETERS_VERSION_2,
        EnableFilterDesc: &raw mut descriptor,
        FilterDescCount: 1,
        ..ENABLE_TRACE_PARAMETERS::default()
    };
    // SAFETY: the fixed filter/descriptor remain live until the synchronous
    // enable completes. Only this provider's start/stop event IDs are enabled.
    let status = unsafe {
        EnableTraceEx2(
            controller,
            &PROVIDER,
            EVENT_CONTROL_CODE_ENABLE_PROVIDER,
            4,
            PROCESS_KEYWORD,
            0,
            u32::try_from(timeout).expect("bounded timeout"),
            &raw const parameters,
        )
    };
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(map_error(status))
    }
}

struct OwnedTraceConsumer {
    handle: Option<PROCESSTRACE_HANDLE>,
}
impl OwnedTraceConsumer {
    fn close(&mut self) -> Result<(), WindowsEtwFailure> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        // SAFETY: the worker is the sole owner and has returned from ProcessTrace
        // (or never entered it). No controller-side code can close this handle.
        if unsafe { CloseTrace(handle) } != ERROR_SUCCESS {
            poison_native_source_process();
            return Err(WindowsEtwFailure::Cleanup);
        }
        Ok(())
    }
}
impl Drop for OwnedTraceConsumer {
    fn drop(&mut self) {
        let _closed = self.close();
    }
}

fn consume_trace(
    mut logger_name: [u16; 96],
    ingress: &Arc<Ingress>,
    ready: &mpsc::SyncSender<Result<(), WindowsEtwFailure>>,
) -> Result<(), WindowsEtwFailure> {
    let mut logfile = EVENT_TRACE_LOGFILEW {
        LoggerName: logger_name.as_mut_ptr(),
        Context: Arc::as_ptr(ingress).cast_mut().cast(),
        BufferCallback: Some(buffer_callback),
        ..EVENT_TRACE_LOGFILEW::default()
    };
    logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_EVENT_RECORD
        | PROCESS_TRACE_MODE_RAW_TIMESTAMP
        | PROCESS_TRACE_MODE_REAL_TIME;
    logfile.Anonymous2.EventRecordCallback = Some(event_callback);
    // SAFETY: logger-name and context allocations outlive the blocking consumer.
    let consumer = unsafe { OpenTraceW(&raw mut logfile) };
    if consumer.Value == u64::MAX {
        let _sent = ready.try_send(Err(WindowsEtwFailure::Backend));
        return Err(WindowsEtwFailure::Backend);
    }
    let mut owned = OwnedTraceConsumer {
        handle: Some(consumer),
    };
    handoff_and_consume(
        ready,
        &ingress.accepting,
        || {
            // SAFETY: callback context remains Arc-owned until ProcessTrace exits.
            // Only the worker owns this consumer; stopping the owned logger lets
            // ProcessTrace return. A Windows stall is supervised by helper deadline.
            let status =
                unsafe { ProcessTrace(&raw const consumer, 1, std::ptr::null(), std::ptr::null()) };
            if ingress.accepting.load(Ordering::Acquire)
                || (status != ERROR_SUCCESS && status != ERROR_CANCELLED)
            {
                ingress.fail(BACKEND_FAILURE);
                return Err(WindowsEtwFailure::Backend);
            }
            Ok(())
        },
        || owned.close(),
    )
}

unsafe extern "system" fn buffer_callback(logfile: *mut EVENT_TRACE_LOGFILEW) -> u32 {
    // SAFETY: ETW supplies the live logfile structure initialized by this worker.
    let logfile = unsafe { &*logfile };
    // SAFETY: Context points to the Arc retained through ProcessTrace completion.
    let ingress = unsafe { &*logfile.Context.cast::<Ingress>() };
    ingress.loss(logfile.EventsLost, 0);
    u32::from(ingress.accepting.load(Ordering::Acquire))
}

unsafe extern "system" fn event_callback(record: *mut EVENT_RECORD) {
    // SAFETY: callback pointer and context are supplied by the active consumer.
    let record = unsafe { &*record };
    let ingress = unsafe { &*record.UserContext.cast::<Ingress>() };
    if !ingress.accepting.load(Ordering::Acquire) {
        return;
    }
    let result = catch_unwind(AssertUnwindSafe(|| {
        if !same_guid(&record.EventHeader.ProviderId, &PROVIDER) {
            return;
        }
        let descriptor = record.EventHeader.EventDescriptor;
        if descriptor.Id != 1 && descriptor.Id != 2 {
            return;
        }
        let required = if descriptor.Id == 1 { 20 } else { 12 };
        if descriptor.Version > 1
            || usize::from(record.UserDataLength) < required
            || record.UserData.is_null()
        {
            ingress.fail(SCHEMA_FAILURE);
            return;
        }
        let mut prefix = [0_u8; 20];
        // SAFETY: only the checked fixed numeric prefix is copied. The remaining
        // OS payload, including ImageName, is neither accessed nor retained.
        unsafe {
            std::ptr::copy_nonoverlapping(
                record.UserData.cast::<u8>(),
                prefix.as_mut_ptr(),
                required,
            );
        }
        let decoded = decode_prefix(
            descriptor.Id,
            descriptor.Version,
            record.EventHeader.TimeStamp,
            &prefix[..required],
        );
        for byte in &mut prefix {
            // Volatile erase of transient PID/time/session scalars.
            // SAFETY: each byte is initialized, exclusively borrowed storage.
            unsafe {
                std::ptr::write_volatile(byte, 0);
            }
        }
        match decoded {
            Ok(event) => ingress.submit(event),
            Err(_) => ingress.fail(SCHEMA_FAILURE),
        }
    }));
    if result.is_err() {
        ingress.fail(BACKEND_FAILURE);
    }
}

fn same_guid(left: &GUID, right: &GUID) -> bool {
    left.data1 == right.data1
        && left.data2 == right.data2
        && left.data3 == right.data3
        && left.data4 == right.data4
}
fn map_error(code: u32) -> WindowsEtwFailure {
    if code == ERROR_ACCESS_DENIED {
        WindowsEtwFailure::Permission
    } else {
        WindowsEtwFailure::Backend
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logger_is_independent_of_other_provider_sessions() {
        let properties = TraceProperties::new([1; 16]);
        assert_ne!(
            properties.properties.LogFileMode & EVENT_TRACE_INDEPENDENT_SESSION_MODE,
            0
        );
        assert_ne!(
            properties.properties.LogFileMode & EVENT_TRACE_REAL_TIME_MODE,
            0
        );
        assert_ne!(
            properties.properties.LogFileMode & EVENT_TRACE_NO_PER_PROCESSOR_BUFFERING,
            0
        );
    }
}
