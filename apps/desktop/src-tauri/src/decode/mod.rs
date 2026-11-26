//! Decoders for the image formats the webview cannot show, behind `file_scheme`'s `Decoder` seam: TIFF,
//! TGA, OpenEXR, Radiance HDR, QOI, the PNM family, farbfeld and DDS (BC1 to BC3) through `image`, JPEG XL through
//! `jxl-oxide`, a camera RAW file's largest embedded JPEG preview, and a Photoshop file's own preview (`psd`). An SVGZ is
//! unpacked to its SVG (`svgz`), which the webview draws. Each answers PNG bytes, upright: the file's orientation is applied, as the webview applies it
//! to a JPEG it shows, so the page never rotates an image itself. HEIC is drawn by WKWebView on macOS, decoded on Windows
//! by the system's own decoder when it has one (`wic`), and not at all on Linux.

pub mod psd;
pub mod raw;
pub mod svgz;
pub mod tiff;
#[cfg(windows)]
pub mod wic;

use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom};
use std::sync::{Condvar, Mutex, OnceLock};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::file_scheme::Decoder;

// The limits, each checked before the buffer it bounds is allocated. A header claiming more than MAX_PIXELS (2^26,
// 8192 x 8192, about 67 megapixels; a 100,000 x 100,000 header is refused) is refused once its header is read, before
// any pixel is decoded. One decode may allocate at most MAX_ALLOC (1 GiB: 67 MP of 8-bit RGBA is 256 MiB, of float RGBA
// a full GiB, so a float image near the pixel budget is refused by this one), passed to each decoder as `image`'s
// `Limits`. What a decoder reads whole into memory (a JPEG XL file, a RAW file's preview) is at most MAX_INPUT_BYTES
// (256 MiB). At most DECODES_AT_ONCE decodes run together, so the peak is about twice MAX_ALLOC plus the PNG.
pub const MAX_PIXELS: u64 = 1 << 26;
pub const MAX_ALLOC: u64 = 1 << 30;
pub const MAX_INPUT_BYTES: u64 = 256 * 1024 * 1024;
const DECODES_AT_ONCE: usize = 2;

/// A turn at decoding, `DECODES_AT_ONCE` at most.
struct Turn;

fn turns() -> &'static (Mutex<usize>, Condvar) {
    static TURNS: OnceLock<(Mutex<usize>, Condvar)> = OnceLock::new();
    TURNS.get_or_init(|| (Mutex::new(0), Condvar::new()))
}

impl Turn {
    fn take() -> Turn {
        let (count, freed) = turns();
        let mut n = count.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= DECODES_AT_ONCE {
            n = freed.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Turn
    }
}

/// Runs `work` holding a decode turn, as a decoder does; for a test's decoder.
#[cfg(test)]
pub(crate) fn with_turn<T>(work: impl FnOnce() -> T) -> T {
    let _turn = Turn::take();
    work()
}

/// Whether every turn can be taken at once within `wait`: false when a turn leaked.
#[cfg(test)]
pub(crate) fn every_turn_comes_back(wait: std::time::Duration) -> bool {
    let (done, heard) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let turns: Vec<Turn> = (0..DECODES_AT_ONCE).map(|_| Turn::take()).collect();
        drop(turns);
        let _ = done.send(());
    });
    heard.recv_timeout(wait).is_ok()
}

impl Drop for Turn {
    fn drop(&mut self) {
        let (count, freed) = turns();
        *count.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        freed.notify_one();
    }
}

/// Refuses a size past the pixel budget.
pub fn within_budget(width: u32, height: u32) -> Result<(), String> {
    let pixels = width as u64 * height as u64;
    if pixels > MAX_PIXELS {
        return Err(format!(
            "{width} x {height} is {pixels} pixels, past the {MAX_PIXELS} a decode may hold"
        ));
    }
    Ok(())
}

/// Refuses a count of pixels to fill past the budget: a HEIF grid's tiles, each decoded whole. Only the Windows
/// decoder (`wic`) fills tiles.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn within_pixels(pixels: u64) -> Result<(), String> {
    if pixels > MAX_PIXELS {
        return Err(format!(
            "{pixels} pixels to decode, past the {MAX_PIXELS} a decode may hold"
        ));
    }
    Ok(())
}

fn limits() -> Limits {
    let mut l = Limits::default();
    l.max_alloc = Some(MAX_ALLOC);
    l
}

/// The sRGB transfer function, for linear light (OpenEXR, Radiance HDR) shown on an 8-bit page.
fn srgb(linear: f32) -> u8 {
    let c = if linear.is_nan() {
        0.0
    } else {
        linear.clamp(0.0, 1.0)
    };
    let v = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (v * 255.0 + 0.5) as u8
}

fn png_of(img: DynamicImage) -> Result<Vec<u8>, String> {
    let img = match img {
        DynamicImage::ImageRgb32F(f) => {
            let (w, h) = f.dimensions();
            DynamicImage::ImageRgb8(image::RgbImage::from_fn(w, h, |x, y| {
                let p = f.get_pixel(x, y).0;
                image::Rgb([srgb(p[0]), srgb(p[1]), srgb(p[2])])
            }))
        }
        DynamicImage::ImageRgba32F(f) => {
            let (w, h) = f.dimensions();
            DynamicImage::ImageRgba8(image::RgbaImage::from_fn(w, h, |x, y| {
                let p = f.get_pixel(x, y).0;
                let a = (p[3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                image::Rgba([srgb(p[0]), srgb(p[1]), srgb(p[2]), a])
            }))
        }
        other => other,
    };
    let mut out = Vec::new();
    let encoder =
        PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Adaptive);
    img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Decodes through `decoder` within the limits: the size is judged from the header before anything is allocated.
/// `orientation`, when given, overrides what the decoder reads from the file; None keeps the decoder's own.
fn decode_with(
    mut decoder: impl ImageDecoder,
    orientation: Option<Orientation>,
) -> Result<Vec<u8>, String> {
    let (w, h) = decoder.dimensions();
    within_budget(w, h)?;
    if decoder.total_bytes() > MAX_ALLOC {
        return Err(format!("{w} x {h} would take more than {MAX_ALLOC} bytes"));
    }
    decoder.set_limits(limits()).map_err(|e| e.to_string())?;
    let orientation = match orientation {
        Some(o) => o,
        None => decoder.orientation().unwrap_or(Orientation::NoTransforms),
    };
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    png_of(img)
}

/// `file` read from its first byte, whatever its handle has read already.
fn rewound(mut file: File) -> Result<BufReader<File>, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    Ok(BufReader::new(file))
}

fn has_ext(extension: &str, list: &[&str]) -> bool {
    list.contains(&extension)
}

fn is_tiff(head: &[u8]) -> bool {
    head.starts_with(b"II*\0") || head.starts_with(b"MM\0*")
}

/// A format `image` decodes, chosen by magic, or by extension for TGA, which has none.
pub struct ImageCrate {
    format: ImageFormat,
    extensions: &'static [&'static str],
    magic: fn(&[u8]) -> bool,
}

impl Decoder for ImageCrate {
    fn reads(&self, extension: &str, head: &[u8]) -> bool {
        (self.magic)(head) || (has_ext(extension, self.extensions) && head.len() >= 4)
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        let _turn = Turn::take();
        let mut reader = ImageReader::with_format(rewound(file)?, self.format);
        reader.limits(limits());
        decode_with(reader.into_decoder().map_err(|e| e.to_string())?, None)
    }
}

pub static TIFF: ImageCrate = ImageCrate {
    format: ImageFormat::Tiff,
    extensions: &["tif", "tiff"],
    magic: is_tiff,
};

pub static TGA: ImageCrate = ImageCrate {
    format: ImageFormat::Tga,
    extensions: &["tga", "icb", "vda", "vst"],
    magic: |_| false,
};

pub static EXR: ImageCrate = ImageCrate {
    format: ImageFormat::OpenExr,
    extensions: &["exr"],
    magic: |h| h.starts_with(&[0x76, 0x2F, 0x31, 0x01]),
};

pub static HDR: ImageCrate = ImageCrate {
    format: ImageFormat::Hdr,
    extensions: &["hdr", "pic", "rgbe"],
    magic: |h| h.starts_with(b"#?RADIANCE") || h.starts_with(b"#?RGBE"),
};

pub static QOI: ImageCrate = ImageCrate {
    format: ImageFormat::Qoi,
    extensions: &["qoi"],
    magic: |h| h.starts_with(b"qoif"),
};

/// `P1` to `P7` and the whitespace after it: the PNM family's magic, short enough that the name must agree.
pub fn is_pnm(head: &[u8]) -> bool {
    matches!(head, [b'P', b'1'..=b'7', c, ..] if c.is_ascii_whitespace())
}

pub static PNM: ImageCrate = ImageCrate {
    format: ImageFormat::Pnm,
    extensions: &["pbm", "pgm", "ppm", "pnm", "pam"],
    magic: |_| false,
};

pub static FARBFELD: ImageCrate = ImageCrate {
    format: ImageFormat::Farbfeld,
    extensions: &["ff"],
    magic: |h| h.starts_with(b"farbfeld"),
};

pub static DDS: ImageCrate = ImageCrate {
    format: ImageFormat::Dds,
    extensions: &["dds"],
    magic: |h| h.starts_with(b"DDS "),
};

pub fn is_jxl(head: &[u8]) -> bool {
    head.starts_with(&[0xFF, 0x0A])
        || head.starts_with(&[
            0, 0, 0, 0x0C, b'J', b'X', b'L', b' ', 0x0D, 0x0A, 0x87, 0x0A,
        ])
}

/// JPEG XL through `jxl-oxide`, single-threaded. It renders upright itself, so no orientation is applied after.
pub struct Jxl;

impl Decoder for Jxl {
    fn reads(&self, extension: &str, head: &[u8]) -> bool {
        is_jxl(head) || (extension == "jxl" && head.len() >= 2)
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        let _turn = Turn::take();
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        if len > MAX_INPUT_BYTES {
            return Err(format!(
                "{len} bytes, past the {MAX_INPUT_BYTES} read whole"
            ));
        }
        let decoder =
            jxl_oxide::integration::JxlDecoder::new(rewound(file)?).map_err(|e| e.to_string())?;
        decode_with(decoder, Some(Orientation::NoTransforms))
    }
}

pub static JXL: Jxl = Jxl;

/// A camera RAW file's largest embedded JPEG preview, turned by the RAW file's own orientation.
pub struct RawPreview;

impl Decoder for RawPreview {
    fn reads(&self, extension: &str, head: &[u8]) -> bool {
        has_ext(extension, raw::EXTENSIONS)
            && (is_tiff(head)
                || raw::is_raf(head)
                || head.starts_with(b"IIRO")
                || head.starts_with(b"IIU\0"))
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        let _turn = Turn::take();
        let mut file = rewound(file)?;
        let preview = raw::find_preview(&mut file)
            .map_err(|e| e.to_string())?
            .ok_or("no embedded preview")?;
        within_budget(preview.width as u32, preview.height as u32)?;
        if preview.len > MAX_INPUT_BYTES {
            return Err(format!("a preview of {} bytes", preview.len));
        }
        let mut magic = [0u8; 16];
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.read_exact(&mut magic))
            .map_err(|e| e.to_string())?;
        // A RAF's preview is a camera JPEG with its own EXIF; the TIFF-based files' orientation is in IFD0.
        let orientation = (!raw::is_raf(&magic)).then(|| {
            let o = crate::facts::raw_orientation(&mut file);
            Orientation::from_exif(o as u8).unwrap_or(Orientation::NoTransforms)
        });
        let mut bytes = vec![0u8; preview.len as usize];
        file.seek(SeekFrom::Start(preview.offset))
            .and_then(|_| file.read_exact(&mut bytes))
            .map_err(|e| e.to_string())?;
        let decoder =
            image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        decode_with(decoder, orientation)
    }
}

pub static RAW: RawPreview = RawPreview;

/// A Photoshop file's flattened image, or its JPEG thumbnail where that image is blank (`psd::find`).
pub struct PsdPreview;

impl Decoder for PsdPreview {
    fn reads(&self, _extension: &str, head: &[u8]) -> bool {
        psd::is_psd(head)
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        let _turn = Turn::take();
        let mut file = rewound(file)?;
        let header = psd::header(&mut file).map_err(|e| e.to_string())?;
        match psd::find(&mut file).map_err(|e| e.to_string())?? {
            psd::Preview::Composite(c) => png_of(psd::decode_composite(&mut file, &c)?),
            psd::Preview::Thumbnail {
                offset,
                len,
                width,
                height,
            } => {
                within_budget(width, height)?;
                if len > MAX_INPUT_BYTES {
                    return Err(format!("a thumbnail of {len} bytes"));
                }
                let mut bytes = vec![0u8; len as usize];
                file.seek(SeekFrom::Start(offset))
                    .and_then(|_| file.read_exact(&mut bytes))
                    .map_err(|e| e.to_string())?;
                let mut decoder = image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes))
                    .map_err(|e| e.to_string())?;
                let (tw, th) = decoder.dimensions();
                within_budget(tw, th)?;
                decoder.set_limits(limits()).map_err(|e| e.to_string())?;
                // The thumbnail is written upright, whatever its own JPEG says; enlarged to the file's size where
                // `thumbnail_shown` allows, as the facts say.
                let img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
                let (w, h) = psd::thumbnail_shown((header.width, header.height), (tw, th));
                png_of(if (w, h) == (tw, th) {
                    img
                } else {
                    img.resize_exact(w, h, image::imageops::FilterType::Triangle)
                })
            }
        }
    }
}

pub static PSD: PsdPreview = PsdPreview;

/// An SVGZ's SVG, unpacked within `svgz::MAX_UNPACKED` and answered as `image/svg+xml` for `<img>`.
pub struct Svgz;

impl Decoder for Svgz {
    fn reads(&self, extension: &str, head: &[u8]) -> bool {
        extension == "svgz" && svgz::is_gzip(head)
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        match svgz::unpack(rewound(file)?) {
            svgz::Unpacked::Svg(svg) if crate::facts::has_svg_root(&svg) => Ok(svg),
            svgz::Unpacked::Svg(_) => Err("it unpacks to something that is not an SVG".into()),
            svgz::Unpacked::TooLarge => Err(svgz::too_large_why()),
            svgz::Unpacked::Damaged => Err(svgz::DAMAGED_WHY.into()),
        }
    }

    fn media_type(&self) -> &'static str {
        "image/svg+xml"
    }
}

pub static SVGZ: Svgz = Svgz;

/// The decoders in the order a `?decoded` request tries them: RAW before TIFF, since most RAW files are TIFFs.
#[cfg(not(windows))]
pub static DECODERS: &[&dyn Decoder] = &[
    &RAW, &TIFF, &EXR, &HDR, &QOI, &JXL, &PNM, &FARBFELD, &DDS, &PSD, &SVGZ, &TGA,
];
#[cfg(windows)]
pub static DECODERS: &[&dyn Decoder] = &[
    &RAW,
    &TIFF,
    &EXR,
    &HDR,
    &QOI,
    &JXL,
    &PNM,
    &FARBFELD,
    &DDS,
    &PSD,
    &SVGZ,
    &TGA,
    &wic::WIC,
];

/// Whether a HEIC is decoded here: on Windows when the system's decoder answered the probe, never elsewhere.
pub fn heic_decodable() -> bool {
    #[cfg(windows)]
    return wic::codec_present();
    #[cfg(not(windows))]
    false
}

/// Whether the system has not yet said if it decodes HEIC because a decode is stuck: never off Windows.
pub fn heic_stalled() -> bool {
    #[cfg(windows)]
    return wic::stalled();
    #[cfg(not(windows))]
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir =
                std::env::temp_dir().join(format!("marxy-decode-{name}-{}", std::process::id()));
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

    fn head(path: &Path) -> Vec<u8> {
        let mut b = std::fs::read(path).unwrap();
        b.truncate(16);
        b
    }

    fn ext(path: &Path) -> String {
        path.extension().unwrap().to_string_lossy().to_lowercase()
    }

    /// The decoder `DECODERS` picks for `path`, and its PNG decoded back.
    fn decode(path: &Path) -> DynamicImage {
        let d = DECODERS
            .iter()
            .find(|d| d.reads(&ext(path), &head(path)))
            .expect("a decoder reads it");
        let png = d.decode(File::open(path).unwrap()).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap()
    }

    /// Red on the left half, blue on the right.
    fn halves(w: u32, h: u32) -> image::RgbaImage {
        image::RgbaImage::from_fn(w, h, |x, _| {
            if x < w / 2 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            }
        })
    }

    fn encoded(format: ImageFormat, img: DynamicImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/images")
            .join(name)
    }

    fn red_left_blue_right(img: &DynamicImage) {
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        let left = rgba.get_pixel(0, h / 2).0;
        let right = rgba.get_pixel(w - 1, h / 2).0;
        assert!(left[0] > 200 && left[2] < 60, "left {left:?}");
        assert!(right[2] > 200 && right[0] < 60, "right {right:?}");
    }

    #[test]
    fn tiff_tga_and_qoi_decode_to_their_pixels() {
        let s = Scratch::new("formats");
        for (name, format) in [
            ("a.tiff", ImageFormat::Tiff),
            ("a.tga", ImageFormat::Tga),
            ("a.qoi", ImageFormat::Qoi),
        ] {
            let p = s.write(
                name,
                &encoded(format, DynamicImage::ImageRgba8(halves(6, 4))),
            );
            let img = decode(&p);
            assert_eq!((img.width(), img.height()), (6, 4), "{name}");
            red_left_blue_right(&img);
        }
        let committed = decode(&fixture("tiny.tiff"));
        assert_eq!((committed.width(), committed.height()), (6, 4));
        red_left_blue_right(&committed);
    }

    /// A decode reads the handle the request judged, from its start, even after the path names another file and the
    /// handle has been read from.
    #[test]
    fn a_decode_reads_the_handle_it_is_given_not_the_path() {
        let s = Scratch::new("handle");
        let p = s.write("a.tiff", &std::fs::read(fixture("tiny.tiff")).unwrap());
        let mut held = File::open(&p).unwrap();
        let mut head = [0u8; 16];
        held.read_exact(&mut head).unwrap();
        let other = s.write("other.tiff", b"II*\0not an image at all");
        std::fs::rename(&other, &p).unwrap();
        let png = TIFF.decode(held).expect("the handle's image");
        let img = image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap();
        red_left_blue_right(&img);
        assert!(
            TIFF.decode(File::open(&p).unwrap()).is_err(),
            "the path names the swapped-in file"
        );
    }

    #[test]
    fn exr_and_hdr_decode_from_linear_light() {
        let s = Scratch::new("linear");
        let f = image::Rgb32FImage::from_fn(4, 2, |x, _| {
            if x < 2 {
                image::Rgb([1.0, 0.0, 0.0])
            } else {
                image::Rgb([0.0, 0.0, 0.214])
            }
        });
        let exr = s.write(
            "a.exr",
            &encoded(ImageFormat::OpenExr, DynamicImage::ImageRgb32F(f.clone())),
        );
        let mut hdr = Vec::new();
        image::codecs::hdr::HdrEncoder::new(&mut hdr)
            .encode(
                f.as_raw()
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|c| image::Rgb([c[0], c[1], c[2]]))
                    .collect::<Vec<_>>()
                    .as_slice(),
                4,
                2,
            )
            .unwrap();
        let hdr = s.write("a.hdr", &hdr);
        for p in [exr, hdr] {
            let img = decode(&p).to_rgba8();
            assert_eq!(img.dimensions(), (4, 2));
            assert_eq!(img.get_pixel(0, 0).0[0], 255);
            // 0.214 linear is about half way up the sRGB curve.
            let b = img.get_pixel(3, 1).0[2];
            assert!((120..=135).contains(&b), "{} {b}", p.display());
        }
    }

    #[test]
    fn jpeg_xl_decodes() {
        let img = decode(&fixture("tiny.jxl"));
        assert_eq!((img.width(), img.height()), (6, 4));
        red_left_blue_right(&img);
        assert!(img.color().has_alpha());
        assert_eq!(img.to_rgba8().get_pixel(0, 3).0[3], 128);
    }

    #[test]
    fn a_raw_file_decodes_to_its_largest_preview_turned_upright() {
        let s = Scratch::new("raw");
        let upright = s.write("a.dng", &raw::tests::dng(1));
        let img = decode(&upright);
        assert_eq!((img.width(), img.height()), (16, 8));
        red_left_blue_right(&img);
        // Orientation 6: turned a quarter clockwise, so red (left) is now on top.
        let turned = decode(&s.write("b.nef", &raw::tests::dng(6)));
        assert_eq!((turned.width(), turned.height()), (8, 16));
        let rgba = turned.to_rgba8();
        assert!(rgba.get_pixel(4, 0).0[0] > 200);
        assert!(rgba.get_pixel(4, 15).0[2] > 200);
    }

    #[test]
    fn a_tiff_turned_by_its_orientation_comes_out_upright() {
        let s = Scratch::new("tifforient");
        // image's TIFF encoder writes no Orientation, so the file is built by hand.
        use tiff::build::{write, Value};
        let px = halves(4, 2);
        let rgb: Vec<u8> = DynamicImage::ImageRgba8(px).to_rgb8().into_raw();
        let bytes = write(
            &[vec![
                (tiff::IMAGE_WIDTH, Value::Long(vec![4])),
                (tiff::IMAGE_LENGTH, Value::Long(vec![2])),
                (tiff::BITS_PER_SAMPLE, Value::Short(vec![8, 8, 8])),
                (tiff::COMPRESSION, Value::Short(vec![1])),
                (tiff::PHOTOMETRIC, Value::Short(vec![2])),
                (tiff::STRIP_OFFSETS, Value::BlobRef(0)),
                (tiff::ORIENTATION, Value::Short(vec![6])),
                (tiff::SAMPLES_PER_PIXEL, Value::Short(vec![3])),
                (0x0116, Value::Long(vec![2])),
                (tiff::STRIP_BYTE_COUNTS, Value::Long(vec![rgb.len() as u32])),
            ]],
            &[&rgb],
        );
        let img = decode(&s.write("turned.tif", &bytes)).to_rgba8();
        assert_eq!(img.dimensions(), (2, 4));
        assert!(img.get_pixel(1, 0).0[0] > 200, "red on top");
        assert!(img.get_pixel(1, 3).0[2] > 200, "blue below");
    }

    fn qoi_header(side: u32) -> Vec<u8> {
        let mut qoi = b"qoif".to_vec();
        qoi.extend_from_slice(&side.to_be_bytes());
        qoi.extend_from_slice(&side.to_be_bytes());
        qoi.extend_from_slice(&[4, 0]);
        qoi.extend_from_slice(&[0; 8]);
        qoi
    }

    /// A header that claims 100,000 x 100,000 pixels is refused once the header is read, before a pixel buffer is
    /// allocated: by the budget, or by the format's own reader where it refuses first (QOI's stops at 400 MP).
    #[test]
    fn a_header_past_the_pixel_budget_is_refused() {
        let s = Scratch::new("limit");
        let qoi = qoi_header(100_000);
        let hdr = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 100000 +X 100000\n\0\0\0\0".to_vec();
        use tiff::build::{write, Value};
        let tif = write(
            &[vec![
                (tiff::IMAGE_WIDTH, Value::Long(vec![100_000])),
                (tiff::IMAGE_LENGTH, Value::Long(vec![100_000])),
                (tiff::BITS_PER_SAMPLE, Value::Short(vec![8])),
                (tiff::PHOTOMETRIC, Value::Short(vec![1])),
                (tiff::STRIP_OFFSETS, Value::Long(vec![8])),
                (tiff::STRIP_BYTE_COUNTS, Value::Long(vec![1])),
            ]],
            &[],
        );
        // TGA's sizes are 16-bit: its largest, 65,535 squared, is past the budget too.
        let mut tga = vec![
            0u8, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 24, 0,
        ];
        tga.extend_from_slice(&[0; 16]);
        for (name, bytes) in [
            ("big.qoi", qoi),
            ("big.hdr", hdr),
            ("big.tif", tif),
            ("big.tga", tga),
        ] {
            let p = s.write(name, &bytes);
            let d = DECODERS
                .iter()
                .find(|d| d.reads(&ext(&p), &head(&p)))
                .unwrap();
            let started = std::time::Instant::now();
            let err = d.decode(File::open(&p).unwrap()).unwrap_err();
            assert!(!err.is_empty(), "{name}");
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "{name}: refused late"
            );
        }
        // 10,000 squared (100 MP) passes QOI's own check and is refused by the budget's.
        let err = QOI
            .decode(File::open(s.write("hundred.qoi", &qoi_header(10_000))).unwrap())
            .unwrap_err();
        assert!(err.contains("past the 67108864"), "{err}");
        assert!(within_budget(100_000, 100_000).is_err());
        assert!(within_budget(8192, 8192).is_ok());
    }

    fn picture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/pictures")
            .join(name)
    }

    #[test]
    fn pnm_farbfeld_dds_and_psd_decode_to_their_pixels() {
        for name in [
            "tiny.ppm",
            "tiny.pam",
            "tiny.ff",
            "tiny.dds",
            "preview.psd",
            "raw.psd",
        ] {
            let img = decode(&picture(name));
            assert_eq!((img.width(), img.height()), (8, 4), "{name}");
            red_left_blue_right(&img);
        }
        // A bitmap and a grey: dark on the left, light on the right.
        for name in ["tiny.pbm", "tiny.pgm"] {
            let img = decode(&picture(name)).to_luma8();
            assert_eq!(img.dimensions(), (8, 4), "{name}");
            assert!(
                img.get_pixel(0, 0).0[0] < 40 && img.get_pixel(7, 0).0[0] > 200,
                "{name}"
            );
        }
        let thumb = decode(&picture("thumb.psd"));
        assert_eq!(
            (thumb.width(), thumb.height()),
            (8, 4),
            "the thumbnail, not turned by its JPEG's EXIF"
        );
    }

    #[test]
    fn an_svgz_is_answered_as_its_svg_and_a_bomb_is_refused() {
        let p = picture("tiny.svgz");
        let d = DECODERS
            .iter()
            .find(|d| d.reads("svgz", &head(&p)))
            .unwrap();
        assert_eq!(d.media_type(), "image/svg+xml");
        assert!(d
            .decode(File::open(&p).unwrap())
            .unwrap()
            .starts_with(b"<svg"));
        let err = SVGZ
            .decode(File::open(picture("bomb.svgz")).unwrap())
            .unwrap_err();
        assert!(err.contains("more than 16 MB"), "{err}");
        // What unpacks to no SVG is refused, as its facts refuse it.
        let mut text = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut text, b"hello, not a drawing").unwrap();
        let s = Scratch::new("svgztext");
        let p2 = s.write("text.svgz", &text.finish().unwrap());
        assert!(SVGZ.decode(File::open(&p2).unwrap()).is_err());
        // A lone .gz is not an SVGZ.
        assert!(!DECODERS.iter().any(|d| d.reads("gz", &head(&p))));
    }

    #[test]
    fn a_truncated_dds_and_a_damaged_psd_are_decode_errors() {
        for name in ["truncated.dds", "bc7.dds", "oversized.psd", "bare.psd"] {
            let p = picture(name);
            let d = DECODERS
                .iter()
                .find(|d| d.reads(&ext(&p), &head(&p)))
                .unwrap();
            assert!(d.decode(File::open(&p).unwrap()).is_err(), "{name}");
        }
    }

    #[test]
    fn what_no_decoder_reads_is_left_to_the_webview() {
        let png_head = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
        assert!(!DECODERS.iter().any(|d| d.reads("png", png_head)));
        assert!(!DECODERS.iter().any(|d| d.reads("jpg", b"\xff\xd8\xff\xe0")));
        // A TIFF named as a RAW file is the RAW decoder's.
        assert!(RAW.reads("cr2", b"II*\0\x10\0\0\0CR"));
        assert!(!TIFF.reads("tif", b"no"));
    }
}
