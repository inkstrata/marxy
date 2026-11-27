//! The program search path of the programs marxy starts, on macOS.
//!
//! Opened from Finder or the Dock, the app inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which holds
//! neither Homebrew's folder nor mise's shims, so a `[[command]]` program or the external editor installed by either
//! is "not a program on the PATH". The reader's login shell knows the real `PATH`: it is asked once, the first time a
//! program is looked up (never at startup), with a short time limit; the usual places are added when they exist and the
//! shell did not name them. Launched from a terminal the app already has the reader's `PATH` and keeps it.

use std::ffi::OsString;
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const ASK_LIMIT: Duration = Duration::from_secs(2);
const MARK: &str = "__marxy_path__";

/// Sets `command`'s `PATH` to the reader's, when the app was not started from a terminal.
pub fn apply(command: &mut Command) {
    static PATH: OnceLock<Option<OsString>> = OnceLock::new();
    let path = PATH.get_or_init(|| {
        if std::io::stdin().is_terminal() {
            return None;
        }
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let asked = std::env::var("SHELL")
            .ok()
            .and_then(|shell| login_shell_path(Path::new(&shell), ASK_LIMIT));
        Some(complete(
            asked,
            std::env::var_os("PATH"),
            home.as_deref(),
            &|p| p.is_dir(),
        ))
    });
    if let Some(path) = path {
        command.env("PATH", path);
    }
}

/// The `PATH` a login shell ends up with, or None when it cannot be run, fails, or is not done within `limit`.
fn login_shell_path(shell: &Path, limit: Duration) -> Option<String> {
    let script = format!("printf '{MARK}%s' \"$PATH\"");
    let mut child = Command::new(shell)
        .args(["-l", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if started.elapsed() >= limit => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    // Anything the shell's startup files printed comes before the mark.
    let text = reader.join().ok()?;
    let path = text.rsplit_once(MARK)?.1.trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// The shell's `PATH` (else the app's own), then each usual place that exists and is not already in it.
fn complete(
    asked: Option<String>,
    inherited: Option<OsString>,
    home: Option<&Path>,
    is_dir: &dyn Fn(&Path) -> bool,
) -> OsString {
    let mut dirs: Vec<PathBuf> = match asked {
        Some(path) => std::env::split_paths(&path).collect(),
        None => inherited
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default(),
    };
    let mut usual = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = home {
        usual.push(home.join(".local/share/mise/shims"));
    }
    for dir in usual {
        if !dirs.contains(&dir) && is_dir(&dir) {
            dirs.push(dir);
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
        let path = complete(Some(asked), Some("/usr/bin:/bin".into()), None, &|_| false);

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
        let home = Path::new("/Users/x");
        let there = |p: &Path| p != Path::new("/usr/local/bin");
        let path = complete(None, Some("/usr/bin:/bin".into()), Some(home), &there);
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
        let path = complete(
            Some("/opt/homebrew/bin:/bin".into()),
            None,
            Some(home),
            &there,
        );
        assert_eq!(
            std::env::split_paths(&path)
                .filter(|p| p == Path::new("/opt/homebrew/bin"))
                .count(),
            1
        );
    }
}
