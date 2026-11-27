//! The program search path of the programs marxy starts, on macOS.
//!
//! Opened from Finder or the Dock, the app inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which holds
//! neither Homebrew's folder nor mise's shims, so a `[[command]]` program or the external editor installed by either
//! is "not a program on the PATH". The reader's login shell knows the real `PATH`: it is asked once, on a background
//! thread started with the app (or at the first program lookup if that comes first), with a short time limit; the
//! usual places are added when they exist and the shell did not name them. Only absolute folders are kept: an empty
//! or relative entry means the current directory, which for a command is the opened folder, and a program planted
//! there must not run. `-l` reads the profile files, not `.zshrc`. Launched from a terminal the app already has the
//! reader's `PATH` and keeps it.

use std::ffi::{CStr, OsString};
use std::io::{IsTerminal, Read};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const ASK_LIMIT: Duration = Duration::from_secs(2);
/// After the shell has exited, how long output still arriving is waited for (a daemon its profile started may hold
/// the pipe open for good).
const QUIET: Duration = Duration::from_millis(150);
const MARK: &str = "__marxy_path__";

static PATH: OnceLock<Option<OsString>> = OnceLock::new();

fn resolved() -> &'static Option<OsString> {
    PATH.get_or_init(|| {
        if std::io::stdin().is_terminal() {
            return None;
        }
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let asked = login_shell_path(&login_shell(), ASK_LIMIT);
        Some(complete(
            asked,
            std::env::var_os("PATH"),
            &usual_places(
                home.as_deref(),
                std::env::var_os("MISE_DATA_DIR").map(PathBuf::from),
                std::env::var_os("XDG_DATA_HOME").map(PathBuf::from),
            ),
            &|p| p.is_dir(),
        ))
    })
}

/// Starts asking for the `PATH` now, off the calling thread, so the first program started does not wait for it.
pub fn warm() {
    if !std::io::stdin().is_terminal() {
        std::thread::spawn(|| {
            resolved();
        });
    }
}

/// Sets `command`'s `PATH` to the reader's, when the app was not started from a terminal.
pub fn apply(command: &mut Command) {
    if let Some(path) = resolved() {
        command.env("PATH", path);
    }
}

/// `$SHELL`, else the account's shell from the user database, else zsh.
fn login_shell() -> PathBuf {
    if let Some(shell) = std::env::var_os("SHELL").map(PathBuf::from) {
        if shell.is_absolute() {
            return shell;
        }
    }
    // SAFETY: getpwuid returns null or a pointer to static storage; the string is copied out at once.
    let from_passwd = unsafe {
        let entry = libc::getpwuid(libc::getuid());
        if entry.is_null() || (*entry).pw_shell.is_null() {
            None
        } else {
            CStr::from_ptr((*entry).pw_shell).to_str().ok().map(PathBuf::from)
        }
    };
    from_passwd
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

/// The `PATH` a login shell ends up with, or None when it cannot be run, fails, or is not done within `limit`.
/// The shell has its own process group, ended whole on a timeout; output is read on a thread and waited for only until
/// the deadline, so nothing the shell's profile starts can hold this up.
fn login_shell_path(shell: &Path, limit: Duration) -> Option<String> {
    let script = format!("printf '{MARK}%s' \"$PATH\"");
    let mut child = Command::new(shell)
        .args(["-l", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let group = child.id() as i32;
    let end_group = |child: &mut std::process::Child| {
        // SAFETY: signals the process group this function made.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
        let _ = child.wait();
    };
    let mut stdout = child.stdout.take()?;
    let (send, chunks) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stdout.read(&mut buf) {
            if n == 0 || send.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => {
                end_group(&mut child);
                return None;
            }
            Ok(None) if Instant::now() >= deadline => {
                end_group(&mut child);
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let mut out = Vec::new();
    // Until the pipe closes, or goes quiet because something else holds it, or the deadline.
    while let Some(wait) = deadline
        .checked_duration_since(Instant::now())
        .map(|left| left.min(QUIET))
    {
        match chunks.recv_timeout(wait) {
            Ok(chunk) => out.extend(chunk),
            Err(_) => break,
        }
    }
    // Anything the shell's startup files printed comes before the mark.
    let text = String::from_utf8_lossy(&out);
    let path = text.rsplit_once(MARK)?.1.trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Where Homebrew, a manual install and mise put programs, from the reader's own settings.
fn usual_places(
    home: Option<&Path>,
    mise_data: Option<PathBuf>,
    xdg_data: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut usual = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    let mise = mise_data
        .filter(|p| p.is_absolute())
        .or_else(|| {
            xdg_data
                .filter(|p| p.is_absolute())
                .map(|p| p.join("mise"))
        })
        .or_else(|| home.map(|h| h.join(".local/share/mise")));
    if let Some(mise) = mise {
        usual.push(mise.join("shims"));
    }
    usual
}

/// The shell's `PATH` (else the app's own), absolute folders only, then each usual place that exists and is not already
/// in it.
fn complete(
    asked: Option<String>,
    inherited: Option<OsString>,
    usual: &[PathBuf],
    is_dir: &dyn Fn(&Path) -> bool,
) -> OsString {
    let mut dirs: Vec<PathBuf> = match asked {
        Some(path) => std::env::split_paths(&path).collect(),
        None => inherited
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default(),
    };
    // An empty entry, `.` or any relative one means the current directory: never searched.
    dirs.retain(|d| d.is_absolute());
    for dir in usual {
        if !dirs.contains(dir) && is_dir(dir) {
            dirs.push(dir.clone());
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("marxy-userpath-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn a_program_only_the_login_shells_path_holds_is_found() {
        let dir = scratch("found");
        let bin = dir.join("brewbin");
        std::fs::create_dir(&bin).unwrap();
        script(&bin, "marxy-only-tool", "echo found");
        let shell = script(
            dir.as_path(),
            "login-shell",
            &format!(
                "echo noise from a startup file\nprintf '{MARK}/usr/bin:{}' ",
                bin.display()
            ),
        );
        let asked = login_shell_path(&shell, Duration::from_secs(5)).unwrap();
        assert!(asked.ends_with(&bin.display().to_string()));
        let path = complete(Some(asked), Some("/usr/bin:/bin".into()), &[], &|_| false);

        // launchd's PATH alone: the program is not found.
        let mut bare = Command::new("marxy-only-tool");
        bare.env("PATH", "/usr/bin:/bin");
        assert!(bare.output().is_err());
        // With the completed one, it runs.
        let mut command = Command::new("marxy-only-tool");
        command.env("PATH", &path);
        assert_eq!(command.output().unwrap().stdout, b"found\n");
    }

    #[test]
    fn a_shell_that_hangs_or_fails_is_given_up_on() {
        let dir = scratch("hang");
        let slow = script(dir.as_path(), "slow", "sleep 30");
        let started = Instant::now();
        assert_eq!(login_shell_path(&slow, Duration::from_millis(200)), None);
        assert!(started.elapsed() < Duration::from_secs(5));
        let failing = script(dir.as_path(), "failing", "exit 3");
        assert_eq!(login_shell_path(&failing, Duration::from_secs(5)), None);
        assert_eq!(
            login_shell_path(&dir.join("none"), Duration::from_secs(5)),
            None
        );
    }

    #[test]
    fn the_usual_places_are_added_when_they_are_there_and_not_twice() {
        let there = |p: &Path| p != Path::new("/usr/local/bin");
        let usual = usual_places(Some(Path::new("/Users/x")), None, None);
        let path = complete(None, Some("/usr/bin:/bin".into()), &usual, &there);
        let dirs: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(
            dirs,
            [
                "/usr/bin",
                "/bin",
                "/opt/homebrew/bin",
                "/Users/x/.local/share/mise/shims"
            ]
            .map(PathBuf::from)
        );
        let path = complete(Some("/opt/homebrew/bin:/bin".into()), None, &usual, &there);
        assert_eq!(
            std::env::split_paths(&path)
                .filter(|p| p == Path::new("/opt/homebrew/bin"))
                .count(),
            1
        );
    }

    #[test]
    fn mise_shims_follow_the_readers_settings() {
        let home = Some(Path::new("/Users/x"));
        let shims = |d: Vec<PathBuf>| d.last().cloned().unwrap();
        assert_eq!(
            shims(usual_places(home, Some("/data/mise".into()), Some("/xdg".into()))),
            PathBuf::from("/data/mise/shims")
        );
        assert_eq!(
            shims(usual_places(home, None, Some("/xdg".into()))),
            PathBuf::from("/xdg/mise/shims")
        );
        // A relative setting is not trusted.
        assert_eq!(
            shims(usual_places(home, Some("rel".into()), Some("rel".into()))),
            PathBuf::from("/Users/x/.local/share/mise/shims")
        );
    }

    #[test]
    fn empty_dot_and_relative_entries_are_never_searched() {
        // The login PATH ends in an empty entry (`PATH="$PATH:"`), and holds `.` and relative folders.
        let path = complete(
            Some("/usr/bin::.:bin:../x:/opt/ok:".into()),
            None,
            &[],
            &|_| false,
        );
        let dirs: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(dirs, ["/usr/bin", "/opt/ok"].map(PathBuf::from));
        // The same for the PATH the app inherited, when the shell gave none.
        let path = complete(None, Some(":/bin:.".into()), &[], &|_| false);
        assert_eq!(std::env::split_paths(&path).collect::<Vec<_>>(), [PathBuf::from("/bin")]);

        // A program planted in the working directory does not run through the completed PATH.
        let dir = scratch("planted");
        script(&dir, "marxy-planted", "echo planted");
        let mut command = Command::new("marxy-planted");
        command.current_dir(&dir).env("PATH", complete(Some("/usr/bin:".into()), None, &[], &|_| false));
        assert!(command.output().is_err());
    }

    #[test]
    fn a_profile_that_leaves_a_daemon_holding_the_output_does_not_hang_the_lookup() {
        let dir = scratch("daemon");
        let shell = script(
            &dir,
            "login-shell",
            &format!("sleep 30 &\nprintf '{MARK}/usr/bin:/opt/x'"),
        );
        let started = Instant::now();
        let asked = login_shell_path(&shell, Duration::from_secs(5));
        assert_eq!(asked.as_deref(), Some("/usr/bin:/opt/x"));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    #[test]
    fn a_hung_shell_and_what_it_started_are_ended() {
        let dir = scratch("group");
        let pidfile = dir.join("child.pid");
        let shell = script(
            &dir,
            "login-shell",
            &format!("sleep 30 &\necho $! > {}\nsleep 30", pidfile.display()),
        );
        assert_eq!(login_shell_path(&shell, Duration::from_millis(500)), None);
        let pid: i32 = std::fs::read_to_string(&pidfile).unwrap().trim().parse().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        // SAFETY: signal 0 only tests that the process is there.
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the shell's child is still running");
    }
}
