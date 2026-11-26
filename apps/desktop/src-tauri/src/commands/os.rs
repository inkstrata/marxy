//! External URL open with an http/https/mailto allow-list.
//! Open in external editor.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Url;

#[derive(Debug, Serialize)]
pub struct ShellError {
    pub code: String,
    pub message: String,
}

/// Refuses anything but a well-formed http, https or mailto URL (shell-api contract). The opener
/// gets the URL as written, not as parsed, so whatever the parser would quietly strip is refused.
pub fn validate_external_url(url: &str) -> Result<(), ShellError> {
    let refuse = |message: String| ShellError {
        code: "unsupported".into(),
        message,
    };
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(refuse("control character or whitespace in URL".into()));
    }
    // Handlers are often registered as `app.exe "%1"`; a quote in the URL would end that argument.
    if url.contains('"') {
        return Err(refuse("quote in URL".into()));
    }
    let parsed = Url::parse(url).map_err(|e| refuse(format!("not a URL: {e}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        "mailto" if parsed.cannot_be_a_base() => Ok(()),
        "mailto" => Err(refuse("mailto: takes no authority".into())),
        scheme => Err(refuse(format!("scheme not allowed: {scheme}"))),
    }
}

/// How a URL reaches its handler: as one argument, never through a command interpreter.
#[derive(Debug, PartialEq)]
enum Launch<'a> {
    /// ShellExecuteW with the "open" verb, which starts the scheme's registered handler.
    ShellOpen(&'a str),
    /// A program run with the URL as its only argument.
    Program(&'static str, &'a str),
}

fn url_launch(url: &str) -> Option<Launch<'_>> {
    if cfg!(windows) {
        Some(Launch::ShellOpen(url))
    } else if cfg!(target_os = "macos") {
        Some(Launch::Program("open", url))
    } else if cfg!(target_os = "linux") {
        Some(Launch::Program("xdg-open", url))
    } else {
        None
    }
}

fn run_launch(launch: Launch<'_>) -> Result<(), String> {
    match launch {
        Launch::ShellOpen(url) => shell_open(url),
        Launch::Program(program, url) => match Command::new(program).arg(url).status() {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("open failed with status {}", s)),
            Err(e) => Err(e.to_string()),
        },
    }
}

/// `s` as NUL-terminated UTF-16. An interior NUL would end the string early, so it is refused.
#[cfg(windows)]
fn wide(s: &str) -> Result<Vec<u16>, String> {
    if s.contains('\0') {
        return Err("NUL in string".into());
    }
    Ok(s.encode_utf16().chain(std::iter::once(0)).collect())
}

#[cfg(windows)]
fn shell_open(url: &str) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    const SW_SHOWNORMAL: i32 = 1;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
    }

    let verb = wide("open")?;
    let file = wide(url)?;
    // ShellExecuteW may hand the verb to a shell extension through COM; the blocking pool's threads never initialised it.
    // SAFETY: both strings are NUL-terminated and outlive the call; the null arguments are optional.
    let code = with_com(|| unsafe {
        ShellExecuteW(
            null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    });
    // Above 32 is success; 32 and below is an SE_ERR_* code (shellapi.h).
    if code > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW failed with code {code}"))
    }
}

/// Runs `work` with COM initialised on this thread as ShellExecuteW asks (apartment-threaded, no OLE1 DDE), and
/// uninitialised after when this call was the one that initialised it. A thread already in another apartment keeps it.
#[cfg(windows)]
fn with_com<T>(work: impl FnOnce() -> T) -> T {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const COINIT_DISABLE_OLE1DDE: u32 = 0x4;

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> i32;
        fn CoUninitialize();
    }

    // SAFETY: the reserved argument must be null; every success (S_OK, S_FALSE) is balanced by one CoUninitialize.
    let hr = unsafe {
        CoInitializeEx(
            null_mut(),
            COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
        )
    };
    let out = work();
    if hr >= 0 {
        unsafe { CoUninitialize() };
    }
    out
}

#[cfg(not(windows))]
fn shell_open(_url: &str) -> Result<(), String> {
    Err("ShellExecuteW is Windows only".into())
}

/// Validates `url` and hands its launch to `run`: `run_launch` in the app, a recorder in tests.
fn open_url_with<'u>(
    url: &'u str,
    run: impl FnOnce(Launch<'u>) -> Result<(), String>,
) -> Result<(), ShellError> {
    validate_external_url(url)?;
    let launch = url_launch(url).ok_or_else(|| ShellError {
        code: "unsupported".into(),
        message: "no URL opener on this platform".into(),
    })?;
    run(launch).map_err(|message| ShellError {
        code: "io".into(),
        message,
    })
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), ShellError> {
    open_url_with(&url, run_launch)
}

/// Replaces `{file}` and `{line}` in one left-to-right pass, so a path that itself contains
/// `{line}` (or `{file}`) is inserted literally and never substituted again.
fn substitute(token: &str, file: &str, line: &str) -> String {
    let mut out = String::with_capacity(token.len() + file.len());
    let mut rest = token;
    while let Some(at) = rest.find('{') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        if let Some(after) = tail.strip_prefix("{file}") {
            out.push_str(file);
            rest = after;
        } else if let Some(after) = tail.strip_prefix("{line}") {
            out.push_str(line);
            rest = after;
        } else {
            out.push('{');
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}

/// The program and arguments that open `file` at `line`, as a list that is handed to
/// `std::process::Command` and never to a shell. A template is split on ASCII whitespace
/// with no quoting rules; `{file}` and `{line}` are substituted inside each token, and the file is
/// appended when no token names it. With no template, the platform opener (no line). An empty list
/// means there is no program line to run here: Windows' fallback is `edit_with_notepad`.
pub fn editor_argv(template: Option<&str>, file: &str, line: u32, os: &str) -> Vec<String> {
    let tokens: Vec<&str> = template
        .map(|t| t.split_ascii_whitespace().collect())
        .unwrap_or_default();
    if tokens.is_empty() {
        return match os {
            "macos" => vec!["open".into(), "-t".into(), file.into()],
            "linux" => vec!["xdg-open".into(), file.into()],
            _ => Vec::new(),
        };
    }
    let line = line.to_string();
    let names_file = tokens.iter().any(|t| t.contains("{file}"));
    let mut argv: Vec<String> = tokens.iter().map(|t| substitute(t, file, &line)).collect();
    if !names_file {
        argv.push(file.into());
    }
    argv
}

/// `external_editor` from the text of `config.toml`; a missing or blank key is no template.
fn editor_template(config: &str) -> Result<Option<String>, String> {
    let table: toml::Table = toml::from_str(config).map_err(|e| format!("config.toml: {e}"))?;
    match table.get("external_editor") {
        None => Ok(None),
        Some(toml::Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(toml::Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err("config.toml: external_editor is not a string".into()),
    }
}

fn read_editor_template(config_path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(config_path) {
        Ok(text) => editor_template(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("config.toml: {e}")),
    }
}

fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        std::env::consts::OS
    }
}

/// Starts `argv` detached: no shell (bar the `.cmd` shim fallback `code` needs on Windows), no inherited stdio, and a thread that reaps the child so it
/// never lingers as a zombie. Only a failure to start is reported; the editor's own exit is its own.
fn spawn_detached(argv: &[String]) -> std::io::Result<()> {
    let mut child = crate::commands::run::spawn_or_cmd_shim(&argv[0], |program| {
        let mut command = Command::new(program);
        command
            .args(&argv[1..])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::commands::run::skip_cwd_in_exe_search(&mut command);
        command
    })?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Notepad ships with Windows, so it is the editor of last resort. The path is one argument.
#[cfg(any(windows, test))]
fn notepad_argv(file: &str) -> Vec<String> {
    vec!["notepad.exe".into(), file.into()]
}

/// Windows with no template: Notepad, which ships with the system. Not the file kind's "edit" verb: for a plain .txt it
/// reports success and starts nothing. Not "open" either, which would hand the file back to Marxy when Marxy is the
/// default for its kind. The same limits as `open_with_system`: a file the window opened, and never a program.
#[cfg(windows)]
fn edit_with_notepad(path: &str) -> Result<(), ShellError> {
    let refuse = |message: &str| ShellError {
        code: "refused".into(),
        message: message.into(),
    };
    let file = crate::file_scheme::resolve(crate::file_scheme::opened(), Path::new(path))
        .map_err(|_| refuse("not a file this window opened"))?;
    if !file.is_file() {
        return Err(refuse("not a file"));
    }
    if is_program(&file) {
        return Err(refuse(
            "a program: Marxy does not start programs. Show it in its folder instead.",
        ));
    }
    let argv = notepad_argv(&file.to_string_lossy());
    spawn_detached(&argv).map_err(|e| ShellError {
        code: "io".into(),
        message: format!("{}: {e}", argv[0]),
    })
}

/// Opens `path` in the reader's editor at `line`. The template is read from `config.toml` on every
/// call, in Rust: the webview never names the program. Nothing about the document is read or written here.
#[tauri::command]
pub async fn reveal_in_editor(
    app: tauri::AppHandle,
    path: String,
    line: Option<u32>,
) -> Result<(), ShellError> {
    // Off the main thread: the file test and config.toml's read can stall on a share.
    crate::commands::fs::off_main(move || reveal_blocking(&app, &path, line))
        .await
        .map_err(|message| ShellError {
            code: "io".into(),
            message,
        })?
}

fn reveal_blocking(
    app: &tauri::AppHandle,
    path: &str,
    line: Option<u32>,
) -> Result<(), ShellError> {
    let file = Path::new(path);
    if !file.is_absolute() || !file.is_file() {
        return Err(ShellError {
            code: "unsupported".into(),
            message: "not an existing file".into(),
        });
    }
    let io = |message: String| ShellError {
        code: "io".into(),
        message,
    };
    // The same file `config_paths` names (commands/app.rs).
    let config = crate::data_dir::config_dir(app)
        .map_err(|e| io(e.to_string()))?
        .join("config.toml");
    let template = read_editor_template(&config).map_err(io)?;
    let argv = editor_argv(template.as_deref(), path, line.unwrap_or(1), current_os());
    if argv.is_empty() {
        #[cfg(windows)]
        if template.is_none() {
            return edit_with_notepad(path);
        }
        return Err(ShellError {
            code: "unsupported".into(),
            message: "no external_editor is set in config.toml".into(),
        });
    }
    spawn_detached(&argv).map_err(|e| io(format!("{}: {e}", argv[0])))
}

/// Kinds of file whose default action runs them: "Open in default app" never hands one over. Marxy reads; it does
/// not start programs, and a file card is reached by opening anything at all.
const PROGRAM_EXTENSIONS: &[&str] = &[
    "exe",
    "com",
    "bat",
    "cmd",
    "msi",
    "msp",
    "mst",
    "scr",
    "pif",
    "cpl",
    "ps1",
    "psm1",
    "psd1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "lnk",
    "url",
    "reg",
    "jar",
    "appref-ms",
    "application",
    "gadget",
    "msc",
    "inf",
    "sct",
    "scf",
    "app",
    "command",
    "sh",
    "bash",
    "zsh",
    "desktop",
    "appimage",
    "run",
    "pkg",
    "dmg",
    "deb",
    "rpm",
    "py",
    "pyw",
    "pl",
    "rb",
    "chm",
    "hlp",
    "msu",
    "jnlp",
    "xll",
    "xla",
    "xlam",
    "wsc",
    "ws",
    "vb",
    "msix",
    "msixbundle",
    "appx",
    "appxbundle",
    "appinstaller",
    "ppkg",
    "wsb",
    "settingcontent-ms",
    "mde",
    "accde",
    "accdr",
    "ade",
    "adp",
    "diagcab",
    "theme",
    "themepack",
    "deskthemepack",
    "xbap",
    "website",
];

fn on_the_list(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PROGRAM_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Whether the system's default action for `path` would run it: on the list, or, on Windows, a kind the system itself
/// calls dangerous (its own list and the registry's `FTA_AlwaysUnsafe`, which an installed program can add to), or a
/// Windows program by its head whatever it is called.
pub fn is_program(path: &Path) -> bool {
    on_the_list(path) || system_calls_dangerous(path) || starts_mz(path)
}

/// Whether the file begins MZ, a Windows program's DOS header: an extensionless or renamed program is still one.
/// Only two bytes are read; nothing is run.
fn starts_mz(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 2];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut head))
        .is_ok()
        && head == *b"MZ"
}

#[cfg(windows)]
fn system_calls_dangerous(path: &Path) -> bool {
    #[link(name = "shlwapi")]
    extern "system" {
        fn AssocIsDangerous(assoc: *const u16) -> i32;
    }
    let Some(ext) = path.extension() else {
        return false;
    };
    let Some(Ok(assoc)) = ext.to_str().map(|e| wide(&format!(".{e}"))) else {
        return true;
    };
    // SAFETY: a NUL-terminated string that outlives the call.
    unsafe { AssocIsDangerous(assoc.as_ptr()) != 0 }
}

#[cfg(not(windows))]
fn system_calls_dangerous(_path: &Path) -> bool {
    false
}

/// How a file reaches the system: its default program, or selected in the file manager. Never through a shell.
#[derive(Debug, PartialEq)]
enum FileLaunch {
    /// ShellExecuteW's "open" verb on the file: the program Windows uses for its kind.
    ShellOpen(String),
    /// A program and its arguments, run directly.
    Program(&'static str, Vec<String>),
    /// explorer.exe with `/select,"<path>"` as one raw argument (its own syntax, which ordinary quoting breaks).
    ExplorerSelect(String),
}

fn file_launch(path: &Path, reveal: bool, os: &str) -> Option<FileLaunch> {
    let file = path.to_string_lossy().into_owned();
    match (os, reveal) {
        ("windows", false) => Some(FileLaunch::ShellOpen(file)),
        // A path with a quote cannot be said in explorer's syntax (Windows names hold none).
        ("windows", true) if !file.contains('"') => Some(FileLaunch::ExplorerSelect(file)),
        ("macos", false) => Some(FileLaunch::Program("open", vec![file])),
        ("macos", true) => Some(FileLaunch::Program("open", vec!["-R".into(), file])),
        ("linux", false) => Some(FileLaunch::Program("xdg-open", vec![file])),
        // No file manager selects a file by a standard call: its folder opens.
        ("linux", true) => path
            .parent()
            .map(|dir| FileLaunch::Program("xdg-open", vec![dir.to_string_lossy().into_owned()])),
        _ => None,
    }
}

fn run_file_launch(launch: FileLaunch) -> Result<(), String> {
    match launch {
        FileLaunch::ShellOpen(file) => shell_open(&file),
        FileLaunch::Program(program, args) => {
            let argv: Vec<String> = std::iter::once(program.to_string()).chain(args).collect();
            spawn_detached(&argv).map_err(|e| format!("{program}: {e}"))
        }
        FileLaunch::ExplorerSelect(file) => explorer_select(&file),
    }
}

#[cfg(windows)]
fn explorer_select(file: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // explorer.exe answers 1 whether or not it showed the folder, so only a failure to start is an error.
    let mut child = Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{file}\""))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("explorer.exe: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(not(windows))]
fn explorer_select(_file: &str) -> Result<(), String> {
    Err("explorer.exe is Windows only".into())
}

/// Hands a file the page opened to the system (the file card): `reveal` false opens it in the program the system uses
/// for its kind, true shows it selected in the file manager. Only a regular file in the opened set (`file_scheme`), and
/// never a program: "Open in default app" on a program would run it.
#[tauri::command]
pub async fn open_with_system(path: String, reveal: bool) -> Result<(), ShellError> {
    crate::commands::fs::off_main(move || {
        let refuse = |message: &str| ShellError {
            code: "refused".into(),
            message: message.into(),
        };
        let file = crate::file_scheme::resolve(crate::file_scheme::opened(), Path::new(&path))
            .map_err(|_| refuse("not a file this window opened"))?;
        if !file.is_file() {
            return Err(refuse("not a file"));
        }
        if !reveal && is_program(&file) {
            return Err(refuse(
                "a program: Marxy does not start programs. Show it in its folder instead.",
            ));
        }
        let launch = file_launch(&file, reveal, current_os()).ok_or_else(|| ShellError {
            code: "unsupported".into(),
            message: "no way to open files on this platform".into(),
        })?;
        run_file_launch(launch).map_err(|message| ShellError {
            code: "io".into(),
            message,
        })
    })
    .await
    .map_err(|message| ShellError {
        code: "io".into(),
        message,
    })?
}

#[cfg(test)]
mod tests {
    use super::{
        editor_argv, editor_template, file_launch, is_program, notepad_argv, on_the_list,
        open_url_with, validate_external_url, FileLaunch, Launch, ShellError,
    };
    #[cfg(windows)]
    use super::{url_launch, wide, with_com};
    use std::path::Path;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_template_substitutes_file_and_line_inside_one_token() {
        assert_eq!(
            editor_argv(Some("code --goto {file}:{line}"), "/a b/c.md", 12, "macos"),
            strings(&["code", "--goto", "/a b/c.md:12"]),
            "a path with a space stays one argument"
        );
    }

    #[test]
    fn a_template_without_file_gets_the_path_appended() {
        assert_eq!(
            editor_argv(Some("subl -n"), "/d/r.md", 3, "linux"),
            strings(&["subl", "-n", "/d/r.md"])
        );
        assert_eq!(
            editor_argv(Some("  vim   +{line}  "), "/d/r.md", 9, "linux"),
            strings(&["vim", "+9", "/d/r.md"]),
            "runs of whitespace split once and no empty argument appears"
        );
    }

    #[test]
    fn shell_syntax_in_the_template_or_the_path_stays_literal() {
        assert_eq!(
            editor_argv(
                Some("ed;rm $(whoami) '{file}' \"x\""),
                "/t/a;b $(id) `x` 'q\".md",
                1,
                "macos"
            ),
            strings(&["ed;rm", "$(whoami)", "'/t/a;b $(id) `x` 'q\".md'", "\"x\"",]),
            "no quoting rules: quotes, `;` and `$(…)` are characters in tokens, never syntax"
        );
        assert_eq!(
            editor_argv(Some("e {file}"), "/t/{line}.md", 5, "linux"),
            strings(&["e", "/t/{line}.md"]),
            "a placeholder inside the path is not substituted again"
        );
    }

    #[test]
    fn no_template_uses_the_platform_opener() {
        assert_eq!(
            editor_argv(None, "/a b/c.md", 40, "macos"),
            strings(&["open", "-t", "/a b/c.md"])
        );
        assert_eq!(
            editor_argv(None, "/a b/c.md", 40, "linux"),
            strings(&["xdg-open", "/a b/c.md"])
        );
        assert_eq!(
            editor_argv(Some("   "), "/x.md", 1, "linux"),
            strings(&["xdg-open", "/x.md"])
        );
        assert!(editor_argv(None, "/x.md", 1, "windows").is_empty());
    }

    #[test]
    fn the_template_comes_from_external_editor_only() {
        assert_eq!(
            editor_template("size = 18\nexternal_editor = \"code --goto {file}:{line}\"\n")
                .unwrap(),
            Some("code --goto {file}:{line}".to_string())
        );
        assert_eq!(editor_template("size = 18\n").unwrap(), None);
        assert_eq!(editor_template("external_editor = \"\"\n").unwrap(), None);
        assert!(editor_template("external_editor = 3\n").is_err());
        assert!(editor_template("external_editor = \n").is_err());
    }

    #[test]
    fn notepad_gets_the_path_as_one_argument() {
        let path = "C:\\My Notes\\it's \"a\" b.md";
        assert_eq!(notepad_argv(path), strings(&["notepad.exe", path]));
    }

    #[test]
    fn open_external_refuses_javascript() {
        let err = validate_external_url("javascript:alert(1)").unwrap_err();
        assert_eq!(err.code, "unsupported");
    }

    #[test]
    fn open_external_refuses_file_scheme() {
        assert!(validate_external_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn open_external_allows_https_and_mailto() {
        assert!(validate_external_url("https://example.invalid/").is_ok());
        assert!(validate_external_url("http://example.invalid/").is_ok());
        assert!(validate_external_url("HTTPS://Example.invalid/a?b=1#c").is_ok());
        assert!(validate_external_url("mailto:user@example.invalid").is_ok());
        assert!(validate_external_url("mailto:?subject=hi").is_ok());
    }

    #[test]
    fn open_external_refuses_control_characters_and_whitespace() {
        for url in [
            "https://example.invalid/\n&calc",
            "https://example.invalid/\r\nx",
            "https://example.invalid/\tx",
            "https://example.invalid/\0x",
            "https://example.invalid/\u{7f}",
            "https://example.invalid/\u{85}",
            "mailto:a@example.invalid?body=\u{1b}[31m",
            " https://example.invalid/",
            "https://example.invalid/ ",
            "https://example.invalid/a b",
            "https://example.invalid/\u{3000}",
        ] {
            let err = validate_external_url(url).unwrap_err();
            assert_eq!(err.code, "unsupported", "{url:?}");
        }
    }

    #[test]
    fn open_external_refuses_a_quote() {
        assert!(validate_external_url("https://example.invalid/?q=\"x\"").is_err());
        assert!(validate_external_url("mailto:a@example.invalid?subject=\"x").is_err());
    }

    #[test]
    fn open_external_refuses_what_is_not_a_well_formed_url() {
        for url in [
            "",
            "https",
            "https:",
            "https://",
            "http://[::1",
            "https//example.invalid/",
            "example.invalid/path",
            "//example.invalid/",
            "mailto://a@example.invalid",
            "ftp://example.invalid/",
            "data:text/html,<script>1</script>",
            "vbscript:msgbox(1)",
            "ms-settings:privacy",
            "search-ms:query=x",
            "C:\\Windows\\System32\\calc.exe",
            "\\\\server\\share\\x.exe",
        ] {
            let err = validate_external_url(url).unwrap_err();
            assert_eq!(err.code, "unsupported", "{url:?}");
        }
    }

    /// URLs a command interpreter would split, pipe, escape, expand or redirect.
    const SHELL_METACHARACTERS: &[&str] = &[
        "https://example.invalid/?a=1&whoami",
        "https://example.invalid/?a=1&&calc&b=2",
        "https://example.invalid/?q=a|whoami",
        "https://example.invalid/?q=a^&b",
        "https://example.invalid/%PATH%?p=%PATH%&u=%USERNAME%",
        "https://example.invalid/?q=<x>&r=>out.txt",
        "http://example.invalid/a&b|c^d<e>f%PATH%",
        "mailto:a@example.invalid?subject=x&body=y&whoami",
        "mailto:a@example.invalid?body=a|whoami^&b",
        "mailto:%PATH%@example.invalid?cc=<b@example.invalid>&body=>x",
    ];

    fn launched(url: &str) -> (Result<(), ShellError>, Vec<String>) {
        let mut seen = Vec::new();
        let result = open_url_with(url, |launch| {
            match launch {
                Launch::ShellOpen(u) => {
                    assert!(std::ptr::eq(u, url), "the opener gets the input itself");
                    seen.push(format!("shell-open {u}"));
                }
                Launch::Program(program, u) => {
                    assert!(std::ptr::eq(u, url), "the opener gets the input itself");
                    seen.push(format!("{program} {u}"));
                }
            }
            Ok(())
        });
        (result, seen)
    }

    #[test]
    fn open_external_hands_shell_metacharacters_to_the_opener_unaltered() {
        let opener = if cfg!(windows) {
            "shell-open"
        } else if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        for &url in SHELL_METACHARACTERS {
            let (result, seen) = launched(url);
            assert!(result.is_ok(), "{url:?} is a well-formed URL");
            assert_eq!(
                seen,
                vec![format!("{opener} {url}")],
                "one launch, URL as written"
            );
        }
    }

    #[test]
    #[cfg(windows)]
    fn open_external_on_windows_never_starts_a_command_interpreter() {
        let quoted = [
            "https://example.invalid/?q=\"&whoami&\"",
            "mailto:a@example.invalid?subject=\"x\"&body=|^<>%PATH%",
        ];
        for &url in SHELL_METACHARACTERS.iter().chain(&quoted) {
            assert_eq!(
                url_launch(url),
                Some(Launch::ShellOpen(url)),
                "ShellExecuteW, no cmd.exe"
            );
            let w = wide(url).unwrap();
            assert_eq!(w.last(), Some(&0));
            assert_eq!(String::from_utf16(&w[..w.len() - 1]).unwrap(), url);
        }
        assert!(wide("https://example.invalid/\0&calc").is_err());
    }

    #[test]
    fn a_refused_url_never_reaches_the_opener() {
        for url in [
            "https://example.invalid/?q=\"x\"&whoami",
            "https://example.invalid/\n&calc",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            let mut ran = false;
            let result = open_url_with(url, |_| {
                ran = true;
                Ok(())
            });
            assert_eq!(result.unwrap_err().code, "unsupported", "{url:?}");
            assert!(!ran, "{url:?}");
        }
    }

    #[test]
    fn open_in_default_app_never_hands_over_a_program() {
        for p in [
            "C:/x/setup.exe",
            "C:/x/a.BAT",
            "/x/run.sh",
            "C:/x/link.lnk",
            "C:/x/s.ps1",
            "/x/A.JS",
        ] {
            assert!(is_program(Path::new(p)), "{p}");
        }
        for p in [
            "C:/x/index.tmk",
            "C:/x/IMG_0417.heic",
            "/x/disk.img",
            "/x/notes",
            "/x/a.png",
        ] {
            assert!(!on_the_list(Path::new(p)), "{p}");
        }
        for p in ["C:/x/index.tmk", "/x/notes", "/x/a.png", "/x/a.md"] {
            assert!(!is_program(Path::new(p)), "{p}");
        }
    }

    /// A program with no extension, or under a harmless name, is still refused by its MZ head; other bytes are not.
    #[test]
    fn a_file_that_begins_mz_is_a_program_whatever_its_name() {
        let dir = std::env::temp_dir().join(format!("marxy-mz-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bare = dir.join("tool");
        let renamed = dir.join("notes.txt");
        let text = dir.join("readme");
        std::fs::write(&bare, b"MZ\x90\x00").unwrap();
        std::fs::write(&renamed, b"MZ").unwrap();
        std::fs::write(&text, b"Mz is not MZ").unwrap();
        assert!(is_program(&bare));
        assert!(is_program(&renamed));
        assert!(!is_program(&text));
        assert!(!is_program(&dir.join("missing")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The kinds Windows runs, installs or opens with code in them, which the first list missed.
    #[test]
    fn the_modern_installer_and_script_kinds_are_programs_too() {
        for ext in [
            "chm",
            "hlp",
            "msu",
            "jnlp",
            "xll",
            "xla",
            "xlam",
            "wsc",
            "ws",
            "vb",
            "msix",
            "msixbundle",
            "appx",
            "appxbundle",
            "appinstaller",
            "ppkg",
            "wsb",
            "settingcontent-ms",
            "mde",
            "accde",
            "accdr",
            "ade",
            "adp",
            "diagcab",
            "theme",
            "themepack",
            "deskthemepack",
            "xbap",
            "website",
        ] {
            let lower = format!("C:/x/a.{ext}");
            let upper = format!("C:/x/a.{}", ext.to_ascii_uppercase());
            assert!(on_the_list(Path::new(&lower)), "{ext} is not on the list");
            assert!(is_program(Path::new(&upper)), "{ext} in capitals");
        }
    }

    /// What the system itself calls dangerous is refused even when the list does not name it: a disk image mounts, a
    /// certificate installs, a `.mdb` runs its macros.
    #[test]
    #[cfg(windows)]
    fn on_windows_what_the_system_calls_dangerous_is_a_program() {
        for p in [
            "C:/x/disk.img",
            "C:/x/a.iso",
            "C:/x/a.vhdx",
            "C:/x/a.cer",
            "C:/x/a.mdb",
            "C:/x/a.grp",
        ] {
            assert!(
                !on_the_list(Path::new(p)),
                "{p} is on the list; pick another"
            );
            assert!(is_program(Path::new(p)), "{p}");
        }
        for p in [
            "C:/x/a.md",
            "C:/x/a.png",
            "C:/x/a.txt",
            "C:/x/a.pdf",
            "C:/x/notes",
        ] {
            assert!(!is_program(Path::new(p)), "{p}");
        }
    }

    /// ShellExecuteW runs inside a COM apartment on a thread that had none (the blocking pool's), and leaves the thread
    /// as it found it.
    #[test]
    #[cfg(windows)]
    fn shell_execute_runs_with_com_initialised_and_balanced() {
        #[link(name = "ole32")]
        extern "system" {
            fn CoGetApartmentType(kind: *mut i32, qualifier: *mut i32) -> i32;
        }
        const CO_E_NOTINITIALIZED: i32 = 0x800401F0_u32 as i32;
        let apartment = || {
            let (mut kind, mut qualifier) = (-1, -1);
            let hr = unsafe { CoGetApartmentType(&mut kind, &mut qualifier) };
            (hr, kind)
        };
        std::thread::spawn(move || {
            assert_eq!(
                apartment().0,
                CO_E_NOTINITIALIZED,
                "a fresh thread has no apartment"
            );
            let (hr, kind) = with_com(apartment);
            assert_eq!(hr, 0);
            assert!(
                kind == 0 || kind == 3,
                "apartment type {kind}, not single-threaded"
            );
            assert_eq!(apartment().0, CO_E_NOTINITIALIZED, "COM left initialised");
        })
        .join()
        .expect("thread");
    }

    #[test]
    fn a_file_reaches_the_system_as_one_argument_never_through_a_shell() {
        let p = Path::new("C:/a b/c;d.tmk");
        assert_eq!(
            file_launch(p, false, "windows"),
            Some(FileLaunch::ShellOpen("C:/a b/c;d.tmk".into()))
        );
        assert_eq!(
            file_launch(p, true, "windows"),
            Some(FileLaunch::ExplorerSelect("C:/a b/c;d.tmk".into()))
        );
        assert_eq!(
            file_launch(Path::new("/a b/c.img"), true, "macos"),
            Some(FileLaunch::Program(
                "open",
                vec!["-R".into(), "/a b/c.img".into()]
            ))
        );
        assert_eq!(
            file_launch(Path::new("/a b/c.img"), true, "linux"),
            Some(FileLaunch::Program("xdg-open", vec!["/a b".into()]))
        );
        assert_eq!(file_launch(Path::new("C:/x\"y"), true, "windows"), None);
        assert_eq!(file_launch(p, false, "plan9"), None);
    }
}
