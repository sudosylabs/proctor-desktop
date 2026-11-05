use super::*;

#[test]
fn small_control_frame_limit_rejects_before_reading_the_payload() {
    let mut input = io::Cursor::new(4097_u32.to_be_bytes());
    assert!(matches!(
        read_frame_bounded(&mut input, 4096),
        Err(HelperTransportError::Protocol(
            HelperProtocolError::FrameSize
        ))
    ));
    assert_eq!(input.position(), 4);
}

#[cfg(unix)]
#[test]
fn idle_poll_retains_one_read_and_a_later_request_consumes_its_result() {
    use std::os::unix::net::UnixStream;
    let (socket, mut peer) = UnixStream::pair().unwrap();
    let mut transport =
        DeadlineFramedTransport::new(socket.try_clone().unwrap(), socket.try_clone().unwrap())
            .unwrap();
    for _ in 0..8 {
        assert!(transport.poll_read_bytes(Duration::ZERO).unwrap().is_none());
        assert!(transport.pending_read.borrow().is_some());
    }
    write_frame(&mut peer, b"one frame").unwrap();
    assert_eq!(
        transport.read_bytes(Duration::from_secs(1)).unwrap(),
        b"one frame"
    );
    assert!(transport.pending_read.borrow().is_none());
    socket.shutdown(std::net::Shutdown::Both).unwrap();
    transport.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn a_started_but_unfinished_frame_has_a_deadline_even_during_polling() {
    use std::os::unix::net::UnixStream;
    let (socket, mut peer) = UnixStream::pair().unwrap();
    let mut transport =
        DeadlineFramedTransport::new(socket.try_clone().unwrap(), socket.try_clone().unwrap())
            .unwrap();
    assert!(transport.poll_read_bytes(Duration::ZERO).unwrap().is_none());
    peer.write_all(&[0]).unwrap();
    {
        let mut pending = transport.pending_read.borrow_mut();
        let read = pending.as_mut().unwrap();
        read.started.recv_timeout(Duration::from_secs(1)).unwrap();
        read.frame_deadline = Some(Instant::now().checked_sub(Duration::from_secs(1)).unwrap());
    }
    assert!(matches!(
        transport.poll_read_bytes(Duration::ZERO),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    socket.shutdown(std::net::Shutdown::Both).unwrap();
    transport.shutdown().unwrap();
}

#[test]
fn completion_time_enforces_deadline_even_when_start_was_not_previously_polled() {
    let now = Instant::now();
    for (completed_at, accepted) in [
        (now.checked_sub(Duration::from_secs(2)).unwrap(), true),
        (now, false),
    ] {
        let mut transport = DeadlineFramedTransport::new(io::sink(), io::empty()).unwrap();
        let (response, result) = mpsc::sync_channel(1);
        let (started, progress) = mpsc::sync_channel(1);
        started
            .send(
                now.checked_sub(HELPER_REQUEST_DEADLINE + Duration::from_secs(1))
                    .unwrap(),
            )
            .unwrap();
        response
            .send(CompletedRead {
                completed_at,
                result: Ok(b"queued".to_vec()),
            })
            .unwrap();
        *transport.pending_read.borrow_mut() = Some(PendingRead {
            response: result,
            started: progress,
            frame_deadline: None,
        });
        let result = transport.poll_read_bytes(Duration::ZERO);
        if accepted {
            assert_eq!(result.unwrap(), Some(b"queued".to_vec()));
        } else {
            assert!(matches!(
                result,
                Err(HelperTransportError::DeadlineExceeded)
            ));
        }
        transport.shutdown().unwrap();
    }
}

#[test]
fn start_and_late_completion_received_during_wait_are_rejected() {
    let mut transport = DeadlineFramedTransport::new(io::sink(), io::empty()).unwrap();
    let (response, result) = mpsc::sync_channel(1);
    let (started, progress) = mpsc::sync_channel(1);
    *transport.pending_read.borrow_mut() = Some(PendingRead {
        response: result,
        started: progress,
        frame_deadline: None,
    });
    let sender = thread::spawn(move || {
        let now = Instant::now();
        started
            .send(
                now.checked_sub(HELPER_REQUEST_DEADLINE + Duration::from_secs(1))
                    .unwrap(),
            )
            .unwrap();
        response
            .send(CompletedRead {
                completed_at: now,
                result: Ok(vec![1]),
            })
            .unwrap();
    });
    assert!(matches!(
        transport.poll_read_bytes(Duration::from_secs(1)),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    sender.join().unwrap();
    transport.shutdown().unwrap();
}

#[test]
fn a_sent_result_does_not_allow_an_unbounded_worker_join() {
    let (result, received) = mpsc::sync_channel(1);
    let (release, blocked) = mpsc::sync_channel(1);
    let (finished, completion) = mpsc::sync_channel(1);
    let mut worker = WorkerJoinReceipt::spawn("sent-result-test", move || {
        result.send(()).unwrap();
        blocked.recv().unwrap();
        finished.send(()).unwrap();
    })
    .unwrap();
    received.recv().unwrap();
    assert!(matches!(
        worker.wait(Instant::now()),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    release.send(()).unwrap();
    completion.recv_timeout(Duration::from_secs(1)).unwrap();
}

struct BlockingThreadLocalDrop {
    entered: mpsc::SyncSender<()>,
    release: Receiver<()>,
}
impl Drop for BlockingThreadLocalDrop {
    fn drop(&mut self) {
        self.entered.send(()).unwrap();
        self.release.recv().unwrap();
    }
}
thread_local! {
    static BLOCKING_THREAD_LOCAL: RefCell<Option<BlockingThreadLocalDrop>> = const { RefCell::new(None) };
}

#[test]
fn actual_join_receipt_waits_for_tls_cleanup_without_blocking_its_caller() {
    let (entered, in_destructor) = mpsc::sync_channel(1);
    let (release, blocked) = mpsc::sync_channel(1);
    let mut worker = WorkerJoinReceipt::spawn("tls-join-test", move || {
        BLOCKING_THREAD_LOCAL.with(|value| {
            *value.borrow_mut() = Some(BlockingThreadLocalDrop {
                entered,
                release: blocked,
            });
        });
    })
    .unwrap();
    in_destructor.recv_timeout(Duration::from_secs(3)).unwrap();
    // The main function has returned. JoinHandle::is_finished is already true
    // here on macOS, but the actual OS join must wait for this destructor.
    assert!(matches!(
        worker.wait(Instant::now()),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    release.send(()).unwrap();
    worker
        .wait(Instant::now() + Duration::from_secs(3))
        .unwrap();
    // A previously observed actual join needs no new cleanup budget.
    worker
        .wait(Instant::now().checked_sub(Duration::from_secs(1)).unwrap())
        .unwrap();
}

#[cfg(unix)]
#[test]
#[allow(
    unsafe_code,
    reason = "test-only waitpid verifies actual owned child reaping, not merely closing a pipe"
)]
fn abandoned_buffered_spawn_result_terminates_and_reaps_its_child() {
    unsafe extern "C" {
        fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
    }
    for send_before_receiver_drop in [true, false] {
        let mut child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        assert!(child.try_wait().unwrap().is_none());
        let pid = i32::try_from(child.id()).unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        if send_before_receiver_drop {
            assert!(sender.send(PendingSpawnedChild(Some(child))).is_ok());
            // Model a result queued immediately before the caller's deadline
            // path wins: it is never received or explicitly terminated by it.
            drop(receiver);
        } else {
            drop(receiver);
            let _ = sender.send(PendingSpawnedChild(Some(child)));
        }
        let mut status = 0;
        // SAFETY: this is our child's PID and valid status storage; WNOHANG=1
        // on both admitted Unix test targets. A leaked live child returns zero.
        let result = unsafe { waitpid(pid, &raw mut status, 1) };
        let error = io::Error::last_os_error();
        if result == 0 {
            // Bound cleanup even if the regression is reintroduced.
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            // SAFETY: an unreaped owned child cannot have its PID reused.
            assert_eq!(unsafe { kill(pid, 9) }, 0);
            let cleanup_deadline = Instant::now() + Duration::from_secs(3);
            while unsafe { waitpid(pid, &raw mut status, 1) } == 0 {
                assert!(
                    Instant::now() < cleanup_deadline,
                    "test child cleanup deadline"
                );
                thread::sleep(Duration::from_millis(5));
            }
        }
        assert_eq!(result, -1, "guard must observe and reap child exit");
        assert_eq!(error.raw_os_error(), Some(10), "ECHILD after owned reap");
    }
}
