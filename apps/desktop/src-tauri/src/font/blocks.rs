//! Unicode blocks a font's Font card counts its characters in, by the names the card says (a few shortened, as lab pass
//! 21's card has them: Latin-1, Punctuation, Currency). Unicode 15's blocks, the planes past the first in a few groups.

const BLOCKS: &[(u32, u32, &str)] = &[
    (0x0000, 0x007F, "Basic Latin"),
    (0x0080, 0x00FF, "Latin-1"),
    (0x0100, 0x017F, "Latin Extended-A"),
    (0x0180, 0x024F, "Latin Extended-B"),
    (0x0250, 0x02AF, "IPA Extensions"),
    (0x02B0, 0x02FF, "Spacing Modifiers"),
    (0x0300, 0x036F, "Combining Marks"),
    (0x0370, 0x03FF, "Greek"),
    (0x0400, 0x052F, "Cyrillic"),
    (0x0530, 0x058F, "Armenian"),
    (0x0590, 0x05FF, "Hebrew"),
    (0x0600, 0x06FF, "Arabic"),
    (0x0700, 0x074F, "Syriac"),
    (0x0750, 0x077F, "Arabic Supplement"),
    (0x0780, 0x07BF, "Thaana"),
    (0x07C0, 0x07FF, "NKo"),
    (0x0900, 0x097F, "Devanagari"),
    (0x0980, 0x09FF, "Bengali"),
    (0x0A00, 0x0A7F, "Gurmukhi"),
    (0x0A80, 0x0AFF, "Gujarati"),
    (0x0B00, 0x0B7F, "Oriya"),
    (0x0B80, 0x0BFF, "Tamil"),
    (0x0C00, 0x0C7F, "Telugu"),
    (0x0C80, 0x0CFF, "Kannada"),
    (0x0D00, 0x0D7F, "Malayalam"),
    (0x0D80, 0x0DFF, "Sinhala"),
    (0x0E00, 0x0E7F, "Thai"),
    (0x0E80, 0x0EFF, "Lao"),
    (0x0F00, 0x0FFF, "Tibetan"),
    (0x1000, 0x109F, "Myanmar"),
    (0x10A0, 0x10FF, "Georgian"),
    (0x1100, 0x11FF, "Hangul Jamo"),
    (0x1200, 0x139F, "Ethiopic"),
    (0x13A0, 0x13FF, "Cherokee"),
    (0x1400, 0x167F, "Canadian Syllabics"),
    (0x1680, 0x169F, "Ogham"),
    (0x16A0, 0x16FF, "Runic"),
    (0x1780, 0x17FF, "Khmer"),
    (0x1800, 0x18AF, "Mongolian"),
    (0x1AB0, 0x1AFF, "Combining Marks Extended"),
    (0x1D00, 0x1DBF, "Phonetic Extensions"),
    (0x1DC0, 0x1DFF, "Combining Marks Supplement"),
    (0x1E00, 0x1EFF, "Latin Extended Additional"),
    (0x1F00, 0x1FFF, "Greek Extended"),
    (0x2000, 0x206F, "Punctuation"),
    (0x2070, 0x209F, "Superscripts and Subscripts"),
    (0x20A0, 0x20CF, "Currency"),
    (0x20D0, 0x20FF, "Combining Marks for Symbols"),
    (0x2100, 0x214F, "Letterlike Symbols"),
    (0x2150, 0x218F, "Number Forms"),
    (0x2190, 0x21FF, "Arrows"),
    (0x2200, 0x22FF, "Mathematical Operators"),
    (0x2300, 0x23FF, "Miscellaneous Technical"),
    (0x2400, 0x243F, "Control Pictures"),
    (0x2460, 0x24FF, "Enclosed Alphanumerics"),
    (0x2500, 0x257F, "Box Drawing"),
    (0x2580, 0x259F, "Block Elements"),
    (0x25A0, 0x25FF, "Geometric Shapes"),
    (0x2600, 0x26FF, "Miscellaneous Symbols"),
    (0x2700, 0x27BF, "Dingbats"),
    (0x27C0, 0x27FF, "Mathematical Symbols"),
    (0x2800, 0x28FF, "Braille"),
    (0x2900, 0x2BFF, "Arrows and Symbols"),
    (0x2C00, 0x2C5F, "Glagolitic"),
    (0x2C60, 0x2C7F, "Latin Extended-C"),
    (0x2E00, 0x2E7F, "Supplemental Punctuation"),
    (0x2E80, 0x2FDF, "CJK Radicals"),
    (0x3000, 0x303F, "CJK Symbols and Punctuation"),
    (0x3040, 0x309F, "Hiragana"),
    (0x30A0, 0x30FF, "Katakana"),
    (0x3100, 0x312F, "Bopomofo"),
    (0x3130, 0x318F, "Hangul Compatibility Jamo"),
    (0x3200, 0x33FF, "CJK Enclosed and Compatibility"),
    (0x3400, 0x4DBF, "CJK Extension A"),
    (0x4DC0, 0x4DFF, "Yijing Hexagrams"),
    (0x4E00, 0x9FFF, "CJK Unified Ideographs"),
    (0xA000, 0xA4CF, "Yi"),
    (0xA640, 0xA69F, "Cyrillic Extended-B"),
    (0xA720, 0xA7FF, "Latin Extended-D"),
    (0xAB30, 0xAB6F, "Latin Extended-E"),
    (0xAC00, 0xD7AF, "Hangul Syllables"),
    (0xE000, 0xF8FF, "Private Use"),
    (0xF900, 0xFAFF, "CJK Compatibility Ideographs"),
    (0xFB00, 0xFB4F, "Alphabetic Presentation Forms"),
    (0xFB50, 0xFDFF, "Arabic Presentation Forms-A"),
    (0xFE00, 0xFE0F, "Variation Selectors"),
    (0xFE20, 0xFE2F, "Combining Half Marks"),
    (0xFE30, 0xFE4F, "CJK Compatibility Forms"),
    (0xFE50, 0xFE6F, "Small Form Variants"),
    (0xFE70, 0xFEFF, "Arabic Presentation Forms-B"),
    (0xFF00, 0xFFEF, "Halfwidth and Fullwidth Forms"),
    (0xFFF0, 0xFFFF, "Specials"),
    (0x10000, 0x1CFFF, "Historic scripts"),
    (0x1D000, 0x1D7FF, "Musical and Mathematical Symbols"),
    (0x1D800, 0x1EFFF, "Supplementary scripts"),
    (0x1F000, 0x1F0FF, "Game Symbols"),
    (0x1F100, 0x1F2FF, "Enclosed Supplements"),
    (0x1F300, 0x1FAFF, "Emoji and Pictographs"),
    (0x1FB00, 0x1FBFF, "Symbols for Legacy Computing"),
    (0x20000, 0x3FFFF, "CJK Extensions B and later"),
    (0xE0000, 0xE007F, "Tags"),
    (0xE0100, 0xE01EF, "Variation Selectors Supplement"),
    (0xF0000, 0x10FFFF, "Private Use Supplementary"),
];

/// The block `c` lies in, or None between blocks.
pub fn block_of(c: u32) -> Option<&'static str> {
    let i = BLOCKS.partition_point(|&(_, end, _)| end < c);
    BLOCKS
        .get(i)
        .filter(|&&(start, end, _)| (start..=end).contains(&c))
        .map(|&(_, _, n)| n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_are_ordered_and_found() {
        assert!(BLOCKS.windows(2).all(|w| w[0].1 < w[1].0));
        assert_eq!(block_of(0x41), Some("Basic Latin"));
        assert_eq!(block_of(0xA3), Some("Latin-1"));
        assert_eq!(block_of(0x2192), Some("Arrows"));
        assert_eq!(block_of(0x20AC), Some("Currency"));
        assert_eq!(block_of(0x1F600), Some("Emoji and Pictographs"));
        assert_eq!(block_of(0x0800), None);
    }
}
