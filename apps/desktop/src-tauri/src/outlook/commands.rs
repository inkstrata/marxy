//! `mail_from_msg`: an Outlook message the page already read (a file, an archive's entry or an attachment held in
//! memory), as a raw body, back as the message it would be as it travels. Nothing is read from or written to disk.

use crate::error::ShellError;

/// The answer's frame: the facts' JSON length (u32, little-endian), the facts, then the message.
pub fn frame(c: &super::Converted) -> Vec<u8> {
    let head = serde_json::to_vec(&c.facts).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + head.len() + c.mime.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&c.mime);
    out
}

/// The read, any panic in it said as a damaged file: the bytes are a stranger's.
pub fn convert(bytes: &[u8]) -> Result<Vec<u8>, ShellError> {
    let read = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        super::read(bytes, &super::Limits::DEFAULT)
    }))
    .unwrap_or(Err(super::Fault::Damaged));
    match read {
        Ok(c) => Ok(frame(&c)),
        Err(e @ super::Fault::TooBig(_)) => Err(ShellError::refused("", e.say())),
        Err(e) => Err(ShellError::invalid("", e.say())),
    }
}

#[tauri::command]
pub async fn mail_from_msg(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, ShellError> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(ShellError::invalid(
                "",
                "mail_from_msg: expected the bytes as a raw body",
            ))
        }
    };
    crate::commands::fs::off_main(move || convert(&bytes))
        .await
        .map_err(|e| ShellError::io("", e))?
        .map(tauri::ipc::Response::new)
}
