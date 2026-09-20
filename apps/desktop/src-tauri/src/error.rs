//! Shell command errors serialised to the webview (docs/design/06-shell.md). Story MARXY-138.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ShellError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl ShellError {
    pub fn not_found(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "not-found".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    pub fn invalid(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "invalid".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    pub fn io(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "io".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }
}
