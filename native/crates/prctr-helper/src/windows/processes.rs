use crate::platform::{ProcessEvent, ProcessSink, ProcessSource, ProcessWatch};
use crate::processes::RawStart;
use ferrisetw::{
    parser::Parser,
    provider::Provider,
    trace::{TraceTrait, UserTrace, stop_trace_by_name},
};
use std::sync::{Arc, mpsc};
use std::time::Duration;

const NAME: &str = "ProctorNativeProcessTrace";
pub struct Processes;
struct Watch {
    trace: Option<UserTrace>,
    stop: mpsc::Sender<()>,
    loss_thread: Option<std::thread::JoinHandle<()>>,
    processing: Option<std::thread::JoinHandle<()>>,
}
impl ProcessWatch for Watch {}
impl Drop for Watch {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        drop(self.trace.take());
        if let Some(thread) = self.loss_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.processing.take() {
            let _ = thread.join();
        }
    }
}
impl ProcessSource for Processes {
    fn start(&self, sink: ProcessSink) -> Result<Box<dyn ProcessWatch>, String> {
        let sink: Arc<dyn Fn(ProcessEvent) + Send + Sync> = Arc::from(sink);
        let callback = Arc::clone(&sink);
        let provider = Provider::by_guid("22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716")
            .any(0x10)
            .add_callback(move |record, locator| {
                if !matches!(record.event_id(), 1 | 2) {
                    return;
                }
                let event = (|| {
                    let schema = locator.event_schema(record).ok()?;
                    let parser = Parser::create(record, &schema);
                    let pid = parser.try_parse::<u32>("ProcessID").ok()?;
                    // ferrisetw 1.2.0 FileTime::as_quad repeats the high word in the low word.
                    // Decode its exact 8-byte property as u64, then use our shared epoch converter.
                    let created = prctr_os::helper::filetime_to_unix(
                        parser.try_parse::<u64>("CreateTime").ok()?,
                    )?;
                    Some(if record.event_id() == 1 {
                        ProcessEvent::Started(RawStart {
                            pid,
                            created,
                            parent: parser.try_parse("ParentProcessID").ok()?,
                            session: parser.try_parse("SessionID").ok()?,
                        })
                    } else {
                        ProcessEvent::Stopped { pid, created }
                    })
                })();
                callback(event.unwrap_or(ProcessEvent::Lost));
            })
            .build();
        let _ = stop_trace_by_name(NAME);
        let (trace, handle) = UserTrace::new()
            .named(NAME.into())
            .enable(provider)
            .start()
            .map_err(|_| "ETW start failed".to_owned())?;
        let ended = Arc::clone(&sink);
        let processing = std::thread::Builder::new()
            .name("prctr-helper-etw".into())
            .spawn(move || {
                let _ = UserTrace::process_from_handle(handle);
                ended(ProcessEvent::Unavailable);
            })
            .map_err(|_| "ETW consumer thread failed".to_owned())?;
        let (stop, shutdown) = mpsc::channel();
        let loss_thread = std::thread::Builder::new()
            .name("prctr-helper-etw-loss".into())
            .spawn(move || {
                let mut previous = 0;
                while matches!(
                    shutdown.recv_timeout(Duration::from_millis(100)),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ) {
                    if let Ok(count) = prctr_os::windows::helper::events_lost(NAME) {
                        if count != previous {
                            sink(ProcessEvent::Lost);
                        }
                        previous = count;
                    } else {
                        sink(ProcessEvent::Unavailable);
                        break;
                    }
                }
            })
            .map_err(|_| "ETW loss thread failed".to_owned())?;
        Ok(Box::new(Watch {
            trace: Some(trace),
            stop,
            loss_thread: Some(loss_thread),
            processing: Some(processing),
        }))
    }
    fn snapshot(&self) -> Option<Vec<RawStart>> {
        Some(
            prctr_os::windows::helper::snapshot()?
                .into_iter()
                .map(crate::os_start)
                .collect(),
        )
    }
}
