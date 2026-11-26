//! The SummaryInformation property set (MS-OLEPS): title, subject, author, who saved it last, when, the application and
//! the page count, as the About card lists them. A value this cannot read is left out; nothing here fails the read.

use super::{u16_at, u32_at, Props};

const TITLE: u32 = 2;
const SUBJECT: u32 = 3;
const AUTHOR: u32 = 4;
const LAST_AUTHOR: u32 = 8;
const CREATED: u32 = 12;
const SAVED: u32 = 13;
const PAGES: u32 = 14;
const APP: u32 = 18;
const CODE_PAGE: u32 = 1;

const VT_I2: u16 = 2;
const VT_I4: u16 = 3;
const VT_LPSTR: u16 = 0x1E;
const VT_LPWSTR: u16 = 0x1F;
const VT_FILETIME: u16 = 0x40;

/// A string value's longest: a title or a name, not a document.
const LONGEST: usize = 4096;
const PROPERTIES: usize = 1024;

pub fn read(b: &[u8]) -> Props {
    let mut p = Props::default();
    if u16_at(b, 0) != Some(0xFFFE) {
        return p;
    }
    let Some(base) = u32_at(b, 44).map(|v| v as usize) else {
        return p;
    };
    let Some(count) = u32_at(b, base + 4) else {
        return p;
    };
    let entries: Vec<(u32, usize)> = (0..(count as usize).min(PROPERTIES))
        .map_while(|i| {
            Some((
                u32_at(b, base + 8 + 8 * i)?,
                base + u32_at(b, base + 12 + 8 * i)? as usize,
            ))
        })
        .collect();
    let cp = entries
        .iter()
        .find(|e| e.0 == CODE_PAGE)
        .and_then(|&(_, at)| (u16_at(b, at)? == VT_I2).then(|| u16_at(b, at + 4))?)
        .map(u32::from)
        .unwrap_or(1252);
    let enc = crate::encoding::of_code_page(cp).unwrap_or(encoding_rs::WINDOWS_1252);
    for &(id, at) in &entries {
        let Some(ty) = u16_at(b, at) else { continue };
        let text = || -> Option<String> {
            let n = u32_at(b, at + 4)? as usize;
            let s = match ty {
                VT_LPSTR if cp == 1200 => utf16(b.get(at + 8..at + 8 + n.min(LONGEST))?),
                VT_LPSTR => {
                    let raw = b.get(at + 8..at + 8 + n.min(LONGEST))?;
                    let end = raw.iter().position(|&x| x == 0).unwrap_or(raw.len());
                    enc.decode_without_bom_handling(&raw[..end]).0.into_owned()
                }
                VT_LPWSTR => utf16(b.get(at + 8..at + 8 + 2 * n.min(LONGEST))?),
                _ => return None,
            };
            let s = s.trim().to_string();
            (!s.is_empty()).then_some(s)
        };
        match id {
            TITLE => p.title = text(),
            SUBJECT => p.subject = text(),
            AUTHOR => p.creator = text(),
            LAST_AUTHOR => p.last_modified_by = text(),
            APP => p.application = text(),
            CREATED | SAVED if ty == VT_FILETIME => {
                let lo = u32_at(b, at + 4);
                let hi = u32_at(b, at + 8);
                let when = lo
                    .zip(hi)
                    .and_then(|(lo, hi)| iso(((hi as u64) << 32) | lo as u64));
                if id == CREATED {
                    p.created = when;
                } else {
                    p.modified = when;
                }
            }
            PAGES if ty == VT_I4 => p.pages = u32_at(b, at + 4).filter(|&n| n > 0 && n < 1_000_000),
            _ => {}
        }
    }
    p
}

fn utf16(b: &[u8]) -> String {
    let units = b
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .take_while(|&u| u != 0);
    char::decode_utf16(units)
        .map(|c| c.unwrap_or('\u{FFFD}'))
        .collect()
}

/// A FILETIME (100 ns since 1601) as an ISO time in UTC, as an OOXML file writes its dates; none for a zero or absurd one.
fn iso(ft: u64) -> Option<String> {
    const TO_UNIX: u64 = 11_644_473_600;
    let secs = (ft / 10_000_000).checked_sub(TO_UNIX)?;
    let days = (secs / 86_400) as i64;
    if days > 200_000 {
        return None;
    }
    let rem = secs % 86_400;
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    Some(format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    ))
}

#[cfg(test)]
pub fn filetime_of(unix: u64) -> u64 {
    (unix + 11_644_473_600) * 10_000_000
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_filetime_is_an_iso_time() {
        assert_eq!(
            super::iso(super::filetime_of(1_760_000_000)).as_deref(),
            Some("2025-10-09T08:53:20Z")
        );
        assert_eq!(super::iso(0), None);
    }
}
