//! A command of the reader's own: a `[[command]]` of config.toml run over the file or a part of it,
//! for Transform to show before and after. The page names the command; its program and arguments are read here from
//! config.toml on every run, so a script in the page can start only what the reader wrote there. The program is
//! started directly with that argument array, never through a shell and never split from a string here. It has the
//! app's environment and can do whatever that program does; what bounds it is the time limit and the output cap, and
//! a job object on Windows, and a process group elsewhere, that ends whatever it started along with it. The folder it
//! runs in is the one its entry names, else a folder in the set the page opened (src/scope/served.rs), which never holds
//! a drive's or a share's root, the home folder or one above it. The page feeds that set, so this keeps a run out of
//! folders nothing opened, not out of every folder a compromised page could scope first.

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::ShellError;

/// How long a command may run before it is killed.
pub const TIME_LIMIT: Duration = Duration::from_secs(10);
/// The most stdout a command may print; past it the run is refused, not cut.
pub const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
/// The most stderr kept to show; the rest is read and dropped so the program never blocks on a full pipe.
pub const MAX_STDERR_BYTES: usize = 64 * 1024;

/// The header the request rides in, percent-encoded JSON; the raw body is the input.
const RUN_HEADER: &str = "x-marxy-run";

/// The most `[[command]]` tables read, as `MAX_COMMANDS` in packages/theme/src/config.ts.
const MAX_COMMANDS: usize = 50;

#[derive(Debug, Deserialize)]
struct RunRequest {
    /// The command's name in config.toml, unique there.
    id: String,
    cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderCommand {
    pub name: String,
    pub run: Vec<String>,
    /// The entry's own `cwd`, which wins over the folder the page asks for.
    pub cwd: Option<String>,
}

/// The `[[command]]` tables of config.toml that the page lists, by the same rules as `parseCommands` in
/// packages/theme/src/config.ts: a trimmed name, a program first in `run`, the first of a name, at most 50.
pub fn reader_commands(config: &str) -> Result<Vec<ReaderCommand>, String> {
    let table: toml::Table = toml::from_str(config).map_err(|e| format!("config.toml: {e}"))?;
    let Some(toml::Value::Array(entries)) = table.get("command") else {
        return Ok(Vec::new());
    };
    let mut commands: Vec<ReaderCommand> = Vec::new();
    for entry in entries {
        let Some(entry) = entry.as_table() else {
            continue;
        };
        let name = entry
            .get("name")
            .and_then(|n| n.as_str())
            .map(str::trim)
            .unwrap_or("");
        let run: Option<Vec<String>> = entry
            .get("run")
            .and_then(|r| r.as_array())
            .and_then(|r| r.iter().map(|a| a.as_str().map(String::from)).collect());
        let Some(run) = run.filter(|r| r.first().is_some_and(|p| !p.trim().is_empty())) else {
            continue;
        };
        if name.is_empty()
            || commands.iter().any(|c| c.name == name)
            || commands.len() >= MAX_COMMANDS
        {
            continue;
        }
        let cwd = entry
            .get("cwd")
            .and_then(|c| c.as_str())
            .filter(|c| !c.trim().is_empty())
            .map(String::from);
        commands.push(ReaderCommand {
            name: name.to_string(),
            run,
            cwd,
        });
    }
    Ok(commands)
}

/// The command named `id` in the text of config.toml; an id it does not name is refused.
pub fn command_by_id(config: &str, id: &str) -> Result<ReaderCommand, RunError> {
    reader_commands(config)
        .map_err(RunError::Invalid)?
        .into_iter()
        .find(|c| c.name == id)
        .ok_or_else(|| RunError::Invalid(format!("config.toml has no [[command]] named \"{id}\"")))
}

/// The folder `command` runs in: its entry's `cwd` when config.toml names one, else `asked` when it is a folder in
/// `opened`, else none.
pub fn command_cwd(
    command: &ReaderCommand,
    asked: Option<&str>,
    opened: &std::sync::RwLock<crate::scope::OpenedSet>,
) -> Result<Option<PathBuf>, RunError> {
    if let Some(own) = &command.cwd {
        return Ok(Some(PathBuf::from(own)));
    }
    let Some(asked) = asked.filter(|c| !c.is_empty()) else {
        return Ok(None);
    };
    crate::scope::served::opened_folder(opened, Path::new(asked))
        .map(Some)
        .map_err(|_| RunError::Invalid(format!("the folder {asked} is not one that was opened")))
}

/// Keeps the working directory out of the search for the programs the child starts. cmd.exe and CreateProcess look
/// in the current directory first, and that is the opened folder: an npm shim's bare `node` would otherwise run a
/// `node.cmd` or `node.exe` planted in the document's folder. The directory itself stays, for relative paths and
/// config discovery.
pub(crate) fn skip_cwd_in_exe_search(command: &mut Command) {
    if cfg!(windows) {
        command.env("NoDefaultCurrentDirectoryInExePath", "1");
    }
}

/// Starts `program` with the command `build` makes for it. std appends only `.exe` on Windows, so `prettier` and
/// `npm` (shims named `.cmd`) are not found by name; a bare name that is not found is tried once more as `.cmd`.
pub(crate) fn spawn_or_cmd_shim(
    program: &str,
    build: impl Fn(&str) -> Command,
) -> std::io::Result<Child> {
    let spawned = build(program).spawn();
    if cfg!(windows)
        && Path::new(program).extension().is_none()
        && spawned
            .as_ref()
            .is_err_and(|e| e.kind() == ErrorKind::NotFound)
    {
        if let Ok(child) = build(&format!("{program}.cmd")).spawn() {
            return Ok(child);
        }
    }
    spawned
}

fn read_config(path: &Path) -> Result<String, RunError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(RunError::Io(format!("config.toml: {e}"))),
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RunHead {
    /// The exit code; None when the program was ended by a signal.
    pub status: Option<i32>,
    pub stderr: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RunOutput {
    pub head: RunHead,
    pub stdout: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RunError {
    NotFound(String),
    TimedOut(Duration),
    TooLarge(usize),
    Invalid(String),
    Io(String),
}

impl From<RunError> for ShellError {
    fn from(e: RunError) -> Self {
        let (code, message) = match e {
            RunError::NotFound(program) => (
                "not-found",
                format!("{program} is not a program on the PATH"),
            ),
            RunError::TimedOut(limit) => (
                "timed-out",
                format!("it ran past {} s and was stopped", limit.as_secs()),
            ),
            RunError::TooLarge(cap) => (
                "too-large",
                format!("it printed more than {} MB", cap / (1024 * 1024)),
            ),
            RunError::Invalid(m) => ("invalid", m),
            RunError::Io(m) => ("io", m),
        };
        ShellError {
            code: code.into(),
            message,
            path: None,
        }
    }
}

/// Runs `program` with `args` in `cwd`, `input` on its stdin, and returns its status, stdout and stderr. Killed past
/// `limit`; refused when stdout passes `cap`.
pub fn run(
    program: &str,
    args: &[String],
    input: &[u8],
    cwd: Option<&Path>,
    limit: Duration,
    cap: usize,
) -> Result<RunOutput, RunError> {
    if program.is_empty() {
        return Err(RunError::Invalid("the command names no program".into()));
    }
    if let Some(dir) = cwd {
        // Checked first: a missing folder fails the spawn with NotFound too, which would blame the program.
        if !dir.is_dir() {
            return Err(RunError::Invalid(format!(
                "the folder {} is not there",
                dir.display()
            )));
        }
    }
    let build = |program: &str| {
        let mut command = Command::new(program);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        skip_cwd_in_exe_search(&mut command);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: a console program would otherwise flash a console window over the app. CREATE_SUSPENDED:
            // it is put in its job before it runs, so nothing it starts can be outside the job.
            command.creation_flags(0x0800_0000 | tree::CREATE_SUSPENDED);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own process group, so a stop reaches everything it started, not only the program.
            command.process_group(0);
        }
        command
    };
    let spawned = spawn_or_cmd_shim(program, build);
    let mut child = spawned.map_err(|e| match e.kind() {
        ErrorKind::NotFound => RunError::NotFound(program.to_string()),
        _ => RunError::Io(format!("{program} could not be started: {e}")),
    })?;
    let tree = match tree::Tree::contain(&child) {
        Ok(tree) => tree,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunError::Io(format!(
                "{program} could not be contained: {e}"
            )));
        }
    };

    let started = Instant::now();
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let input = input.to_vec();
    std::thread::spawn(move || {
        // A program that stops reading early (head, a failed parse) closes the pipe; that is not an error of the run.
        let _ = stdin.write_all(&input);
    });
    let (out_tx, out_rx) = mpsc::channel();
    let mut stdout = child.stdout.take().expect("stdout is piped");
    std::thread::spawn(move || {
        let _ = out_tx.send(read_capped(&mut stdout, cap));
    });
    let (err_tx, err_rx) = mpsc::channel();
    let mut stderr = child.stderr.take().expect("stderr is piped");
    std::thread::spawn(move || {
        let _ = err_tx.send(read_kept(&mut stderr, MAX_STDERR_BYTES));
    });

    let deadline = started + limit;
    let stdout = match out_rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            stop(&mut child, &tree);
            return Err(RunError::TooLarge(cap));
        }
        Err(_) => {
            stop(&mut child, &tree);
            return Err(RunError::TimedOut(limit));
        }
    };
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                stop(&mut child, &tree);
                return Err(RunError::TimedOut(limit));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(e) => return Err(RunError::Io(e.to_string())),
        }
    };
    // A grandchild that keeps stderr open must not hold the run past its limit.
    let stderr = err_rx
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .unwrap_or_default();
    Ok(RunOutput {
        head: RunHead {
            status: status.code(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        },
        stdout,
    })
}

fn stop(child: &mut Child, tree: &tree::Tree) {
    tree.end();
    let _ = child.kill();
    let _ = child.wait();
}

/// The program and everything it starts. On Windows a job object with KILL_ON_JOB_CLOSE, so the tree ends when the
/// run does, at the limit or not; `Child::kill` alone ends one process and leaves its children running.
#[cfg(windows)]
mod tree {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    pub const CREATE_SUSPENDED: u32 = 0x4;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const TH32CS_SNAPTHREAD: u32 = 0x4;
    const THREAD_SUSPEND_RESUME: u32 = 0x2;

    /// JOBOBJECT_BASIC_LIMIT_INFORMATION.
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    /// JOBOBJECT_EXTENDED_LIMIT_INFORMATION; `io_info` is IO_COUNTERS.
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io_info: [u64; 6],
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    /// THREADENTRY32.
    #[repr(C)]
    #[derive(Default)]
    struct ThreadEntry {
        size: u32,
        usage: u32,
        thread_id: u32,
        owner_process_id: u32,
        base_priority: i32,
        delta_priority: i32,
        flags: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            info: *const c_void,
            size: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn TerminateJobObject(job: *mut c_void, exit_code: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> *mut c_void;
        fn Thread32First(snapshot: *mut c_void, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: *mut c_void, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, thread_id: u32) -> *mut c_void;
        fn ResumeThread(thread: *mut c_void) -> u32;
    }

    pub struct Tree {
        job: *mut c_void,
    }

    impl Tree {
        /// Puts the suspended `child` in a new job, then lets it run.
        pub fn contain(child: &Child) -> std::io::Result<Tree> {
            // SAFETY: null attributes and name are allowed; the Tree owns the handle and closes it in Drop.
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let tree = Tree { job };
            let mut limits = ExtendedLimits::default();
            limits.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: `limits` has the documented layout and outlives the call.
            let set = unsafe {
                SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&limits as *const ExtendedLimits).cast(),
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            };
            if set == 0 {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: the child's process handle is open for as long as `child` is.
            if unsafe { AssignProcessToJobObject(job, child.as_raw_handle().cast()) } == 0 {
                return Err(std::io::Error::last_os_error());
            }
            resume(child.id())?;
            Ok(tree)
        }

        pub fn end(&self) {
            // SAFETY: the job handle is open until Drop.
            unsafe { TerminateJobObject(self.job, 1) };
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            // SAFETY: closed once. KILL_ON_JOB_CLOSE ends whatever is still in the job, a grandchild that kept running
            // after the program exited included.
            unsafe { CloseHandle(self.job) };
        }
    }

    /// Resumes the threads of a process started suspended (it has one, its main thread).
    fn resume(process_id: u32) -> std::io::Result<()> {
        // SAFETY: a snapshot of every thread on the system, closed below.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot as isize == -1 {
            return Err(std::io::Error::last_os_error());
        }
        let mut entry = ThreadEntry {
            size: std::mem::size_of::<ThreadEntry>() as u32,
            ..ThreadEntry::default()
        };
        let mut resumed = 0;
        // SAFETY: `entry.size` is set as Thread32First requires, and the snapshot is open.
        let mut more = unsafe { Thread32First(snapshot, &mut entry) } != 0;
        while more {
            if entry.owner_process_id == process_id {
                // SAFETY: the thread handle is closed right after it is used.
                unsafe {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.thread_id);
                    if !thread.is_null() {
                        if ResumeThread(thread) != u32::MAX {
                            resumed += 1;
                        }
                        CloseHandle(thread);
                    }
                }
            }
            // SAFETY: as for Thread32First.
            more = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
        }
        // SAFETY: opened above.
        unsafe { CloseHandle(snapshot) };
        if resumed == 0 {
            return Err(std::io::Error::other(
                "its main thread could not be resumed",
            ));
        }
        Ok(())
    }
}

/// The program's process group (it was started as the leader of a new one). Ended at the limit, and when the run is
/// over, as the job object's close ends a grandchild that kept running after the program exited.
#[cfg(unix)]
mod tree {
    use std::process::Child;

    pub struct Tree {
        group: libc::pid_t,
    }

    impl Tree {
        pub fn contain(child: &Child) -> std::io::Result<Tree> {
            Ok(Tree {
                group: child.id() as libc::pid_t,
            })
        }

        pub fn end(&self) {
            // SAFETY: kill(2) with a negative pid signals the group; it touches no memory of ours.
            unsafe { libc::kill(-self.group, libc::SIGKILL) };
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            self.end();
        }
    }
}

#[cfg(not(any(windows, unix)))]
mod tree {
    use std::process::Child;

    pub struct Tree;

    impl Tree {
        pub fn contain(_child: &Child) -> std::io::Result<Tree> {
            Ok(Tree)
        }

        pub fn end(&self) {}
    }
}

/// All of `r`, or None once it passes `cap`.
fn read_capped(r: &mut impl Read, cap: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match r.read(&mut buf) {
            Ok(0) => return Some(out),
            Ok(n) => {
                if out.len() + n > cap {
                    return None;
                }
                out.extend_from_slice(&buf[..n]);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return Some(out),
        }
    }
}

/// The first `keep` bytes of `r`, read to its end.
fn read_kept(r: &mut impl Read, keep: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match r.read(&mut buf) {
            Ok(0) => return out,
            Ok(n) => {
                let room = keep.saturating_sub(out.len());
                out.extend_from_slice(&buf[..n.min(room)]);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return out,
        }
    }
}

/// The response's body: the head's JSON length (u32, little-endian), the head, then stdout as it was printed.
fn frame(output: &RunOutput) -> Vec<u8> {
    let head = serde_json::to_vec(&output.head).expect("the head serialises");
    let mut body = Vec::with_capacity(4 + head.len() + output.stdout.len());
    body.extend_from_slice(&(head.len() as u32).to_le_bytes());
    body.extend_from_slice(&head);
    body.extend_from_slice(&output.stdout);
    body
}

/// `run` for the page. The input arrives as a raw body and the command's id and the folder in `x-marxy-run`, so a
/// file's bytes are not sent as a JSON array; the answer is `frame`'s raw body.
#[tauri::command]
pub async fn run_command(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, ShellError> {
    let tauri::ipc::InvokeBody::Raw(input) = request.body() else {
        return Err(
            RunError::Invalid("run_command: expected the input as a raw body".into()).into(),
        );
    };
    let encoded = request
        .headers()
        .get(RUN_HEADER)
        .ok_or_else(|| RunError::Invalid(format!("run_command: missing {RUN_HEADER}")))?
        .to_str()
        .map_err(|e| RunError::Invalid(format!("run_command: {RUN_HEADER}: {e}")))?;
    let json = crate::percent_decode(encoded).map_err(RunError::Invalid)?;
    let req: RunRequest =
        serde_json::from_str(&json).map_err(|e| RunError::Invalid(format!("run_command: {e}")))?;
    let input = input.clone();
    // The same file `config_paths` names (commands/app.rs), read on every run as `reveal_in_editor` reads it.
    let config = crate::data_dir::config_dir(&app)
        .map_err(|e| RunError::Io(e.to_string()))?
        .join("config.toml");
    // Off the async runtime's threads: the run blocks for as long as the program takes.
    let output = tauri::async_runtime::spawn_blocking(move || {
        let command = command_by_id(&read_config(&config)?, &req.id)?;
        let cwd = command_cwd(&command, req.cwd.as_deref(), crate::scope::opened())?;
        run(
            &command.run[0],
            &command.run[1..],
            &input,
            cwd.as_deref(),
            TIME_LIMIT,
            MAX_OUTPUT_BYTES,
        )
    })
    .await
    .map_err(|e| RunError::Io(e.to_string()))??;
    Ok(tauri::ipc::Response::new(frame(&output)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_working_directory_is_kept_out_of_the_program_search() {
        let mut command = Command::new("tool");
        skip_cwd_in_exe_search(&mut command);
        let set = command
            .get_envs()
            .find(|(k, _)| *k == "NoDefaultCurrentDirectoryInExePath")
            .and_then(|(_, v)| v);
        assert_eq!(set.is_some(), cfg!(windows));
        if cfg!(windows) {
            assert_eq!(set.unwrap(), "1");
        }
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    fn sh(script_unix: &str, script_windows: &[&str]) -> (String, Vec<String>) {
        if cfg!(windows) {
            let mut args = argv(&["/C"]);
            args.extend(argv(script_windows));
            ("cmd".into(), args)
        } else {
            ("sh".into(), argv(&["-c", script_unix]))
        }
    }

    fn lines(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).replace("\r\n", "\n")
    }

    #[cfg(windows)]
    #[test]
    fn a_cmd_shim_is_found_by_its_bare_name() {
        let dir = std::env::temp_dir().join(format!("marxy-run-shim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("marxyshim.cmd"),
            "@echo shimmed
",
        )
        .unwrap();
        // Appended: the other tests here run in this process and find cmd and sort first.
        let mut path = std::env::var_os("PATH").unwrap_or_default();
        path.push(";");
        path.push(&dir);
        std::env::set_var("PATH", path);
        let out = run("marxyshim", &[], b"", None, TIME_LIMIT, MAX_OUTPUT_BYTES).unwrap();
        assert_eq!(lines(&out.stdout).trim(), "shimmed");
    }

    #[test]
    fn the_input_goes_to_stdin_and_stdout_comes_back() {
        let out = run(
            "sort",
            &[],
            b"pear\napple\nfig\n",
            None,
            TIME_LIMIT,
            MAX_OUTPUT_BYTES,
        )
        .unwrap();
        assert_eq!(lines(&out.stdout), "apple\nfig\npear\n");
        assert_eq!(out.head.status, Some(0));
    }

    #[test]
    fn the_exit_code_and_stderr_are_said() {
        let (program, args) = sh(
            "echo oops >&2; exit 3",
            &["echo", "oops", "1>&2", "&", "exit", "3"],
        );
        let out = run(&program, &args, b"", None, TIME_LIMIT, MAX_OUTPUT_BYTES).unwrap();
        assert_eq!(out.head.status, Some(3));
        assert_eq!(out.head.stderr.trim(), "oops");
        assert!(out.stdout.is_empty());
    }

    #[test]
    fn a_program_not_on_the_path_is_not_found() {
        let e = run(
            "marxy-no-such-program-d11",
            &[],
            b"",
            None,
            TIME_LIMIT,
            MAX_OUTPUT_BYTES,
        )
        .unwrap_err();
        assert_eq!(e, RunError::NotFound("marxy-no-such-program-d11".into()));
    }

    #[test]
    fn output_past_the_cap_is_refused() {
        let e = run("sort", &[], b"bbbbbbbb\naaaaaaaa\n", None, TIME_LIMIT, 8).unwrap_err();
        assert_eq!(e, RunError::TooLarge(8));
    }

    #[test]
    fn a_run_past_the_limit_is_stopped() {
        let (program, args) = if cfg!(windows) {
            ("ping".to_string(), argv(&["-n", "30", "127.0.0.1"]))
        } else {
            ("sleep".to_string(), argv(&["30"]))
        };
        let started = Instant::now();
        let e = run(
            &program,
            &args,
            b"",
            None,
            Duration::from_millis(300),
            MAX_OUTPUT_BYTES,
        )
        .unwrap_err();
        assert_eq!(e, RunError::TimedOut(Duration::from_millis(300)));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_folder_that_is_not_there_is_refused_before_the_program_is_blamed() {
        let missing = std::env::temp_dir().join("marxy-no-such-folder-d11");
        let e = run(
            "sort",
            &[],
            b"",
            Some(&missing),
            TIME_LIMIT,
            MAX_OUTPUT_BYTES,
        )
        .unwrap_err();
        assert!(matches!(e, RunError::Invalid(_)), "{e:?}");
    }

    #[test]
    fn the_folder_is_the_one_asked_for() {
        let dir = std::env::temp_dir().join("marxy-run-cwd-d11");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("marker-d11.txt"), b"here\n").unwrap();
        let (program, args) = sh("cat marker-d11.txt", &["type", "marker-d11.txt"]);
        let out = run(
            &program,
            &args,
            b"",
            Some(&dir),
            TIME_LIMIT,
            MAX_OUTPUT_BYTES,
        )
        .unwrap();
        assert_eq!(lines(&out.stdout), "here\n");
    }

    #[test]
    fn an_empty_program_is_refused() {
        assert!(matches!(
            run("", &[], b"", None, TIME_LIMIT, MAX_OUTPUT_BYTES),
            Err(RunError::Invalid(_))
        ));
    }

    #[test]
    fn the_frame_is_the_head_then_stdout() {
        let out = RunOutput {
            head: RunHead {
                status: Some(0),
                stderr: "w".into(),
            },
            stdout: b"abc".to_vec(),
        };
        let body = frame(&out);
        let n = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
        assert_eq!(&body[4..4 + n], br#"{"status":0,"stderr":"w"}"#);
        assert_eq!(&body[4 + n..], b"abc");
    }

    const CONFIG: &str = r#"
external_editor = "code -g {file}:{line}"

[[command]]
name = " Wrap at 72 "
run = ["fold", "-s", "-w", "72"]

[[command]]
name = "Wrap at 72"
run = ["evil"]

[[command]]
name = "No program"
run = [" ", "x"]

[[command]]
name = "One string"
run = "sort -r"

[[command]]
run = ["sort"]

[[command]]
name = "Sort"
run = ["sort"]
prints = true
"#;

    #[test]
    fn commands_are_read_as_the_page_lists_them() {
        let names: Vec<String> = reader_commands(CONFIG)
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["Wrap at 72", "Sort"]);
        assert_eq!(
            command_by_id(CONFIG, "Wrap at 72").unwrap().run,
            argv(&["fold", "-s", "-w", "72"])
        );
    }

    #[test]
    fn an_unknown_command_id_is_refused() {
        for id in ["Evil", "No program", "One string", "", "fold"] {
            let e = command_by_id(CONFIG, id).unwrap_err();
            assert!(matches!(e, RunError::Invalid(_)), "{id}: {e:?}");
            assert_eq!(ShellError::from(e).code, "invalid");
        }
        assert!(
            command_by_id("", "Sort").is_err(),
            "no config.toml names no command"
        );
        assert!(
            command_by_id("[[command]\n", "Sort").is_err(),
            "a config.toml that does not parse names none"
        );
    }

    #[test]
    fn the_folder_the_page_asks_for_must_be_one_the_reader_opened() {
        let base = std::env::temp_dir().join(format!("marxy-run-scope-{}", std::process::id()));
        let opened_dir = base.join("opened");
        let other = base.join("other");
        std::fs::create_dir_all(&opened_dir).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let mut set = crate::scope::OpenedSet::default();
        set.add_folder(&opened_dir, dunce::canonicalize(&opened_dir).unwrap());
        let set = std::sync::RwLock::new(set);
        let sort = command_by_id(CONFIG, "Sort").unwrap();
        let inside = opened_dir.join("sub");
        std::fs::create_dir_all(&inside).unwrap();
        assert_eq!(
            command_cwd(&sort, inside.to_str(), &set).unwrap(),
            Some(dunce::canonicalize(&inside).unwrap())
        );
        for refused in [
            other.to_string_lossy().into_owned(),
            base.to_string_lossy().into_owned(),
            format!("{}/../other", opened_dir.display()),
            "relative".to_string(),
        ] {
            let e = command_cwd(&sort, Some(&refused), &set).unwrap_err();
            assert!(matches!(e, RunError::Invalid(_)), "{refused}: {e:?}");
        }
        assert_eq!(command_cwd(&sort, None, &set).unwrap(), None);
        // The entry's own folder is config.toml's word, which the page cannot write.
        let own = reader_commands(&format!(
            "[[command]]
name = \"Here\"
run = [\"sort\"]
cwd = '{}'
",
            other.display()
        ))
        .unwrap()
        .remove(0);
        assert_eq!(
            command_cwd(&own, opened_dir.to_str(), &set).unwrap(),
            Some(other.clone())
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// As the Windows test below: past the limit the program's whole process group is ended.
    #[cfg(unix)]
    #[test]
    fn a_grandchild_is_ended_with_the_run_on_unix() {
        let dir = std::env::temp_dir().join(format!("marxy-run-group-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("grandchild.txt");
        let _ = std::fs::remove_file(&marker);
        let script = format!("(sleep 3; echo alive > '{}') & sleep 30", marker.display());
        let limit = Duration::from_millis(800);
        let e = run(
            "sh",
            &argv(&["-c", &script]),
            b"",
            None,
            limit,
            MAX_OUTPUT_BYTES,
        )
        .unwrap_err();
        assert_eq!(e, RunError::TimedOut(limit));
        std::thread::sleep(Duration::from_secs(5));
        assert!(!marker.exists(), "the grandchild outlived the run");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn past_fifty_commands_none_is_read() {
        let config: String = (0..60)
            .map(|i| format!("[[command]]\nname = \"c{i}\"\nrun = [\"sort\"]\n"))
            .collect();
        assert!(command_by_id(&config, "c49").is_ok());
        assert!(command_by_id(&config, "c50").is_err());
    }

    /// A program that starts a grandchild which outlives it: at the limit the whole tree is ended, so the grandchild
    /// never writes its marker.
    #[cfg(windows)]
    #[test]
    fn a_grandchild_is_ended_with_the_run() {
        let dir = std::env::temp_dir().join(format!("marxy-run-tree-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("grandchild.txt");
        let _ = std::fs::remove_file(&marker);
        // `start /b` leaves the grandchild running on its own; it writes the marker after about 3 s.
        std::fs::write(
            dir.join("grandchild.cmd"),
            "@ping -n 4 127.0.0.1 >nul\r\n@echo alive>\"%~dp0grandchild.txt\"\r\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("parent.cmd"),
            "@start \"\" /b \"%~dp0grandchild.cmd\"\r\n@ping -n 30 127.0.0.1 >nul\r\n",
        )
        .unwrap();
        let limit = Duration::from_millis(800);
        let parent = dir.join("parent.cmd").to_string_lossy().into_owned();
        let e = run(
            "cmd",
            &argv(&["/C", &parent]),
            b"",
            None,
            limit,
            MAX_OUTPUT_BYTES,
        )
        .unwrap_err();
        assert_eq!(e, RunError::TimedOut(limit));
        std::thread::sleep(Duration::from_secs(5));
        assert!(!marker.exists(), "the grandchild outlived the run");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn errors_reach_the_page_with_a_code() {
        assert_eq!(
            ShellError::from(RunError::TimedOut(TIME_LIMIT)).code,
            "timed-out"
        );
        assert_eq!(
            ShellError::from(RunError::TooLarge(MAX_OUTPUT_BYTES)).code,
            "too-large"
        );
        assert_eq!(
            ShellError::from(RunError::NotFound("x".into())).code,
            "not-found"
        );
    }
}
