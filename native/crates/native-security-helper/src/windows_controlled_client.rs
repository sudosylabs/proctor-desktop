//! Controlled user-session launch from the verified immutable release closure.
use crate::{
    HelperTransportError, WindowsLaunchUser, WindowsProtectedLaunchClosure,
    ensure_helper_utility_usable, poison_helper_utility, remaining,
};
use std::mem;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, BorrowedHandle};
use std::ptr;
use std::time::Instant;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessAsUserW, PROCESS_INFORMATION,
    ResumeThread, STARTUPINFOW, TerminateProcess, WaitForSingleObject,
};

const CLIENT_MODE: &str = "--proctor-service-client";
struct Handle(usize);
impl Handle {
    fn raw(&self) -> HANDLE {
        self.0 as HANDLE
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: every guard owns one successfully created kernel handle.
        if unsafe { CloseHandle(self.raw()) } == 0 {
            poison_helper_utility();
        }
    }
}

/// The sole observation client is the exact Electron main process this service
/// created. Its verified main launches the security utility and brokers facts.
/// No child/descendant is implicitly authorized merely by belonging to its job.
pub struct WindowsControlledClient {
    process: Handle,
    job: Handle,
    _closure: WindowsProtectedLaunchClosure,
    candidate: interactive_session_state::WindowsCandidateSession,
    terminated: bool,
}
impl WindowsControlledClient {
    /// Invoke in a bounded launch worker; closure validation, token acquisition,
    /// process creation and the later pipe handshake share this absolute budget.
    /// # Errors
    /// Fails closed on token/closure, job, process, liveness, resume or deadline error.
    pub fn launch(
        closure: WindowsProtectedLaunchClosure,
        user: &WindowsLaunchUser,
        deadline: Instant,
    ) -> Result<Self, HelperTransportError> {
        ensure_helper_utility_usable()?;
        remaining(deadline)?;
        // SAFETY: unnamed noninheritable job, inaccessible to requesting clients.
        let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let job = Handle(job as usize);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: fixed initialized job limits, owned handle and exact byte length.
        if unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                u32::try_from(mem::size_of_val(&limits)).unwrap_or(u32::MAX),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let executable = terminated(closure.executable().as_os_str())?;
        let directory = terminated(closure.root().as_os_str())?;
        let mut command = vec![u16::from(b'"')];
        command.extend(executable.iter().take(executable.len() - 1));
        command.extend(format!("\" {CLIENT_MODE}").encode_utf16());
        command.push(0);
        let mut desktop: Vec<_> = "winsta0\\default".encode_utf16().chain([0]).collect();
        let environment = [0_u16; 2];
        let startup = STARTUPINFOW {
            cb: u32::try_from(mem::size_of::<STARTUPINFOW>()).unwrap_or(u32::MAX),
            lpDesktop: desktop.as_mut_ptr(),
            ..STARTUPINFOW::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        // SAFETY: fixed executable/mode, no inherited handles or caller-provided
        // environment. User primary token preserves its session, not session 0.
        let created = unsafe {
            CreateProcessAsUserW(
                user.token().as_raw_handle().cast(),
                executable.as_ptr(),
                command.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                environment.as_ptr().cast(),
                directory.as_ptr(),
                &raw const startup,
                &raw mut process,
            )
        };
        if created == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let thread = Handle(process.hThread as usize);
        let mut child = Self {
            process: Handle(process.hProcess as usize),
            job,
            _closure: closure,
            candidate: user.candidate(),
            terminated: false,
        };
        // Suspend first: no client code executes until the retained job owns it.
        if unsafe { AssignProcessToJobObject(child.job.raw(), child.process.raw()) } == 0 {
            child.terminate()?;
            return Err(HelperTransportError::ExecutableIdentity);
        }
        remaining(deadline)?;
        if unsafe { ResumeThread(thread.raw()) } == u32::MAX {
            child.terminate()?;
            return Err(HelperTransportError::ExecutableIdentity);
        }
        drop(thread);
        remaining(deadline)?;
        ensure_helper_utility_usable()?;
        Ok(child)
    }
    /// Native authentication receives this retained handle, never a second PID lookup.
    #[must_use]
    pub fn process(&self) -> BorrowedHandle<'_> {
        // SAFETY: self owns the exact returned process handle through this borrow.
        unsafe { BorrowedHandle::borrow_raw(self.process.raw()) }
    }
    #[must_use]
    pub fn candidate(&self) -> interactive_session_state::WindowsCandidateSession {
        self.candidate
    }
    /// # Errors
    /// Rejects a wait failure; an exited main can never authorize new source input.
    pub fn has_exited(&self) -> Result<bool, HelperTransportError> {
        match unsafe { WaitForSingleObject(self.process.raw(), 0) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            _ => Err(HelperTransportError::ChildTermination),
        }
    }
    /// Kill request is not exit proof. Observe both main exit and an empty owned
    /// job before releasing the code closure or acknowledging client shutdown.
    /// # Errors
    /// Missing observed termination poisons the service; it must be replaced.
    pub fn terminate(&mut self) -> Result<(), HelperTransportError> {
        if self.terminated {
            return Ok(());
        }
        let deadline = Instant::now() + crate::HELPER_TERMINATION_DEADLINE;
        // The process may not have reached AssignProcessToJobObject on failure.
        if !self.has_exited().unwrap_or(false)
            && unsafe { TerminateProcess(self.process.raw(), 70) } == 0
        {
            return Self::cleanup_failed();
        }
        if unsafe { TerminateJobObject(self.job.raw(), 70) } == 0 {
            return Self::cleanup_failed();
        }
        loop {
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let mut returned = 0;
            // SAFETY: live owned job and fixed output structure.
            if unsafe {
                QueryInformationJobObject(
                    self.job.raw(),
                    JobObjectBasicAccountingInformation,
                    (&raw mut accounting).cast(),
                    u32::try_from(mem::size_of_val(&accounting)).unwrap_or(u32::MAX),
                    &raw mut returned,
                )
            } == 0
                || returned as usize != mem::size_of_val(&accounting)
            {
                return Self::cleanup_failed();
            }
            let exited = self.has_exited().unwrap_or(false);
            match crate::windows_lifecycle_checks::termination_receipt(
                exited,
                accounting.ActiveProcesses,
                Instant::now(),
                deadline,
            ) {
                Ok(true) => {
                    self.terminated = true;
                    return Ok(());
                }
                Ok(false) => {}
                Err(()) => return Self::cleanup_failed(),
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    fn cleanup_failed() -> Result<(), HelperTransportError> {
        poison_helper_utility();
        Err(HelperTransportError::ChildTermination)
    }
}
impl Drop for WindowsControlledClient {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}
fn terminated(value: &std::ffi::OsStr) -> Result<Vec<u16>, HelperTransportError> {
    let mut text: Vec<_> = value.encode_wide().collect();
    if text.is_empty()
        || text.len() > 32_000
        || text.contains(&0)
        || text.contains(&u16::from(b'"'))
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    text.push(0);
    Ok(text)
}
