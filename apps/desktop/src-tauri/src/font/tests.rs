use super::*;
use std::path::PathBuf;

pub fn demo(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/demo/fonts")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn a_truetype_font_says_its_names_units_and_coverage() {
    let f = facts(&demo("TidemarkSans-Regular.ttf")).unwrap();
    assert_eq!(
        (f.format, f.unpacked, f.why.as_deref()),
        ("truetype", None, None)
    );
    assert_eq!(f.faces.len(), 1);
    let face = &f.faces[0];
    assert_eq!(face.names.family.as_deref(), Some("Tidemark Sans"));
    assert_eq!(face.names.style.as_deref(), Some("Regular"));
    assert_eq!(face.names.full.as_deref(), Some("Tidemark Sans Regular"));
    assert_eq!(
        face.names.postscript.as_deref(),
        Some("TidemarkSans-Regular")
    );
    assert_eq!(
        face.names.sample.as_deref(),
        Some("The tide turns at the harbour mouth.")
    );
    assert!(face
        .names
        .licence
        .as_deref()
        .unwrap()
        .contains("SIL Open Font License"));
    assert_eq!(
        (face.outlines, face.units_per_em, face.glyphs),
        ("glyf", 1000, 94)
    );
    assert_eq!(
        (face.weight, face.width_class, face.embedding),
        (Some(400), Some(5), Some(0))
    );
    assert_eq!((face.cap_height, face.x_height), (Some(700), Some(500)));
    assert!(!face.fixed_pitch);
    assert!(face.axes.is_empty() && face.instances.is_empty());
    assert_eq!(face.chars, 93);
    assert_eq!(face.mapped.len(), 93);
    assert!(face.mapped.windows(2).all(|w| w[0] < w[1]));
    let blocks: Vec<(&str, u32)> = face.coverage.iter().map(|b| (b.name, b.count)).collect();
    assert_eq!(
        blocks,
        [
            ("Basic Latin", 83),
            ("Latin-1", 2),
            ("Punctuation", 6),
            ("Currency", 1),
            ("Arrows", 1)
        ]
    );
    for t in [
        "OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post",
    ] {
        assert!(face.tables.iter().any(|x| x == t), "{t}");
    }
}

#[test]
fn a_variable_font_says_its_axes_and_named_instances() {
    let f = facts(&demo("TidemarkSans[wdth,wght].ttf")).unwrap();
    let face = &f.faces[0];
    let axes: Vec<(&str, &str, f32, f32, f32)> = face
        .axes
        .iter()
        .map(|a| (a.tag.as_str(), a.name.as_str(), a.min, a.default, a.max))
        .collect();
    assert_eq!(
        axes,
        [
            ("wght", "Weight", 300.0, 400.0, 800.0),
            ("wdth", "Width", 75.0, 100.0, 100.0)
        ]
    );
    let named: Vec<&str> = face.instances.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(
        named,
        [
            "Light",
            "Regular",
            "Medium",
            "Bold",
            "ExtraBold",
            "Condensed",
            "Condensed Bold"
        ]
    );
    assert_eq!(face.instances[3].coords, [700.0, 100.0]);
    assert!(face.tables.iter().any(|t| t == "fvar") && face.tables.iter().any(|t| t == "gvar"));
}

#[test]
fn a_collection_reads_each_face() {
    let f = facts(&demo("Tidemark.ttc")).unwrap();
    assert_eq!(f.format, "collection");
    let full: Vec<&str> = f
        .faces
        .iter()
        .map(|x| x.names.full.as_deref().unwrap())
        .collect();
    assert_eq!(
        full,
        [
            "Tidemark Sans Regular",
            "Tidemark Sans Bold",
            "Tidemark Mono Regular"
        ]
    );
    assert!(f.faces[2].fixed_pitch);
    assert_eq!(f.faces[1].weight, Some(700));
}

#[test]
fn woff2_is_decoded_here_and_its_own_directory_listed() {
    let woff2 = facts(&demo("TidemarkSans[wdth,wght].woff2")).unwrap();
    let ttf = facts(&demo("TidemarkSans[wdth,wght].ttf")).unwrap();
    assert_eq!((woff2.format, woff2.why.as_deref()), ("woff2", None));
    assert!(woff2.unpacked.unwrap() > woff2.size);
    // The names and axes come from the WOFF2 itself, decoded, and agree with the TrueType it was made from.
    assert_eq!(woff2.faces[0].names, ttf.faces[0].names);
    assert_eq!(woff2.faces[0].axes, ttf.faces[0].axes);
    assert_eq!(woff2.faces[0].mapped, ttf.faces[0].mapped);
    let dir: Vec<&str> = woff2.directory.iter().map(|t| t.tag.as_str()).collect();
    assert!(
        dir.contains(&"glyf") && dir.contains(&"loca") && dir.contains(&"fvar"),
        "{dir:?}"
    );
    assert!(
        woff2.directory.iter().all(|t| !t.transformed),
        "glyf and loca are stored untransformed"
    );
}

#[test]
fn woff_is_inflated_and_cff_is_read() {
    let woff = facts(&demo("TidemarkSans-Regular.woff")).unwrap();
    assert_eq!((woff.format, woff.why.as_deref()), ("woff", None));
    assert!(woff.directory.iter().all(|t| t.packed.is_some()));
    assert_eq!(woff.faces[0].names.family.as_deref(), Some("Tidemark Sans"));
    let otf = facts(&demo("TidemarkSans-Bold.otf")).unwrap();
    assert_eq!((otf.format, otf.faces[0].outlines), ("cff", "CFF"));
    let g = glyph_in(&demo("TidemarkSans-Bold.otf"), 0, 'R' as u32)
        .unwrap()
        .unwrap();
    assert!(g.contours.unwrap() >= 1 && g.points.unwrap() > 0, "{g:?}");
}

#[test]
fn a_glyph_says_its_number_advance_and_outline() {
    let g = glyph_in(&demo("TidemarkSans[wdth,wght].ttf"), 0, 'R' as u32)
        .unwrap()
        .unwrap();
    assert!(g.glyph > 0);
    assert!(g.advance.unwrap() > 0);
    assert!(g.contours.unwrap() >= 1 && g.points.unwrap() > 0);
    assert!(g.bbox.is_some());
    let space = glyph_in(&demo("TidemarkSans-Regular.ttf"), 0, ' ' as u32)
        .unwrap()
        .unwrap();
    assert_eq!((space.contours, space.points), (Some(0), Some(0)));
    assert_eq!(
        glyph_in(&demo("TidemarkSans-Regular.ttf"), 0, 0x4e00).unwrap(),
        None
    );
    let mono = glyph_in(&demo("Tidemark.ttc"), 2, 'i' as u32)
        .unwrap()
        .unwrap();
    let sans = glyph_in(&demo("Tidemark.ttc"), 0, 'i' as u32)
        .unwrap()
        .unwrap();
    assert_ne!(
        mono.advance, sans.advance,
        "each face of a collection is its own"
    );
}

#[test]
fn what_is_not_a_font_is_none_and_a_broken_one_says_why() {
    assert_eq!(facts(b"hello"), None);
    let mut cut = demo("TidemarkSans-Regular.ttf");
    cut.truncate(64);
    let f = facts(&cut).unwrap();
    assert!(f.faces.is_empty() && f.why.is_some(), "{f:?}");
    let mut bad = b"wOF2".to_vec();
    bad.extend_from_slice(&[0; 60]);
    assert!(facts(&bad).unwrap().why.is_some());
}

/// A WOFF1 header and directory only (tag, offset, packed, orig per table); no table bodies.
fn woff1_directory(tables: &[(u32, u32)]) -> Vec<u8> {
    let mut b = b"wOFF".to_vec();
    b.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    let total = 44 + 20 * tables.len() as u32;
    b.extend_from_slice(&total.to_be_bytes());
    b.extend_from_slice(&(tables.len() as u16).to_be_bytes());
    b.extend_from_slice(&[0, 0]);
    b.extend_from_slice(&[0; 28]);
    for &(packed, orig) in tables {
        b.extend_from_slice(b"glyf");
        b.extend_from_slice(&total.to_be_bytes());
        b.extend_from_slice(&packed.to_be_bytes());
        b.extend_from_slice(&orig.to_be_bytes());
        b.extend_from_slice(&[0; 4]);
    }
    b
}

#[test]
fn a_woff1_claiming_gigabytes_is_refused_before_anything_is_inflated() {
    for tables in [
        vec![(8, 0xF000_0000)],
        vec![(60_000_000, 100_000_000), (60_000_000, 100_000_000)],
        vec![(1_000_000, 200_000_000)],
    ] {
        let why = unwrap(&woff1_directory(&tables)).unwrap_err().to_string();
        assert!(why.contains("inflates past"), "{tables:?}: {why}");
    }
}
