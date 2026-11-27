//! Content detection: what a file's head says it is, under whatever name it has. Signals only: the text test
//! (byte-order mark, NUL, UTF-8 validity), the magic bytes of a binary format (`infer`, MIT, already in the lockfile
//! through tauri), the interpreter a shebang names, the mode an Emacs or Vim modeline names, and a word from a few
//! linguist-style heuristics for names that are ambiguous (`.h`, `.m`, `.pl`) or absent. What each signal means (the
//! row, the reading, the language id) is the registry's in core (`packages/core/src/kind/registry.ts`), never decided
//! here. Only the head is read, on the blocking pool.

use std::path::Path;
use std::sync::RwLock;

use serde::Serialize;

#[cfg(test)]
use crate::commands::fs::read_head_bytes;
use crate::commands::fs::{off_main, read_head_in};
use crate::scope::OpenedSet;

/// The most bytes of a file detection reads.
pub const DETECT_HEAD_BYTES: u64 = 8 * 1024;
/// The most paths one `detect_files` call reads; the rest come back unread (null).
pub const DETECT_MAX_PATHS: usize = 5_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// `text`, `binary` or `empty`.
    pub class: &'static str,
    /// For text: `utf-8`, `utf-8-bom`, `utf-16le`, `utf-16be`, `utf-32le`, `utf-32be` or `8-bit` (not valid UTF-8,
    /// but no binary bytes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<&'static str>,
    /// A binary format's usual extension, as its magic bytes name it (`png`, `mp4`, `mpeg-ts`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// The interpreter a `#!` line names, without its folder or `env` (`python3`, `node`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shebang: Option<String>,
    /// The mode an Emacs `-*- -*-` line or a Vim `ft=` modeline names, lowercased.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modeline: Option<String>,
    /// A heuristic's language word for an ambiguous or missing extension (`objective-c`, `cpp`, `prolog`, `xml`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

impl Detection {
    fn text(encoding: &'static str) -> Self {
        Detection {
            class: "text",
            encoding: Some(encoding),
            format: None,
            shebang: None,
            modeline: None,
            lang: None,
        }
    }
    fn binary(format: Option<String>) -> Self {
        Detection {
            class: "binary",
            encoding: None,
            format,
            shebang: None,
            modeline: None,
            lang: None,
        }
    }
}

/// Formats whose magic is decisive even over a head that reads as text: their signatures are long and specific.
const TEXT_LOOKING_BINARIES: &[&str] = &["pdf"];

/// A Shell Link header: its size, 0x4C, then the link class id. Long enough that no text starts with it.
const SHELL_LINK: [u8; 20] = [
    0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46,
];

/// What `head` (the first bytes of the file called `name`) says the file is. `whole` is true when `head` is the whole
/// file, so its last lines can be read for a Vim modeline.
pub fn detect(name: &str, head: &[u8], whole: bool) -> Detection {
    if head.is_empty() {
        return Detection {
            class: "empty",
            encoding: None,
            format: None,
            shebang: None,
            modeline: None,
            lang: None,
        };
    }
    if is_mpeg_ts(head) {
        return Detection::binary(Some("mpeg-ts".into()));
    }
    // A font collection: `infer` names its members' formats, not the collection.
    if head.starts_with(b"ttcf") {
        return Detection::binary(Some("ttc".into()));
    }
    if head.starts_with(&SHELL_LINK) {
        return Detection::binary(Some("lnk".into()));
    }
    // A PNM header is text (P1 to P3 are text throughout), but under a PNM name it is the picture.
    if extension(name).is_some_and(|e| matches!(e.as_str(), "pbm" | "pgm" | "ppm" | "pnm" | "pam"))
        && crate::decode::is_pnm(head)
    {
        return Detection::binary(Some("pnm".into()));
    }
    let magic = infer::get(head).filter(|t| t.matcher_type() != infer::MatcherType::Text);
    let (text, encoding) = match decode_text(head) {
        Some(decoded) => decoded,
        None => return Detection::binary(magic.map(|t| t.extension().to_string())),
    };
    if let Some(t) = magic {
        if TEXT_LOOKING_BINARIES.contains(&t.extension()) {
            return Detection::binary(Some(t.extension().to_string()));
        }
    }
    let mut out = Detection::text(encoding);
    let lines: Vec<&str> = text.lines().take(5).collect();
    out.shebang = lines.first().and_then(|l| shebang(l));
    out.modeline = lines
        .iter()
        .take(2)
        .find_map(|l| emacs_mode(l))
        .or_else(|| {
            let tail: Vec<&str> = if whole {
                text.lines().rev().take(5).collect()
            } else {
                Vec::new()
            };
            lines
                .iter()
                .chain(tail.iter())
                .find_map(|l| vim_filetype(l))
        });
    out.lang = heuristic(
        extension(name).as_deref(),
        &text,
        out.shebang.is_some() || out.modeline.is_some(),
    );
    out
}

/// The lowercased extension of `name`, or None (a leading dot is a dotfile, not an extension).
fn extension(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    if dot == 0 {
        return None;
    }
    Some(name[dot + 1..].to_ascii_lowercase())
}

/// MPEG transport stream: a 0x47 sync byte every 188 bytes (a `.ts` that is video, not TypeScript).
fn is_mpeg_ts(head: &[u8]) -> bool {
    head.len() >= 188 * 3 && (0..3).all(|i| head[i * 188] == 0x47)
}

/// The head as text and its encoding, or None when it holds binary bytes. A byte-order mark decides the encoding;
/// otherwise a NUL is binary, valid UTF-8 (a character cut at the end of the head included) is UTF-8, and anything
/// else is text only when it carries no C0 control bytes but whitespace and escape (UTF-8 may carry one in a hundred).
fn decode_text(head: &[u8]) -> Option<(String, &'static str)> {
    if let Some(rest) = head.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return utf8_prefix(rest).map(|t| (t, "utf-8-bom"));
    }
    if head.starts_with(&[0xff, 0xfe, 0, 0]) {
        return Some((utf32(&head[4..], u32::from_le_bytes), "utf-32le"));
    }
    if head.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Some((utf32(&head[4..], u32::from_be_bytes), "utf-32be"));
    }
    if head.starts_with(&[0xff, 0xfe]) {
        return Some((utf16(&head[2..], u16::from_le_bytes), "utf-16le"));
    }
    if head.starts_with(&[0xfe, 0xff]) {
        return Some((utf16(&head[2..], u16::from_be_bytes), "utf-16be"));
    }
    if head.contains(&0) {
        return None;
    }
    let control = head
        .iter()
        .filter(|&&b| b < 0x20 && !matches!(b, b'\t' | b'\n' | b'\r' | 0x0c | 0x1b))
        .count();
    if let Some(text) = utf8_prefix(head) {
        // A stray bell or backspace is still text; a head full of control bytes is not.
        return (control * 100 <= head.len()).then_some((text, "utf-8"));
    }
    if control > 0 {
        return None;
    }
    Some((head.iter().map(|&b| b as char).collect(), "8-bit"))
}

/// Valid UTF-8, allowing one character cut short at the very end (the head stops mid-file).
fn utf8_prefix(bytes: &[u8]) -> Option<String> {
    match std::str::from_utf8(bytes) {
        Ok(s) => Some(s.to_string()),
        Err(e) if e.error_len().is_none() => {
            Some(String::from_utf8_lossy(&bytes[..e.valid_up_to()]).into_owned())
        }
        Err(_) => None,
    }
}

fn utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| unit([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

fn utf32(bytes: &[u8], unit: fn([u8; 4]) -> u32) -> String {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| char::from_u32(unit(*c)).unwrap_or('\u{fffd}'))
        .collect()
}

/// `#!/usr/bin/env -S python3 -u` is `python3`; `#!/bin/sh` is `sh`.
fn shebang(line: &str) -> Option<String> {
    let rest = line.strip_prefix("#!")?.trim();
    let mut words = rest.split_whitespace();
    let mut program = base_name(words.next()?);
    if program == "env" {
        program = words
            .find(|w| !w.starts_with('-') && !w.contains('='))
            .map(base_name)?;
    }
    if program.is_empty() {
        None
    } else {
        Some(program.to_ascii_lowercase())
    }
}

fn base_name(word: &str) -> &str {
    word.rsplit(['/', '\\']).next().unwrap_or(word)
}

/// `-*- mode: python; coding: utf-8 -*-`, or `-*- c++ -*-` with no variables.
fn emacs_mode(line: &str) -> Option<String> {
    let start = line.find("-*-")? + 3;
    let end = start + line[start..].find("-*-")?;
    let inner = line[start..end].trim();
    if !inner.contains(':') {
        return (!inner.is_empty()).then(|| inner.to_ascii_lowercase());
    }
    inner.split(';').find_map(|var| {
        let (key, value) = var.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case("mode")
            .then(|| value.trim().to_ascii_lowercase())
    })
}

/// `vim: set ft=python :`, `vi: filetype=sh`, `ex: syntax=perl`, as Vim reads a modeline: after whitespace or at the
/// line's start.
fn vim_filetype(line: &str) -> Option<String> {
    let at = ["vim:", "vi:", "ex:", "Vim:"].iter().find_map(|m| {
        line.match_indices(m)
            .map(|(i, _)| i)
            .find(|&i| i == 0 || line[..i].ends_with(char::is_whitespace))
            .map(|i| i + m.len())
    })?;
    line[at..]
        .split(|c: char| c.is_whitespace() || c == ':')
        .find_map(|opt| {
            let (key, value) = opt.split_once('=')?;
            matches!(key, "ft" | "filetype" | "syn" | "syntax").then(|| value.to_ascii_lowercase())
        })
        .filter(|v| !v.is_empty())
}

fn any_line(text: &str, test: impl Fn(&str) -> bool) -> bool {
    text.lines().any(|l| test(l.trim_start()))
}

/// The linguist-style tie-breakers, run only where the name leaves the language open: an ambiguous extension, or
/// none at all (when no shebang or modeline already spoke).
fn heuristic(ext: Option<&str>, text: &str, spoke: bool) -> Option<String> {
    let objc = |l: &str| {
        [
            "@interface",
            "@implementation",
            "@protocol",
            "@property",
            "@end",
            "#import ",
        ]
        .iter()
        .any(|k| l.starts_with(k))
    };
    let word = match ext {
        Some("h") => {
            if any_line(text, objc) {
                "objective-c"
            } else if any_line(text, |l| {
                l.starts_with("class ")
                    || l.starts_with("namespace ")
                    || l.starts_with("template <")
                    || l.starts_with("template<")
                    || l.starts_with("public:")
                    || l.starts_with("private:")
                    || l.contains("std::")
                    || ["iostream", "string>", "vector>", "memory>", "map>"]
                        .iter()
                        .any(|h| l.starts_with("#include <") && l.contains(h))
            }) {
                "cpp"
            } else {
                return None;
            }
        }
        Some("m") => {
            if any_line(text, objc) || any_line(text, |l| l.starts_with("#include")) {
                "objective-c"
            } else if any_line(text, |l| l.starts_with(":- module")) {
                "mercury"
            } else if any_line(text, |l| {
                l.starts_with("function ") || l.starts_with("% ") || l.starts_with("%%")
            }) {
                "matlab"
            } else {
                return None;
            }
        }
        Some("pl") => {
            if any_line(text, |l| {
                l.starts_with("use strict")
                    || l.starts_with("use warnings")
                    || l.starts_with("my $")
                    || l.starts_with("sub ")
            }) {
                "perl"
            } else if any_line(text, |l| {
                l.starts_with(":-") || (l.contains(":-") && l.trim_end().ends_with(['.', ',']))
            }) {
                "prolog"
            } else {
                return None;
            }
        }
        None if !spoke => {
            let first = text.trim_start();
            if first.starts_with("<?xml") {
                "xml"
            } else if first
                .get(..9)
                .is_some_and(|s| s.eq_ignore_ascii_case("<!doctype"))
                && first[9..]
                    .trim_start()
                    .get(..4)
                    .is_some_and(|s| s.eq_ignore_ascii_case("html"))
                || first
                    .get(..5)
                    .is_some_and(|s| s.eq_ignore_ascii_case("<html"))
            {
                "html"
            } else if first.starts_with("<?php") {
                "php"
            } else if first.starts_with("diff --git ")
                || (first.starts_with("--- ") && text.contains("\n+++ "))
            {
                "diff"
            } else if (first.starts_with('{') || first.starts_with('[')) && looks_json(first) {
                "json"
            } else if looks_mail(text) {
                "eml"
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(word.to_string())
}

/// A head that opens like a mail message (core `mail/mime.ts`'s `looksLikeMessage`): header lines up to the first
/// empty one, naming a sender and at least two headers only mail carries.
fn looks_mail(text: &str) -> bool {
    let mut names = Vec::new();
    let mut lines = 0;
    // `lines` drops a `\r`, so a CRLF block ends at its first empty line as an LF one does.
    for line in text.lines().take_while(|l| !l.is_empty()) {
        lines += 1;
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((name, _)) = line.split_once(':') else {
            return false;
        };
        if name.is_empty() || !name.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
            return false;
        }
        names.push(name.to_ascii_lowercase());
    }
    let has = |n: &str| names.iter().any(|x| x == n);
    let mail_only = [
        "received",
        "return-path",
        "message-id",
        "mime-version",
        "subject",
        "date",
        "to",
        "delivered-to",
    ]
    .iter()
    .filter(|n| has(n))
    .count();
    lines >= 3 && has("from") && mail_only >= 2
}

/// A head that opens like JSON: `{` then a quoted key or `}`, or `[` then a value.
fn looks_json(text: &str) -> bool {
    let mut chars = text.chars();
    let open = chars.next();
    let next = chars.find(|c| !c.is_whitespace());
    match (open, next) {
        (Some('{'), Some(c)) => c == '"' || c == '}',
        (Some('['), Some(c)) => {
            matches!(c, '{' | '[' | '"' | ']' | '-' | '0'..='9' | 't' | 'f' | 'n')
        }
        _ => false,
    }
}

/// Detects one file from its head, judging no scope; None when it cannot be read as a regular file.
#[cfg(test)]
pub fn detect_path(path: &str) -> Option<Detection> {
    detect_head(path, read_head_bytes(path, DETECT_HEAD_BYTES).ok()?)
}

/// What a file is, by its name and its head, read in scope as `read_head` reads it.
pub fn detect_in(set: &RwLock<OpenedSet>, path: &str) -> Option<Detection> {
    detect_head(path, read_head_in(set, path, DETECT_HEAD_BYTES).ok()?)
}

fn detect_head(path: &str, head: Vec<u8>) -> Option<Detection> {
    let whole = (head.len() as u64) < DETECT_HEAD_BYTES;
    let name = Path::new(path).file_name()?.to_string_lossy().into_owned();
    Some(detect(&name, &head, whole))
}

/// What each file's head says it is, in the order asked: null for a path that is not a readable regular file,
/// or past `DETECT_MAX_PATHS`. Reads at most `DETECT_HEAD_BYTES` of each, on the blocking pool.
#[tauri::command]
pub async fn detect_files(paths: Vec<String>) -> Result<Vec<Option<Detection>>, String> {
    off_main(move || {
        paths
            .iter()
            .enumerate()
            .map(|(i, p)| {
                // A path out of scope reads as one that could not be read (src/scope.rs).
                if i < DETECT_MAX_PATHS {
                    detect_in(crate::scope::opened(), p)
                } else {
                    None
                }
            })
            .collect()
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/detect")
    }

    /// The shared table (fixtures/detect/expected.json): each fixture's head gives exactly the signals recorded for it.
    /// core's registry test reads the same table and checks each recorded signal set lands on its reading.
    #[test]
    fn every_fixture_gives_its_recorded_signals() {
        let table: Value = serde_json::from_slice(
            &fs::read(fixtures().join("expected.json")).expect("expected.json"),
        )
        .expect("json");
        let cases = table["files"].as_object().expect("files");
        assert!(cases.len() >= 55, "about 60 fixtures, got {}", cases.len());
        let mut listed: Vec<String> = fs::read_dir(fixtures())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != "expected.json")
            .collect();
        listed.sort();
        let mut named: Vec<String> = cases.keys().cloned().collect();
        named.sort();
        assert_eq!(
            listed, named,
            "every fixture is in the table and every row has a fixture"
        );
        let mut failures = Vec::new();
        for (name, case) in cases {
            let got = detect_path(&fixtures().join(name).to_string_lossy()).expect("readable");
            let got = serde_json::to_value(&got).unwrap();
            if got != case["detect"] {
                failures.push(format!("{name}: got {got}, expected {}", case["detect"]));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn fonts_and_media_are_named_by_their_magic() {
        let demo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/demo");
        for (file, format) in [
            ("fonts/Tidemark.ttc", "ttc"),
            ("fonts/TidemarkSans-Regular.ttf", "ttf"),
            ("fonts/TidemarkSans-Bold.otf", "otf"),
            ("fonts/TidemarkSans-Regular.woff", "woff"),
            ("fonts/TidemarkSans[wdth,wght].woff2", "woff2"),
            ("media/bell-buoy.wav", "wav"),
            ("media/ferry-leaving.mp4", "mp4"),
            ("media/interview-prores.mov", "mov"),
        ] {
            let got = detect_path(&demo.join(file).to_string_lossy()).expect("readable");
            assert_eq!(
                (got.class, got.format.as_deref()),
                ("binary", Some(format)),
                "{file}"
            );
        }
    }

    #[test]
    fn a_shebang_names_its_interpreter_through_env_and_its_flags() {
        assert_eq!(
            shebang("#!/usr/bin/env python3").as_deref(),
            Some("python3")
        );
        assert_eq!(
            shebang("#!/usr/bin/env -S node --no-warnings").as_deref(),
            Some("node")
        );
        assert_eq!(shebang("#! /bin/sh -e").as_deref(), Some("sh"));
        assert_eq!(
            shebang("#!/usr/bin/env FOO=1 ruby").as_deref(),
            Some("ruby")
        );
        assert_eq!(shebang("# not one"), None);
    }

    #[test]
    fn modelines_in_emacs_and_vim_forms() {
        assert_eq!(
            emacs_mode("# -*- mode: Python; coding: utf-8 -*-").as_deref(),
            Some("python")
        );
        assert_eq!(emacs_mode("// -*- C++ -*-").as_deref(), Some("c++"));
        assert_eq!(emacs_mode("-*- coding: utf-8 -*-"), None);
        assert_eq!(
            vim_filetype("# vim: set ft=sh ts=2 :").as_deref(),
            Some("sh")
        );
        assert_eq!(vim_filetype("/* vi:filetype=c */").as_deref(), Some("c"));
        assert_eq!(vim_filetype("evim: ft=x"), None);
    }

    #[test]
    fn the_text_test_reads_marks_nul_and_utf8() {
        assert_eq!(
            detect("a", b"\xef\xbb\xbfhi", true).encoding,
            Some("utf-8-bom")
        );
        assert_eq!(
            detect("a", b"\xff\xfeh\0i\0", true).encoding,
            Some("utf-16le")
        );
        assert_eq!(detect("a", b"h\0i", true).class, "binary");
        // A UTF-32 BOM is text, NULs and all; UTF-16 with no BOM is not guessed.
        assert_eq!(
            detect("a", b"\xff\xfe\0\0h\0\0\0", true).encoding,
            Some("utf-32le")
        );
        assert_eq!(
            detect("a", b"\0\0\xfe\xff\0\0\0h", true).encoding,
            Some("utf-32be")
        );
        assert_eq!(
            detect("a", "caf\u{e9}".as_bytes(), true).encoding,
            Some("utf-8")
        );
        // A character cut by the end of the head is still UTF-8.
        assert_eq!(
            detect("a", &"caf\u{e9}".as_bytes()[..4], false).encoding,
            Some("utf-8")
        );
        assert_eq!(
            detect("a", b"caf\xe9 au lait", true).encoding,
            Some("8-bit")
        );
        assert_eq!(detect("a", b"\x01\x02\x03\xe9", true).class, "binary");
        assert_eq!(detect("a", b"", true).class, "empty");
    }

    #[test]
    fn a_message_with_no_extension_is_found_from_its_headers() {
        let mail = b"Return-Path: <a@x.example>\r\nFrom: A <a@x.example>\r\nSubject: hi\r\nDate: Mon, 2 Nov 2026 08:14:09 +0000\r\n\r\nbody";
        assert_eq!(detect("message", mail, true).lang.as_deref(), Some("eml"));
        // Named, it is what its name says; and YAML that happens to have a `from` key is not mail.
        assert_eq!(detect("message.txt", mail, true).lang, None);
        assert_eq!(
            detect("config", b"name: x\nfrom: y\nversion: 1\n", true).lang,
            None
        );
    }

    #[test]
    fn a_text_pnm_header_under_a_pnm_name_is_the_picture() {
        let pbm = b"P1\n2 2\n0 1\n1 0\n";
        let got = detect("a.pbm", pbm, true);
        assert_eq!((got.class, got.format.as_deref()), ("binary", Some("pnm")));
        assert_eq!(detect("a.txt", pbm, true).class, "text");
    }
}
