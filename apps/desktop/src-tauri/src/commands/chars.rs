//! Every character's Unicode name, for What a character is. The table is compiled in by
//! `unicode_names2` (its build script makes it from the Unicode data it ships), so nothing is read or fetched; the page
//! asks only when it shows a character.

/// The name of the character at `code` as the page says it: lower case, a letter's own name and a code point kept as
/// written ("latin capital letter A", "cjk unified ideograph-4E00"). None for a code point with no name (a control
/// character, a private-use one, one not assigned) or no character at all.
#[tauri::command]
pub fn char_name(code: u32) -> Option<String> {
    let ch = char::from_u32(code)?;
    unicode_names2::name(ch).map(|name| said(&name.to_string()))
}

fn said(name: &str) -> String {
    let words: Vec<&str> = name.split(' ').collect();
    let last = words.len() - 1;
    words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            // A single letter at the end is the letter itself ("... LETTER A"); a code point in hex stays as written.
            if (i == last && w.chars().count() == 1)
                || w.contains(|c: char| c.is_ascii_digit()) && !w.contains('-')
            {
                (*w).to_string()
            } else if let Some((head, hex)) = w.rsplit_once('-').filter(|(_, hex)| {
                // A word such as FACE is hex too: a code point holds a digit.
                hex.len() >= 4
                    && hex.chars().all(|c| c.is_ascii_hexdigit())
                    && hex.contains(|c: char| c.is_ascii_digit())
            }) {
                format!("{}-{hex}", head.to_lowercase())
            } else {
                w.to_lowercase()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_said_in_lower_case_with_letters_and_code_points_as_written() {
        assert_eq!(char_name(0x2014).as_deref(), Some("em dash"));
        assert_eq!(char_name(0x41).as_deref(), Some("latin capital letter A"));
        assert_eq!(
            char_name(0x3b1).as_deref(),
            Some("greek small letter alpha")
        );
        assert_eq!(
            char_name(0x4e00).as_deref(),
            Some("cjk unified ideograph-4E00")
        );
        assert_eq!(char_name(0x1f600).as_deref(), Some("grinning face"));
        assert_eq!(
            char_name(0x0a),
            None,
            "a control character has no name of its own"
        );
        assert_eq!(char_name(0xd800), None, "a surrogate is no character");
    }
}
