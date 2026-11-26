//! An `ar` archive by hand, and the Debian package that is one: `debian-binary`, then `control.tar.*` and `data.tar.*`.
//! The members are listed as they lie; the files of a package's control and data tars are listed under `control/` and
//! `data/`, unpacked from the member's bytes through the tar reader and its bounds. Nothing is unpacked to disk and no
//! maintainer script is run.

use std::fs::File;
use std::io::Read;

use super::{
    bytes_at, changed, commas, comp_of, folder, head_of, iso_from_unix, looks_like_tar, read_up_to,
    sanitise, tar, too_big_declared, unpacked, ArchiveEntry, ArchiveListing, Comp, Fault, Format,
    Head, Limits, Span, Want,
};

const MAGIC: &[u8; 8] = b"!<arch>\n";
const HEADER: u64 = 60;

/// `Some(true)` for a Debian package (its first member is `debian-binary`), `Some(false)` for another `ar`.
pub fn is_ar(head: &[u8]) -> Option<bool> {
    head.starts_with(MAGIC).then(|| {
        head.get(8..24)
            .is_some_and(|n| n.starts_with(b"debian-binary"))
    })
}

/// Where an ordinal of the listing comes from.
#[derive(Debug)]
pub struct Part {
    base: u32,
    end: u32,
    what: What,
}

#[derive(Debug)]
enum What {
    Member {
        path: String,
        span: Span,
    },
    Tar {
        prefix: &'static str,
        inner: tar::Inner,
    },
}

struct Member {
    /// Its listed path; `None` when nothing is left of its name once sanitised (the GNU symbol and name tables).
    path: Option<String>,
    raw: String,
    span: Span,
    mtime: Option<String>,
    mode: Option<u32>,
}

fn field(b: &[u8]) -> &str {
    std::str::from_utf8(b).unwrap_or("").trim_end_matches(' ')
}

/// The members in order, at most `limits.entries` of them, and the sentence when the walk stopped before the end.
fn members(
    file: &File,
    size: u64,
    limits: &Limits,
) -> Result<(Vec<Member>, Option<String>), Fault> {
    let mut out = Vec::new();
    let mut at = MAGIC.len() as u64;
    let stop = |out: &Vec<Member>, why: &str| {
        Some(format!(
            "The listing stopped at a damaged part after {} members: {why}.",
            commas(out.len() as u64)
        ))
    };
    loop {
        if at.checked_add(HEADER).is_none_or(|e| e > size) {
            // A lone padding byte may close the archive.
            return Ok((
                out,
                (size > at + 1).then(|| {
                    "The listing stopped at a damaged part: the file ends inside a header.".into()
                }),
            ));
        }
        if out.len() >= limits.entries {
            let why = format!(
                "Listed the first {} members; more follow.",
                commas(out.len() as u64)
            );
            return Ok((out, Some(why)));
        }
        let Some(h) = bytes_at(file, size, at, HEADER as usize) else {
            return Ok((out, stop(&Vec::new(), "the file ended early")));
        };
        if &h[58..60] != b"`\n" {
            if out.is_empty() {
                return Err(Fault::Invalid(
                    "The listing could not be read: the first member's header is damaged.".into(),
                ));
            }
            let why = stop(&out, "a member's header is damaged");
            return Ok((out, why));
        }
        let Ok(len) = field(&h[48..58]).parse::<u64>() else {
            let why = stop(&out, "a member's size is not a number");
            return Ok((out, why));
        };
        let data = at + HEADER;
        if data.checked_add(len).is_none_or(|e| e > size) {
            let why = stop(&out, "a member runs past the end of the file");
            return Ok((out, why));
        }
        let name = field(&h[..16]);
        let (raw, span) = if let Some(n) = name.strip_prefix("#1/") {
            // BSD: the name is the first `n` bytes of the data.
            let n = n
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|&n| n <= len && n <= limits.name_bytes as u64);
            let Some(n) = n else {
                let why = stop(&out, "a member's long name is damaged");
                return Ok((out, why));
            };
            let bytes = bytes_at(file, size, data, n as usize).unwrap_or_default();
            let raw = String::from_utf8_lossy(bytes.split(|&b| b == 0).next().unwrap_or(&[]))
                .into_owned();
            (
                raw,
                Span {
                    start: data + n,
                    len: len - n,
                },
            )
        } else {
            // GNU ends a name with a slash; `/` and `//` are its symbol and name tables.
            let raw = if name == "/" || name == "//" {
                name
            } else {
                name.trim_end_matches('/')
            };
            (raw.to_owned(), Span { start: data, len })
        };
        let path = if raw.starts_with('/') {
            None
        } else {
            sanitise(&raw, false).map(|c| c.path)
        };
        out.push(Member {
            path,
            raw,
            span,
            mtime: field(&h[16..28])
                .parse::<i64>()
                .ok()
                .filter(|&m| m > 0)
                .and_then(|m| iso_from_unix(m, true)),
            mode: u32::from_str_radix(field(&h[40..48]), 8).ok(),
        });
        at = data + len + (len & 1);
    }
}

/// How a package's tar is packed, by its first bytes; `None` when it is not a tar the app unpacks.
fn inner_of(file: &File, span: Span) -> Option<tar::Inner> {
    let mut head = [0u8; 512];
    let r = unpacked(file, None, span).ok()?;
    let n = read_up_to(r, &mut head).ok()?;
    let comp: Option<Comp> = comp_of(&head[..n]);
    if comp.is_none() && !looks_like_tar(&head[..n]) {
        return None;
    }
    Some(tar::Inner { comp, span })
}

/// The listing, and where each ordinal of it comes from.
pub fn list(
    file: &File,
    size: u64,
    deb: bool,
    limits: &Limits,
) -> Result<(ArchiveListing, Vec<Part>), Fault> {
    let (members, mut truncated) = members(file, size, limits)?;
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut parts: Vec<Part> = Vec::new();
    let mut skipped = 0u32;
    let mut notes: Vec<String> = Vec::new();
    let mut listed = 0usize;
    for (i, m) in members.iter().enumerate() {
        let index = i as u32;
        let Some(path) = &m.path else {
            skipped += 1;
            continue;
        };
        let mut e = ArchiveEntry::bare(index, path.clone(), "file");
        e.size = Some(m.span.len);
        e.mtime = m.mtime.clone();
        e.mode = m.mode;
        e.offset = Some(m.span.start);
        listed += path.len();
        entries.push(e);
        parts.push(Part {
            base: index,
            end: index + 1,
            what: What::Member {
                path: path.clone(),
                span: m.span,
            },
        });
    }
    let mut next = members.len() as u32;
    // A package has one control tar and one data tar: only the first of each is unpacked, and every unpacking in the
    // listing draws on one stream budget, so a crafted package of many tars cannot unpack each to the cap.
    let mut stream_left = limits.stream;
    let mut seen: Vec<&str> = Vec::new();
    let mut extra = 0u64;
    if deb {
        for m in &members {
            let prefix = if m.raw.starts_with("control.tar") {
                "control"
            } else if m.raw.starts_with("data.tar") {
                "data"
            } else {
                continue;
            };
            if seen.contains(&prefix) {
                extra += 1;
                continue;
            }
            seen.push(prefix);
            if stream_left == 0 {
                notes.push(format!(
                    "The files in {} are not listed: the package's tars already unpacked to the 1 GB the app walks.",
                    m.raw
                ));
                continue;
            }
            let Some(inner) = inner_of(file, m.span) else {
                notes.push(format!(
                    "{} is packed in a way the app does not unpack, so its files are not listed.",
                    m.raw
                ));
                continue;
            };
            let room = Limits {
                entries: limits.entries.saturating_sub(entries.len()),
                listed_bytes: limits.listed_bytes.saturating_sub(listed),
                depth: limits.depth.saturating_sub(1),
                stream: stream_left,
                ..limits.clone()
            };
            if room.entries == 0 {
                truncated.get_or_insert_with(|| {
                    format!(
                        "Listed the first {} entries; more follow.",
                        commas(entries.len() as u64)
                    )
                });
                break;
            }
            match tar::list_inner(file, inner, &room) {
                Ok((l, ordinals, used)) => {
                    stream_left = stream_left.saturating_sub(used);
                    for mut e in l.entries {
                        e.index += next;
                        e.path = format!("{prefix}/{}", e.path);
                        listed += e.path.len();
                        entries.push(e);
                    }
                    skipped += l.skipped;
                    if let Some(t) = l.truncated {
                        truncated.get_or_insert(format!("In {}: {t}", m.raw));
                    }
                    parts.push(Part {
                        base: next,
                        end: next.saturating_add(ordinals),
                        what: What::Tar { prefix, inner },
                    });
                    next = next.saturating_add(ordinals);
                }
                Err(Fault::Io(e)) => return Err(Fault::Io(e)),
                Err(Fault::Invalid(w) | Fault::Refused(w) | Fault::Unsupported(w)) => {
                    notes.push(format!("The files in {} are not listed. {w}", m.raw));
                }
            }
        }
    }
    if extra > 0 {
        notes.push(format!(
            "{} more control or data {} after the first of each: listed as members, their files not listed.",
            commas(extra),
            if extra == 1 { "tar follows" } else { "tars follow" }
        ));
    }
    let listing = ArchiveListing {
        format: Format::Ar(deb).name().into(),
        entries,
        comment: None,
        truncated,
        skipped,
        declared: None,
        size,
        unpacked: None,
        directory: None,
        note: (!notes.is_empty()).then(|| notes.join(" ")),
    };
    Ok((listing, parts))
}

fn part_of(parts: &[Part], index: u32) -> Result<&Part, Fault> {
    parts
        .iter()
        .find(|p| (p.base..p.end).contains(&index))
        .ok_or_else(changed)
}

/// The name inside the tar of a listed `control/…` or `data/…` path.
fn inner_name<'a>(prefix: &str, name: &'a str) -> Result<&'a str, Fault> {
    name.strip_prefix(prefix)
        .and_then(|r| r.strip_prefix('/'))
        .ok_or_else(changed)
}

fn member_bytes(
    file: &File,
    path: &str,
    span: Span,
    name: &str,
    cap: u64,
) -> Result<(Vec<u8>, bool), Fault> {
    if path != name {
        return Err(changed());
    }
    Ok(head_of(
        Read::take(unpacked(file, None, span)?, span.len),
        cap,
    )?)
}

pub fn read(
    file: &File,
    parts: &[Part],
    index: u32,
    name: &str,
    limits: &Limits,
) -> Result<Vec<u8>, Fault> {
    let part = part_of(parts, index)?;
    match &part.what {
        What::Member { path, span } => {
            if path != name {
                return Err(changed());
            }
            if span.len > limits.entry {
                return Err(too_big_declared(name, span.len));
            }
            Ok(member_bytes(file, path, *span, name, limits.entry)?.0)
        }
        What::Tar { prefix, inner } => {
            if name.ends_with('/') {
                return Err(folder());
            }
            tar::read_inner(
                file,
                *inner,
                index - part.base,
                inner_name(prefix, name)?,
                limits,
            )
        }
    }
}

/// The heads of `wants`: a member's from its bytes, a package tar's from one walk of that tar for all of its wants.
pub fn heads(
    file: &File,
    parts: &[Part],
    wants: &[Want],
    max_each: u64,
    limits: &Limits,
) -> Result<Vec<Head>, Fault> {
    let mut out: Vec<Option<Head>> = vec![None; wants.len()];
    let mut by_tar: Vec<(usize, Vec<(usize, Want)>)> = Vec::new();
    for (i, w) in wants.iter().enumerate() {
        let Ok(p) = part_of(parts, w.index) else {
            out[i] = Some(Head::of(w.index, Err(changed()))?);
            continue;
        };
        match &p.what {
            What::Member { path, span } => {
                out[i] = Some(Head::of(
                    w.index,
                    member_bytes(file, path, *span, &w.name, max_each),
                )?);
            }
            What::Tar { prefix, .. } => match inner_name(prefix, &w.name) {
                Err(f) => out[i] = Some(Head::of(w.index, Err(f))?),
                Ok(n) => {
                    let at = parts.iter().position(|q| std::ptr::eq(q, p)).unwrap_or(0);
                    let local = Want {
                        index: w.index - p.base,
                        name: n.to_owned(),
                    };
                    match by_tar.iter_mut().find(|(k, _)| *k == at) {
                        Some((_, list)) => list.push((i, local)),
                        None => by_tar.push((at, vec![(i, local)])),
                    }
                }
            },
        }
    }
    for (at, list) in by_tar {
        let part = &parts[at];
        let What::Tar { inner, .. } = &part.what else {
            continue;
        };
        let local: Vec<Want> = list.iter().map(|(_, w)| w.clone()).collect();
        let got = tar::heads_inner(file, *inner, &local, max_each, limits)?;
        for ((i, _), mut h) in list.into_iter().zip(got) {
            h.index += part.base;
            out[i] = Some(h);
        }
    }
    Ok(out.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::testkit::{self, T};
    use crate::archive::{heads as all_heads, list as list_any, read as read_any};

    /// An `ar` of `members`, each `(name, bytes)`, padded to even lengths.
    pub fn ar(members: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = MAGIC.to_vec();
        for (name, data) in members {
            let h = format!(
                "{:<16}{:<12}{:<6}{:<6}{:<8}{:<10}`\n",
                format!("{name}/"),
                1_700_000_000,
                0,
                0,
                "100644",
                data.len()
            );
            assert_eq!(h.len(), 60);
            out.extend(h.as_bytes());
            out.extend(*data);
            if data.len() % 2 == 1 {
                out.push(b'\n');
            }
        }
        out
    }

    fn zst(bytes: &[u8]) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(bytes, ruzstd::encoding::CompressionLevel::Fastest)
    }

    pub fn deb(data: Vec<u8>) -> Vec<u8> {
        let control = testkit::tar(&[
            (b"./control", T::File, b"Package: hello\nVersion: 1.0\n"),
            (b"./postinst", T::File, b"#!/bin/sh\necho never run\n"),
        ]);
        ar(&[
            ("debian-binary", b"2.0\n"),
            ("control.tar.gz", &testkit::gzip(&control)),
            ("data.tar.zst", &data),
        ])
    }

    fn sample_data() -> Vec<u8> {
        testkit::tar(&[
            (b"./usr/", T::Dir, b""),
            (b"./usr/bin/hello", T::File, b"hello, world\n"),
            (
                b"./usr/share/doc/hello/copyright",
                T::File,
                b"public domain\n",
            ),
        ])
    }

    fn temp(name: &str, bytes: &[u8]) -> (std::path::PathBuf, File) {
        let dir = std::env::temp_dir().join(format!("marxy-ar-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, File::open(&path).unwrap())
    }

    #[test]
    fn a_deb_lists_its_members_and_the_files_of_its_control_and_data_tars() {
        let (dir, file) = temp("hello.deb", &deb(zst(&sample_data())));
        let l = list_any(&file, "hello.deb", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(l.format, "deb");
        let paths: Vec<(u32, &str)> = l
            .entries
            .iter()
            .map(|e| (e.index, e.path.as_str()))
            .collect();
        assert_eq!(
            paths,
            [
                (0, "debian-binary"),
                (1, "control.tar.gz"),
                (2, "data.tar.zst"),
                (3, "control/control"),
                (4, "control/postinst"),
                (5, "data/usr/"),
                (6, "data/usr/bin/hello"),
                (7, "data/usr/share/doc/hello/copyright"),
            ]
        );
        assert_eq!(l.entries[0].size, Some(4));
        assert_eq!(l.entries[0].mtime.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(l.note, None);
        assert_eq!(
            read_any(
                &file,
                "hello.deb",
                0,
                "debian-binary",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"2.0\n"
        );
        assert_eq!(
            read_any(
                &file,
                "hello.deb",
                6,
                "data/usr/bin/hello",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"hello, world\n"
        );
        assert_eq!(
            read_any(
                &file,
                "hello.deb",
                3,
                "control/control",
                &Limits::DEFAULT,
                None
            )
            .unwrap(),
            b"Package: hello\nVersion: 1.0\n"
        );
        assert!(
            matches!(read_any(&file, "hello.deb", 6, "data/usr/bin/other", &Limits::DEFAULT, None), Err(Fault::Invalid(m)) if m == "The archive changed since it was listed.")
        );
        let wants: Vec<Want> = l
            .entries
            .iter()
            .map(|e| Want {
                index: e.index,
                name: e.path.clone(),
            })
            .collect();
        let got = all_heads(&file, "hello.deb", &wants, 5, &Limits::DEFAULT, None).unwrap();
        assert_eq!(
            got.iter().map(|h| h.index).collect::<Vec<_>>(),
            (0..8).collect::<Vec<u32>>()
        );
        assert_eq!(got[6].bytes, b"hello");
        assert_eq!(
            got[5].refused.as_deref(),
            Some("A folder has nothing to open.")
        );
        assert_eq!(got[0].bytes, b"2.0\n");
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_data_tar_packed_another_way_is_said_plainly_and_its_member_still_listed() {
        let mut lzma = vec![0x5d, 0, 0, 0x80, 0];
        lzma.extend([0xffu8; 40]);
        let (dir, file) = temp("odd.deb", &deb(lzma));
        let l = list_any(&file, "odd.deb", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert_eq!(
            l.entries
                .iter()
                .filter(|e| e.path.starts_with("data/"))
                .count(),
            0
        );
        assert!(l.entries.iter().any(|e| e.path == "data.tar.zst"));
        assert_eq!(l.note.as_deref(), Some("data.tar.zst is packed in a way the app does not unpack, so its files are not listed."));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_truncated_or_lying_ar_lists_what_came_first() {
        let whole = deb(zst(&sample_data()));
        for cut in [12, 30, 70, 80, 150, whole.len() - 3] {
            let (dir, file) = temp(&format!("cut{cut}.deb"), &whole[..cut]);
            let got = list_any(&file, "cut.deb", &Limits::DEFAULT, None);
            if let Ok(Some(l)) = got {
                assert!(l.truncated.is_some() || l.note.is_some(), "cut at {cut}");
            }
            drop(file);
            let _ = std::fs::remove_dir_all(dir);
        }
        // A member that declares more bytes than the file holds.
        let mut lying = ar(&[("debian-binary", b"2.0\n")]);
        lying[8 + 48..8 + 58].copy_from_slice(b"9999999999");
        let (dir, file) = temp("lying.deb", &lying);
        let l = list_any(&file, "lying.deb", &Limits::DEFAULT, None)
            .unwrap()
            .unwrap();
        assert!(l.entries.is_empty());
        assert!(l.truncated.unwrap().contains("runs past the end"));
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_zstandard_bomb_in_the_data_tar_stops_at_the_stream_cap() {
        let zeros = vec![0u8; 3 * 1024 * 1024];
        let data = testkit::tar(&[
            (b"./a", T::File, b"first"),
            (b"./big", T::File, &zeros),
            (b"./after", T::File, b"never reached"),
        ]);
        let (dir, file) = temp("bomb.deb", &deb(zst(&data)));
        let tight = Limits {
            stream: 1024 * 1024,
            entry: 1024 * 1024,
            ..Limits::DEFAULT
        };
        let started = std::time::Instant::now();
        let l = list_any(&file, "bomb.deb", &tight, None).unwrap().unwrap();
        assert!(
            l.truncated
                .as_deref()
                .unwrap()
                .starts_with("In data.tar.zst: Listed the first"),
            "{:?}",
            l.truncated
        );
        assert!(!l.entries.iter().any(|e| e.path == "data/after"));
        let big = l.entries.iter().find(|e| e.path == "data/big").unwrap();
        assert!(read_any(&file, "bomb.deb", big.index, "data/big", &tight, None).is_err());
        assert!(started.elapsed().as_secs() < 10);
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn many_data_tars_unpack_only_the_first_and_share_one_stream_budget() {
        let zeros = vec![0u8; 8 * 1024 * 1024];
        let packed = testkit::gzip(&testkit::tar(&[(b"./fill", T::File, &zeros)]));
        let mut members: Vec<(&str, &[u8])> = vec![("debian-binary", b"2.0\n")];
        for _ in 0..50 {
            members.push(("data.tar.gz", &packed));
        }
        let (dir, file) = temp("many.deb", &ar(&members));
        let tight = Limits {
            stream: 4 * 1024 * 1024,
            ..Limits::DEFAULT
        };
        let walks = tar::WALKS.with(|w| w.get());
        let started = std::time::Instant::now();
        let l = list_any(&file, "many.deb", &tight, None).unwrap().unwrap();
        assert_eq!(
            tar::WALKS.with(|w| w.get()) - walks,
            1,
            "one tar unpacked, not fifty"
        );
        assert!(started.elapsed().as_secs() < 10);
        assert_eq!(
            l.entries
                .iter()
                .filter(|e| e.path.starts_with("data/"))
                .count(),
            1
        );
        assert_eq!(l.entries.len(), 52, "every member is still listed");
        assert_eq!(
            l.note.as_deref(),
            Some("49 more control or data tars follow after the first of each: listed as members, their files not listed.")
        );
        drop(file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
