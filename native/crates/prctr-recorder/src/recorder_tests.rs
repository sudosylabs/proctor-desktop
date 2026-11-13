use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::*;
use crate::media::{Frame, StreamFormat};
use crate::mp4::walker;
use crate::store::tests::temporary;

/// Frames at 5 fps on a shared clock that the test advances.
struct Scripted {
    clock: Arc<AtomicU64>,
    fail_after: Option<u64>,
}

impl FrameSource for Scripted {
    fn next_frame(&mut self, _timeout: Duration) -> Result<Option<Frame>, String> {
        let now = self.clock.fetch_add(200, Ordering::AcqRel) + 200;
        if self.fail_after.is_some_and(|limit| now > limit) {
            return Err("capture failed".to_owned());
        }
        std::thread::sleep(Duration::from_millis(1));
        Ok(Some(Frame {
            width: 4,
            height: 2,
            stride: 16,
            bgra: vec![0x11; 32],
            captured_ms: now,
            display: Rect {
                x: 0.0,
                y: 0.0,
                width: 4.0,
                height: 2.0,
            },
        }))
    }
}

/// Echoes each frame's first pixel, so a test can see the placeholder; keyframes as asked.
struct Echo;

impl Encoder for Echo {
    fn encode(&mut self, frame: &Frame, keyframe: bool) -> Result<Vec<EncodedSample>, String> {
        let nal = if keyframe { 0x65 } else { 0x41 };
        Ok(vec![EncodedSample {
            data: vec![0, 0, 0, 2, nal, frame.bgra[0]],
            keyframe,
        }])
    }

    fn format(&self) -> Option<StreamFormat> {
        Some(StreamFormat {
            width: 4,
            height: 2,
            sps: vec![0x67, 0x42, 0, 0x0A],
            pps: vec![0x68, 0xCE],
        })
    }
}

struct Run {
    recorder: Recorder,
    events: Receiver<RecorderEvent>,
    clock: Arc<AtomicU64>,
    dir: PathBuf,
}

fn start(name: &str, placeholder: Option<Rect>, fail_after: Option<u64>, free: u64) -> Run {
    let dir = temporary(name);
    let clock = Arc::new(AtomicU64::new(10_000));
    let now = Arc::clone(&clock);
    let (sender, events) = mpsc::channel();
    let sender = Mutex::new(sender);
    let recorder = Recorder::start(
        RecorderConfig {
            dir: dir.clone(),
            recording_id: "rec1".to_owned(),
            key: [9; 32],
            fps: 5,
            segment_ms: 2_000,
            reserve_bytes: 1_000,
            chunk_bytes: clip::CHUNK_BYTES,
            placeholder: Arc::new(move || placeholder),
            free_space: Arc::new(move |_| Some(free)),
            now_ms: Arc::new(move || now.load(Ordering::Acquire)),
        },
        Box::new(Scripted {
            clock: Arc::clone(&clock),
            fail_after,
        }),
        Box::new(Echo),
        move |event| {
            let _ = sender.lock().map(|sender| sender.send(event));
        },
    )
    .expect("starts");
    Run {
        recorder,
        events,
        clock,
        dir,
    }
}

fn clip_event(events: &Receiver<RecorderEvent>) -> (String, Result<ClipManifest, ClipFailure>) {
    loop {
        match events
            .recv_timeout(Duration::from_secs(10))
            .expect("an event")
        {
            RecorderEvent::Clip { request_id, result } => return (request_id, result),
            RecorderEvent::State { .. } => {}
        }
    }
}

fn wait_until(clock: &AtomicU64, at_ms: u64) {
    while clock.load(Ordering::Acquire) < at_ms {
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn a_future_save_completes_once_recorded_with_keyframe_segments() {
    let run = start("future", None, None, u64::MAX);
    run.recorder
        .save(
            "r1",
            ClipRange {
                from_session_start: true,
                start_ms: None,
                end_ms: 15_000,
            },
        )
        .expect("accepted");
    let (request_id, result) = clip_event(&run.events);
    assert_eq!(request_id, "r1");
    let manifest = result.expect("a clip");
    assert!(manifest.end_ms >= 15_000, "it waited for the future part");
    assert!(run.clock.load(Ordering::Acquire) >= 15_000);
    let mp4 = clip::open(&manifest, clip::CHUNK_BYTES).expect("opens");
    let fragments: Vec<_> = walker::boxes(&mp4)
        .into_iter()
        .filter(|found| &found.kind == b"mdat")
        .collect();
    assert!(fragments.len() >= 2);
    assert!(
        fragments.iter().all(|mdat| mdat.body[4] == 0x65),
        "every segment starts with a keyframe"
    );
    run.recorder.stop(Disposition::Delete);
    assert!(!run.dir.exists(), "deleted at submission");
}

#[test]
fn the_placeholder_is_painted_before_encoding() {
    let run = start(
        "placeholder",
        Some(Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        }),
        None,
        u64::MAX,
    );
    wait_until(&run.clock, 13_000);
    run.recorder
        .save(
            "r1",
            ClipRange {
                from_session_start: true,
                start_ms: None,
                end_ms: 12_000,
            },
        )
        .expect("accepted");
    let manifest = clip_event(&run.events).1.expect("a clip");
    let mp4 = clip::open(&manifest, clip::CHUNK_BYTES).expect("opens");
    let mdat = walker::boxes(&mp4)
        .into_iter()
        .find(|found| &found.kind == b"mdat")
        .expect("media");
    assert_eq!(
        mdat.body[5], 0x80,
        "the encoder saw the grey placeholder, not the screen"
    );
    run.recorder.stop(Disposition::Delete);
}

#[test]
fn a_capture_failure_fails_with_a_gap_and_recorded_video_can_still_be_cut() {
    let run = start("failure", None, Some(14_000), u64::MAX);
    let failed = loop {
        if let RecorderEvent::State {
            state: RecorderState::Failed,
            gaps,
        } = run
            .events
            .recv_timeout(Duration::from_secs(10))
            .expect("an event")
        {
            break gaps;
        }
    };
    assert_eq!(
        failed.last().map(|gap| gap.reason),
        Some(GapReason::Failure)
    );
    run.recorder
        .save(
            "r1",
            ClipRange {
                from_session_start: true,
                start_ms: None,
                end_ms: 60_000,
            },
        )
        .expect("accepted");
    let manifest = clip_event(&run.events).1.expect("what was recorded");
    assert!(manifest.end_ms <= 15_000);
    run.recorder.stop(Disposition::Delete);
}

#[test]
fn a_full_disk_stops_recording_rather_than_trimming() {
    let run = start("disk", None, None, 10);
    let state = loop {
        let event = run
            .events
            .recv_timeout(Duration::from_secs(10))
            .expect("an event");
        match event {
            RecorderEvent::State { state, .. } if state != RecorderState::Recording => break state,
            _ => {}
        }
    };
    assert_eq!(state, RecorderState::Failed);
    run.recorder.stop(Disposition::Delete);
}

#[test]
fn sealing_keeps_the_recording_and_a_restart_continues_it_with_a_gap() {
    let run = start("seal", None, None, u64::MAX);
    wait_until(&run.clock, 14_000);
    run.recorder.stop(Disposition::Seal);
    assert!(run.dir.join("index.seal").exists());
    let (store, resumed) = Store::open(&run.dir, "rec1", &[9; 32], 100_000).expect("reopens");
    assert!(resumed);
    assert_eq!(
        store.gaps().last().map(|gap| gap.reason),
        Some(GapReason::Restart)
    );
    store.delete().expect("deletes");
}

#[test]
fn release_deletes_an_uploaded_clip_and_a_repeated_request_is_ignored() {
    let run = start("release", None, None, u64::MAX);
    wait_until(&run.clock, 13_000);
    let range = ClipRange {
        from_session_start: true,
        start_ms: None,
        end_ms: 12_000,
    };
    run.recorder.save("r1", range).expect("accepted");
    let manifest = clip_event(&run.events).1.expect("a clip");
    run.recorder.save("r1", range).expect("accepted again");
    run.recorder.release("r1");
    run.recorder
        .save(
            "r2",
            ClipRange {
                from_session_start: false,
                start_ms: Some(10_000),
                end_ms: 11_000,
            },
        )
        .expect("accepted");
    let (second, _) = clip_event(&run.events);
    assert_eq!(second, "r2", "the repeated r1 produced no second clip");
    assert!(!manifest.path.exists(), "released");
    assert_eq!(
        run.recorder.save(
            "r3",
            ClipRange {
                from_session_start: false,
                start_ms: None,
                end_ms: 1
            }
        ),
        Err(SaveRefusal::InvalidRange)
    );
    run.recorder.stop(Disposition::Delete);
}
