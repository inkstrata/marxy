//! An ICC profile's description tag (`desc`): ICC v2's `textDescriptionType` or v4's `multiLocalizedUnicodeType`.

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn clean(s: String) -> Option<String> {
    let s = s
        .trim_matches(|c: char| c == '\0' || c.is_whitespace())
        .to_owned();
    (!s.is_empty()).then_some(s)
}

/// The profile's description, or None when it has none that can be read.
pub fn description(icc: &[u8]) -> Option<String> {
    if icc.get(36..40) != Some(b"acsp") {
        return None;
    }
    let count = be32(icc, 128)?.min(1024) as usize;
    let (offset, size) = (0..count).find_map(|i| {
        let at = 132 + i * 12;
        (icc.get(at..at + 4)? == b"desc").then(|| Some((be32(icc, at + 4)?, be32(icc, at + 8)?)))?
    })?;
    let tag = icc.get(offset as usize..(offset as usize).checked_add(size as usize)?)?;
    match tag.get(..4)? {
        b"desc" => {
            let len = be32(tag, 8)? as usize;
            let text = tag.get(12..12 + len)?;
            clean(String::from_utf8_lossy(text).into_owned())
        }
        b"mluc" => {
            let records = be32(tag, 8)? as usize;
            let record_size = be32(tag, 12)? as usize;
            if record_size < 12 {
                return None;
            }
            // English when there is one, else the first.
            let pick = (0..records.min(256))
                .find(|i| tag.get(16 + i * record_size..18 + i * record_size) == Some(b"en"))
                .unwrap_or(0);
            let at = 16 + pick * record_size;
            let (len, start) = (be32(tag, at + 4)? as usize, be32(tag, at + 8)? as usize);
            let units: Vec<u16> = tag
                .get(start..start.checked_add(len)?)?
                .as_chunks::<2>()
                .0
                .iter()
                .filter_map(|c| be16(c, 0))
                .collect();
            clean(String::from_utf16_lossy(&units))
        }
        _ => None,
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A minimal profile carrying only a `desc` tag of the given type.
    pub fn profile(v4: bool, name: &str) -> Vec<u8> {
        let tag = if v4 {
            let units: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
            let mut t = b"mluc\0\0\0\0".to_vec();
            t.extend_from_slice(&1u32.to_be_bytes());
            t.extend_from_slice(&12u32.to_be_bytes());
            t.extend_from_slice(b"enUS");
            t.extend_from_slice(&(units.len() as u32).to_be_bytes());
            t.extend_from_slice(&28u32.to_be_bytes());
            t.extend_from_slice(&units);
            t
        } else {
            let mut t = b"desc\0\0\0\0".to_vec();
            t.extend_from_slice(&(name.len() as u32 + 1).to_be_bytes());
            t.extend_from_slice(name.as_bytes());
            t.push(0);
            t.extend_from_slice(&[0; 79]);
            t
        };
        let mut p = vec![0u8; 128];
        p[36..40].copy_from_slice(b"acsp");
        p.extend_from_slice(&1u32.to_be_bytes());
        p.extend_from_slice(b"desc");
        p.extend_from_slice(&144u32.to_be_bytes());
        p.extend_from_slice(&(tag.len() as u32).to_be_bytes());
        p.extend_from_slice(&tag);
        let len = p.len() as u32;
        p[..4].copy_from_slice(&len.to_be_bytes());
        p
    }

    #[test]
    fn the_description_is_read_from_v2_and_v4_profiles() {
        assert_eq!(
            description(&profile(false, "sRGB built-in")).as_deref(),
            Some("sRGB built-in")
        );
        assert_eq!(
            description(&profile(true, "Display P3")).as_deref(),
            Some("Display P3")
        );
        assert_eq!(description(b"not a profile"), None);
    }
}
