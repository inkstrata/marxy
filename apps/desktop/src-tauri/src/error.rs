//! Shell command errors serialised to the webview.

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

    /// A create-only write found something at the name.
    pub fn exists(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "exists".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    /// A save found the file no longer what was read, and wrote nothing.
    pub fn changed(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "changed".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    pub fn permission(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "permission".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    /// Understood, and declined: a size or a flag the app will not go past.
    pub fn refused(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "refused".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }

    /// A path that is not one the reader opened or chose, nor Marxy's own folders (src/scope.rs).
    pub fn outside(path: impl Into<String>) -> Self {
        let path = path.into();
        Self {
            code: "outside".into(),
            message: format!(
                "{path}: Marxy reads only the files you opened and the folders you chose"
            ),
            path: Some(path),
        }
    }

    /// A format or method the app does not read.
    pub fn unsupported(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: "unsupported".into(),
            message: message.into(),
            path: Some(path.into()),
        }
    }
}
