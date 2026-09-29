//! External URL open with an http/https/mailto allow-list (docs/design/06-shell.md). MARXY-240.
#![allow(dead_code)] // `open_external` is registered in `main.rs` (outside this story's paths until wired).

use serde::Serialize;
use std::process::Command;

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

#[allow(dead_code)] // Wired in main.rs invoke_handler once that file is in the story paths.
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

#[allow(dead_code)]
#[tauri::command]
pub fn open_external(url: String) -> Result<(), ShellError> {
    validate_external_url(&url)?;
    launch_url(&url).map_err(|message| ShellError {
        code: "io".into(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

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
