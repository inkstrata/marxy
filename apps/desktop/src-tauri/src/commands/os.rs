//! External URL open with an http/https/mailto allow-list (docs/design/06-shell.md). MARXY-240.
//! Open in external editor (docs/design/09-app-shell.md, D-A31). A-16.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ShellError {
    pub code: String,
    pub message: String,
}

/// Refuses every scheme outside http, https and mailto (shell-api contract).
pub fn validate_external_url(url: &str) -> Result<(), ShellError> {
    let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();
    if matches!(scheme.as_str(), "http" | "https" | "mailto") {
        return Ok(());
    }
    Err(ShellError {
        code: "unsupported".into(),
        message: format!("scheme not allowed: {scheme}"),
    })
}

fn launch_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", url]).status();
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let status: Result<std::process::ExitStatus, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "platform",
    ));

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("open failed with status {}", s)),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), ShellError> {
    validate_external_url(&url)?;
    launch_url(&url).map_err(|message| ShellError {
        code: "io".into(),
        message,
    })
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
/// `std::process::Command` and never to a shell (D-A31). A template is split on ASCII whitespace
/// with no quoting rules; `{file}` and `{line}` are substituted inside each token, and the file is
/// appended when no token names it. With no template, the platform opener (no line). An empty list
/// means there is nothing to run on this platform.
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

/// Starts `argv` detached: no shell, no inherited stdio, and a thread that reaps the child so it
/// never lingers as a zombie. Only a failure to start is reported; the editor's own exit is its own.
fn spawn_detached(argv: &[String]) -> std::io::Result<()> {
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Opens `path` in the reader's editor at `line` (docs/design/09-app-shell.md §Open in external
/// editor). The template is read from `config.toml` on every call, in Rust: the webview never names
/// the program (D-A31). Nothing about the document is read or written here.
#[tauri::command]
pub fn reveal_in_editor(
    app: tauri::AppHandle,
    path: String,
    line: Option<u32>,
) -> Result<(), ShellError> {
    let file = Path::new(&path);
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
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| io(e.to_string()))?
        .join("config.toml");
    let template = read_editor_template(&config).map_err(io)?;
    let argv = editor_argv(template.as_deref(), &path, line.unwrap_or(1), current_os());
    if argv.is_empty() {
        return Err(ShellError {
            code: "unsupported".into(),
            message: "no external_editor is set in config.toml".into(),
        });
    }
    spawn_detached(&argv).map_err(|e| io(format!("{}: {e}", argv[0])))
}

#[cfg(test)]
mod tests {
    use super::{editor_argv, editor_template, validate_external_url};

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
        assert!(validate_external_url("mailto:user@example.invalid").is_ok());
    }
}
