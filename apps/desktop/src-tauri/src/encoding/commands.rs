//! `decode_text`, `encode_text` and `encoding_readings`: the bytes the page already read, as text (with the byte map),
//! back to bytes for a save, and read each way for Read with encoding.... Each takes the bytes as a raw body and the
//! encoding in `x-marxy-encoding`; none reads or writes a file.

use crate::error::ShellError;

use super::{ByteMap, Decoded};

const ENCODING_HEADER: &str = "x-marxy-encoding";
const BOM_HEADER: &str = "x-marxy-bom";

fn body<'a>(command: &str, request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], ShellError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err(ShellError::invalid(
            "",
            format!("{command}: expected the bytes as a raw body"),
        )),
    }
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .filter(|v| !v.is_empty())
}

/// The frame `decode_text` answers with: the head's JSON length (u32, little-endian), the head (`found` and the map's
/// kind), the table's index (its length in u32s, then the u32s, little-endian), the table's runs (their length in
/// bytes, then the bytes; see `table.rs`), then the text as UTF-8. A map that is not a table has both empty.
pub fn frame(decoded: &Decoded) -> Vec<u8> {
    let (map, index, runs): (serde_json::Value, &[u32], &[u8]) = match &decoded.map {
        ByteMap::Identity => (serde_json::json!({ "kind": "identity" }), &[], &[]),
        ByteMap::Units { unit, utf16 } => (
            serde_json::json!({ "kind": "units", "unit": unit, "count": if *utf16 { "utf16" } else { "scalar" } }),
            &[],
            &[],
        ),
        ByteMap::Table(t) => (
            serde_json::json!({ "kind": "table" }),
            t.index.as_slice(),
            t.runs.as_slice(),
        ),
    };
    let head = serde_json::to_vec(&serde_json::json!({ "found": decoded.found, "map": map }))
        .unwrap_or_default();
    let mut out =
        Vec::with_capacity(12 + head.len() + index.len() * 4 + runs.len() + decoded.text.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&(index.len() as u32).to_le_bytes());
    for v in index {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&(runs.len() as u32).to_le_bytes());
    out.extend_from_slice(runs);
    out.extend_from_slice(&decoded.text);
    out
}

#[tauri::command]
pub async fn decode_text(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, ShellError> {
    let bytes = body("decode_text", &request)?.to_vec();
    let chosen = header(&request, ENCODING_HEADER);
    crate::commands::fs::off_main(move || {
        super::decode(&bytes, chosen.as_deref())
            .map(|d| frame(&d))
            .map_err(|e| ShellError::invalid("", e))
    })
    .await
    .map_err(|e| ShellError::io("", e))?
    .map(tauri::ipc::Response::new)
}

/// The text (a raw UTF-8 body) as the bytes of the encoding in `x-marxy-encoding`, with its BOM when `x-marxy-bom` is
/// `1`; refused, naming the character, when the encoding has no bytes for one.
#[tauri::command]
pub async fn encode_text(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, ShellError> {
    let text = String::from_utf8(body("encode_text", &request)?.to_vec())
        .map_err(|_| ShellError::invalid("", "encode_text: the text is not UTF-8"))?;
    let label = header(&request, ENCODING_HEADER).ok_or_else(|| {
        ShellError::invalid("", format!("encode_text: missing {ENCODING_HEADER}"))
    })?;
    let bom = header(&request, BOM_HEADER).as_deref() == Some("1");
    crate::commands::fs::off_main(move || {
        super::encode(&text, &label, bom)
            .map_err(|e| ShellError::refused("", e.say(&super::name_of(&label))))
    })
    .await
    .map_err(|e| ShellError::io("", e))?
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn encoding_readings(
    request: tauri::ipc::Request<'_>,
) -> Result<super::Readings, ShellError> {
    let bytes = body("encoding_readings", &request)?.to_vec();
    crate::commands::fs::off_main(move || super::readings(&bytes))
        .await
        .map_err(|e| ShellError::io("", e))
}
