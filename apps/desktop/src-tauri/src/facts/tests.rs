use std::io::Cursor;
use std::path::PathBuf;

use image::{DynamicImage, ImageFormat};

use super::*;
use crate::decode::raw::tests::dng;
use crate::decode::tiff::build::{write, Value};
use crate::file_scheme::Decoder;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/images")
        .join(name)
}

fn facts_of(path: &Path) -> Option<ImageFacts> {
    read(path, File::open(path).unwrap()).unwrap()
}

fn facts(name: &str) -> ImageFacts {
    facts_of(&fixture(name)).unwrap_or_else(|| panic!("{name} has facts"))
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("marxy-facts-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }
    fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.0.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn encoded(format: ImageFormat, img: DynamicImage) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, format).unwrap();
    out.into_inner()
}

/// The decoded formats' `show` on this system.
fn decoded_here(format: &str) -> &'static str {
    if cfg!(target_os = "macos") && format == "tiff" {
        "webview"
    } else {
        "decoded"
    }
}

#[test]
fn a_rotated_jpeg_gives_its_stored_size_orientation_exif_location_and_profile() {
    let f = facts("rotated.jpg");
    assert_eq!(
        (f.format, f.width, f.height, f.orientation),
        ("jpeg", 8, 4, 6)
    );
    assert_eq!((f.bit_depth, f.channels), (Some(8), Some("RGB")));
    assert_eq!(f.color_profile.as_deref(), Some("sRGB built-in"));
    assert_eq!((f.frames, f.show, f.why.as_deref()), (1, "webview", None));
    assert_eq!(
        f.exif,
        Some(Exif {
            camera: Some("Marxy Test Camera".into()),
            lens: Some("Fixture 35mm F2".into()),
            exposure: Some("1/250 s".into()),
            aperture: Some("f/2.8".into()),
            iso: Some(400),
            focal_length: Some("35 mm".into()),
            taken: Some("2024-05-01 12:34:56".into()),
            software: Some("fixture-maker 1.0".into()),
        })
    );
    let at = f.location.unwrap();
    assert!(
        (at.lat - (51.0 + 30.0 / 60.0 + 2.0 / 3600.0)).abs() < 1e-9,
        "{at:?}"
    );
    assert!(
        (at.lon + (7.0 / 60.0 + 30.0 / 3600.0)).abs() < 1e-9,
        "{at:?}"
    );
    // The page's contract, in camelCase, with null where a fact is absent.
    let json = serde_json::to_value(&f).unwrap();
    assert_eq!(json["bitDepth"], 8);
    assert_eq!(json["colorProfile"], "sRGB built-in");
    assert_eq!(json["exif"]["focalLength"], "35 mm");
    assert_eq!(json["why"], serde_json::Value::Null);
    assert!(json["location"]["lon"].as_f64().unwrap() < 0.0);
}

#[test]
fn the_webviews_formats_give_their_facts() {
    let png = facts("icc.png");
    assert_eq!((png.format, png.width, png.height), ("png", 4, 3));
    assert_eq!((png.bit_depth, png.channels), (Some(8), Some("RGB")));
    assert_eq!(png.color_profile.as_deref(), Some("sRGB built-in"));
    assert_eq!((png.frames, png.show, png.orientation), (1, "webview", 1));
    assert_eq!(png.exif, None);

    let apng = facts("animated.png");
    assert_eq!((apng.frames, apng.channels), (3, Some("RGBA")));

    let gif = facts("animated.gif");
    assert_eq!(
        (gif.format, gif.width, gif.height, gif.frames),
        ("gif", 5, 4, 3)
    );
    assert_eq!(gif.channels, Some("Indexed"));

    let webp = facts("animated.webp");
    assert_eq!(
        (webp.format, webp.width, webp.height, webp.frames),
        ("webp", 5, 4, 3)
    );
    assert_eq!(webp.channels, Some("RGBA"));
    let still = facts("still.webp");
    assert_eq!(
        (still.width, still.height, still.frames, still.channels),
        (6, 2, 1, Some("RGB"))
    );

    let avif = facts("tiny.avif");
    assert_eq!((avif.format, avif.width, avif.height), ("avif", 6, 4));
    // Fully opaque, so the encoder kept no alpha plane.
    assert_eq!(
        (avif.bit_depth, avif.channels, avif.show),
        (Some(8), Some("RGB"), "webview")
    );

    let bmp = facts("tiny.bmp");
    assert_eq!(
        (bmp.format, bmp.width, bmp.height, bmp.channels),
        ("bmp", 3, 2, Some("RGB"))
    );

    let ico = facts("tiny.ico");
    assert_eq!(
        (ico.format, ico.width, ico.height, ico.channels),
        ("ico", 32, 32, Some("RGBA"))
    );
}

#[test]
fn the_decoded_formats_give_their_facts() {
    let tiff = facts("tiny.tiff");
    assert_eq!((tiff.format, tiff.width, tiff.height), ("tiff", 6, 4));
    assert_eq!((tiff.bit_depth, tiff.channels), (Some(8), Some("RGB")));
    assert_eq!(tiff.color_profile.as_deref(), Some("sRGB built-in"));
    assert_eq!(tiff.show, decoded_here("tiff"));

    let tga = facts("tiny.tga");
    assert_eq!(
        (tga.format, tga.width, tga.height, tga.channels),
        ("tga", 4, 2, Some("RGBA"))
    );
    assert_eq!(tga.show, "decoded");

    let jxl = facts("tiny.jxl");
    assert_eq!((jxl.format, jxl.width, jxl.height), ("jxl", 6, 4));
    assert_eq!(
        (jxl.bit_depth, jxl.channels, jxl.show),
        (Some(8), Some("RGBA"), "decoded")
    );

    let s = Scratch::new("decoded");
    let rgba = DynamicImage::ImageRgba8(image::RgbaImage::new(7, 3));
    let qoi = facts_of(&s.write("a.qoi", &encoded(ImageFormat::Qoi, rgba))).unwrap();
    assert_eq!(
        (qoi.format, qoi.width, qoi.height, qoi.channels),
        ("qoi", 7, 3, Some("RGBA"))
    );
    let float = DynamicImage::ImageRgb32F(image::Rgb32FImage::new(5, 2));
    let exr = facts_of(&s.write("a.exr", &encoded(ImageFormat::OpenExr, float.clone()))).unwrap();
    assert_eq!((exr.format, exr.width, exr.height), ("exr", 5, 2));
    assert_eq!(
        (exr.bit_depth, exr.channels, exr.show),
        (Some(32), Some("RGB"), "decoded")
    );
    let hdr = facts_of(&s.write("a.hdr", &encoded(ImageFormat::Hdr, float))).unwrap();
    assert_eq!(
        (hdr.format, hdr.width, hdr.height, hdr.channels),
        ("hdr", 5, 2, Some("RGB"))
    );
}

#[test]
fn a_header_past_the_pixel_budget_is_not_shown_and_says_why() {
    let s = Scratch::new("budget");
    let mut qoi = b"qoif".to_vec();
    qoi.extend_from_slice(&100_000u32.to_be_bytes());
    qoi.extend_from_slice(&100_000u32.to_be_bytes());
    qoi.extend_from_slice(&[3, 0]);
    let f = facts_of(&s.write("big.qoi", &qoi)).unwrap();
    assert_eq!((f.width, f.height, f.show), (100_000, 100_000, "none"));
    assert_eq!(
        f.why.as_deref(),
        Some("This image is 100000 by 100000 pixels, more than the 67 megapixels Marxy decodes.")
    );
}

fn camera_exif() -> Vec<u8> {
    write(
        &[vec![
            (0x010F, Value::Ascii("Apple")),
            (0x0110, Value::Ascii("iPhone 15")),
        ]],
        &[],
    )
}

#[test]
fn heic_and_avif_give_the_primary_items_facts_and_heic_says_how_it_is_shown() {
    let s = Scratch::new("heif");
    let icc = super::icc::tests::profile(true, "Display P3");
    let heic = facts_of(&s.write(
        "a.heic",
        &isobmff::tests::heif(b"heic", 3, &icc, &camera_exif()),
    ))
    .unwrap();
    assert_eq!((heic.format, heic.width, heic.height), ("heic", 4032, 3024));
    assert_eq!((heic.bit_depth, heic.channels), (Some(10), Some("RGB")));
    assert_eq!(heic.orientation, 6, "irot 3 is a quarter turn clockwise");
    assert_eq!(heic.color_profile.as_deref(), Some("Display P3"));
    assert_eq!(
        heic.exif.as_ref().and_then(|e| e.camera.as_deref()),
        Some("Apple iPhone 15")
    );
    if cfg!(target_os = "macos") {
        assert_eq!(heic.show, "webview");
    } else if crate::decode::heic_decodable() {
        assert_eq!((heic.show, heic.why), ("decoded", None));
    } else {
        assert_eq!(heic.show, "none");
        let why = heic.why.unwrap();
        #[cfg(windows)]
        assert_eq!(why, HEIC_WINDOWS_WHY);
        #[cfg(not(windows))]
        assert!(
            why.ends_with(
                "cannot decode HEIC images, and Marxy does not carry a decoder for them."
            ),
            "{why}"
        );
    }
    let avif = facts_of(&s.write("a.avif", &isobmff::tests::heif(b"avif", 0, &icc, &[]))).unwrap();
    assert_eq!(
        (avif.format, avif.orientation, avif.show),
        ("avif", 1, "webview")
    );
}

#[test]
fn a_raw_file_gives_the_sensors_size_its_orientation_and_shows_its_preview() {
    let s = Scratch::new("raw");
    let f = facts_of(&s.write("a.dng", &dng(6))).unwrap();
    assert_eq!(
        (f.format, f.width, f.height, f.orientation),
        ("raw", 64, 48, 6)
    );
    assert_eq!(
        (f.bit_depth, f.channels, f.show),
        (Some(12), None, "decoded")
    );
    assert_eq!(f.exif.and_then(|e| e.camera).as_deref(), Some("Marxy RAW"));
    // A RAW file with no preview is not shown, and says why.
    let bare = write(
        &[vec![
            (tiff::IMAGE_WIDTH, Value::Long(vec![64])),
            (tiff::IMAGE_LENGTH, Value::Long(vec![48])),
            (tiff::PHOTOMETRIC, Value::Short(vec![32803])),
        ]],
        &[],
    );
    let none = facts_of(&s.write("bare.nef", &bare)).unwrap();
    assert_eq!((none.format, none.show), ("raw", "none"));
    assert!(none.why.unwrap().contains("no preview"));
    // The same bytes named .tif are a TIFF.
    assert_eq!(
        facts_of(&s.write("bare.tif", &bare)).unwrap().format,
        "tiff"
    );
}

#[test]
fn an_svg_gives_its_size_from_its_root_element() {
    let s = Scratch::new("svg");
    let cases: [(&str, (u32, u32)); 4] = [
        (
            r#"<?xml version="1.0"?><!-- a <svg> in a comment --><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40px"/>"#,
            (120, 40),
        ),
        (
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect/></svg>"#,
            (200, 100),
        ),
        (
            r#"<svg width="10mm" viewBox="0, 0, 200, 100" xmlns="http://www.w3.org/2000/svg"></svg>"#,
            (38, 19),
        ),
        (
            r#"<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"></svg>"#,
            (0, 0),
        ),
    ];
    for (i, (text, size)) in cases.iter().enumerate() {
        let f = facts_of(&s.write(&format!("{i}.svg"), text.as_bytes())).unwrap();
        assert_eq!(
            (f.format, f.width, f.height),
            ("svg", size.0, size.1),
            "{text}"
        );
        assert_eq!(
            (f.show, f.bit_depth, f.channels, f.frames),
            ("webview", None, None, 1)
        );
    }
    // An SVG without the extension is still one by its root element.
    let f = facts_of(&s.write("drawing", cases[1].0.as_bytes())).unwrap();
    assert_eq!(f.format, "svg");
}

#[test]
fn what_is_not_an_image_these_readers_know_has_no_facts() {
    let s = Scratch::new("none");
    assert_eq!(facts_of(&s.write("notes.txt", b"# Not an image\n")), None);
    assert_eq!(
        facts_of(&s.write("lying.png", b"plain text named .png")),
        None
    );
    assert_eq!(facts_of(&s.write("empty.jpg", b"")), None);
    // A JPEG cut off before its frame header.
    assert_eq!(
        facts_of(&s.write("cut.jpg", &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J'])),
        None
    );
    assert_eq!(
        facts_of(&s.write("noise.html", b"<html><svg></svg></html>")),
        None
    );
}

/// The answer for a system without the codec, whatever this one has: on Windows it names both Store extensions.
#[test]
fn a_heic_with_the_codec_absent_says_what_draws_it_and_one_past_the_budget_is_refused() {
    let (show_as, why) = show(Format::Heic, 4032, 3024, None, false);
    if cfg!(target_os = "macos") {
        assert_eq!(show_as, "webview");
        return;
    }
    assert_eq!(show_as, "none");
    let why = why.unwrap();
    if cfg!(windows) {
        assert!(
            why.contains("HEIF Image Extension") && why.contains("HEVC Video Extension"),
            "{why}"
        );
    }
    assert_eq!(
        show(Format::Heic, 4032, 3024, None, true),
        ("decoded", None)
    );
    let (show_as, why) = show(Format::Heic, 100_000, 100_000, None, true);
    assert_eq!(show_as, "none");
    assert!(why.unwrap().contains("more than the 67 megapixels"));
    // Cropped to 100 x 100 by `clap`, but coded as 100,000 x 100,000: the coded size is what the decode fills.
    let (show_as, why) = show(Format::Heic, 100, 100, Some(10_000_000_000), true);
    assert_eq!(show_as, "none");
    assert!(why.unwrap().contains("stored as 10000 megapixels"));
    let cropped = isobmff::tests::heif_items(
        &[(
            1,
            b"hvc1",
            vec![
                isobmff::tests::ispe_box(100_000, 100_000),
                isobmff::tests::clap_box(100, 100),
            ],
        )],
        &[],
    );
    let s = Scratch::new("heifcoded");
    let f = facts_of(&s.write("cropped.heic", &cropped)).unwrap();
    assert_eq!((f.width, f.height, f.show), (100, 100, "none"));
}

#[test]
fn a_heic_cropped_by_clap_gives_the_shown_size_and_a_truncated_one_gives_no_facts() {
    let probe = include_bytes!("../decode/probe.heic");
    let s = Scratch::new("heifclap");
    let f = facts_of(&s.write("halves.heic", probe)).unwrap();
    assert_eq!((f.format, f.width, f.height), ("heic", 64, 32));
    for cut in [16, 60, 300] {
        assert_eq!(
            facts_of(&s.write("cut.heic", &probe[..cut])),
            None,
            "cut at {cut}"
        );
    }
}

/// With the probe forced to "absent", the facts give the card's answer naming both Store extensions.
#[cfg(windows)]
#[test]
fn with_the_probe_forced_absent_a_heic_is_the_card_that_names_the_extensions() {
    let s = Scratch::new("heifabsent");
    let path = s.write("halves.heic", include_bytes!("../decode/probe.heic"));
    crate::decode::wic::force_probe(Some(false));
    let f = facts_of(&path).unwrap();
    crate::decode::wic::force_probe(None);
    assert_eq!((f.show, f.why.as_deref()), ("none", Some(HEIC_WINDOWS_WHY)));
}

fn picture(name: &str) -> ImageFacts {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/pictures")
        .join(name);
    facts_of(&path).unwrap_or_else(|| panic!("{name} has facts"))
}

#[test]
fn the_pnm_family_farbfeld_dds_svgz_and_psd_give_their_size_and_depth() {
    for (name, format, depth, channels) in [
        ("tiny.pbm", "pbm", 1, Some("Gray")),
        ("tiny.pgm", "pgm", 16, Some("Gray")),
        ("tiny.ppm", "ppm", 8, Some("RGB")),
        ("tiny.pam", "pam", 8, Some("RGBA")),
        ("tiny.ff", "farbfeld", 16, Some("RGBA")),
        ("tiny.dds", "dds", 8, Some("RGB")),
        ("preview.psd", "psd", 8, Some("RGB")),
        ("thumb.psd", "psd", 8, Some("RGB")),
    ] {
        let f = picture(name);
        assert_eq!(
            (f.format, f.width, f.height, f.bit_depth, f.channels, f.show),
            (format, 8, 4, Some(depth), channels, "decoded"),
            "{name}"
        );
    }
    let svgz = picture("tiny.svgz");
    assert_eq!(
        (svgz.format, svgz.width, svgz.height, svgz.show),
        ("svgz", 120, 80, "decoded")
    );
}

#[test]
fn what_is_not_drawn_after_all_says_why() {
    for (name, says) in [
        ("bare.psd", "saved without a preview"),
        ("oversized.psd", "image resources run past the end"),
        ("truncated.dds", "cut short: it holds 136 bytes of the 144"),
        ("bc7.dds", "compressed as BC7"),
        ("bomb.svgz", "unpacks to more than 16 MB"),
    ] {
        let f = picture(name);
        assert_eq!(f.show, "none", "{name}");
        let why = f.why.unwrap_or_default();
        assert!(why.contains(says), "{name}: {why}");
    }
}

/// Deterministic noise for the fuzz tests: xorshift, so a failure names its seed.
fn noise(seed: u64) -> impl FnMut() -> u64 {
    let mut x = seed | 1;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    }
}

/// Every cut and thousands of mutations of a DDS and a PSD (an oversized resource length among them) are read and
/// decoded without a panic: each is facts, a refusal, or a decode error.
#[test]
fn fuzzed_dds_and_psd_files_never_panic() {
    let s = Scratch::new("fuzz");
    let base = |n: &str| {
        std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/pictures")
                .join(n),
        )
        .unwrap()
    };
    for name in [
        "tiny.dds",
        "preview.psd",
        "thumb.psd",
        "raw.psd",
        "oversized.psd",
    ] {
        let bytes = base(name);
        let ext = name.rsplit('.').next().unwrap();
        let mut variants: Vec<Vec<u8>> = (0..bytes.len()).map(|n| bytes[..n].to_vec()).collect();
        let mut rnd = noise(bytes.len() as u64 * 7919);
        for _ in 0..1500 {
            let mut v = bytes.clone();
            for _ in 0..1 + rnd() % 4 {
                let at = (rnd() % v.len() as u64) as usize;
                v[at] = match rnd() % 3 {
                    0 => 0xFF,
                    1 => 0,
                    _ => rnd() as u8,
                };
            }
            variants.push(v);
        }
        for v in &variants {
            let p = s.write(&format!("v.{ext}"), v);
            let _ = read(&p, File::open(&p).unwrap());
            let head: Vec<u8> = v.iter().take(16).copied().collect();
            for d in decode::DECODERS.iter().filter(|d| d.reads(ext, &head)) {
                let _ = d.decode(File::open(&p).unwrap());
            }
        }
    }
}

fn picture_bytes(name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/pictures")
            .join(name),
    )
    .unwrap()
}

/// A DDS header `image`'s reader refuses is the card with why, not a picture that fails to load.
#[test]
fn a_dds_header_the_decoder_refuses_is_refused_by_the_facts_too() {
    let s = Scratch::new("ddsheader");
    let base = picture_bytes("tiny.dds");
    let patched = |at: usize, v: u32| {
        let mut b = base.clone();
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
        b
    };
    let mut dx10 = base.clone();
    dx10[84..88].copy_from_slice(b"DX10");
    dx10.splice(
        128..128,
        [71u32, 7, 0, 1, 0].iter().flat_map(|v| v.to_le_bytes()),
    );
    for (name, bytes, says) in [
        (
            "caps-only.dds",
            patched(8, 0x1),
            "lack the caps, height, width or pixel format",
        ),
        (
            "unknown-flag.dds",
            patched(8, 0x1007 | 0x40),
            "name ones it does not know",
        ),
        (
            "pf-size.dds",
            patched(76, 24),
            "pixel format block says 24 bytes",
        ),
        ("dx10.dds", dx10, "DX10 header is out of range"),
    ] {
        let p = s.write(name, &bytes);
        let f = facts_of(&p).unwrap();
        assert_eq!(f.show, "none", "{name}");
        assert!(
            f.why.as_deref().unwrap_or("").contains(says),
            "{name}: {:?}",
            f.why
        );
        // And the decoder does refuse it.
        assert!(
            decode::DDS.decode(File::open(&p).unwrap()).is_err(),
            "{name}"
        );
    }
}

/// A PSD drawn from its thumbnail: enlarged to the file's size within the budget, at its own size past it, said either way.
#[test]
fn a_psd_thumbnail_is_sized_as_it_is_drawn_and_said() {
    let s = Scratch::new("psdthumb");
    let sized = |w: u32, h: u32| {
        let mut b = picture_bytes("thumb.psd");
        b[14..18].copy_from_slice(&h.to_be_bytes());
        b[18..22].copy_from_slice(&w.to_be_bytes());
        b
    };
    for (w, h, shown, says) in [
        (16, 8, (16, 8), "enlarged to the file's size"),
        (
            12_000,
            9_000,
            (8, 4),
            "at its own 8 by 4: the file is 12000 by 9000",
        ),
        (24, 4, (8, 4), "at its own 8 by 4"),
    ] {
        let p = s.write("t.psd", &sized(w, h));
        let f = facts_of(&p).unwrap();
        assert_eq!(
            (f.width, f.height, f.show),
            (shown.0, shown.1, "decoded"),
            "{w}x{h}"
        );
        assert!(
            f.note.as_deref().unwrap_or("").contains(says),
            "{w}x{h}: {:?}",
            f.note
        );
        let png = decode::PSD.decode(File::open(&p).unwrap()).unwrap();
        let img = image::load_from_memory(&png).unwrap();
        assert_eq!(
            (img.width(), img.height()),
            shown,
            "{w}x{h}: drawn as the facts say"
        );
    }
    assert_eq!(
        picture("preview.psd").note,
        None,
        "the flattened image is the file's own"
    );
}
