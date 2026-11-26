//! HEIC through Windows' own Windows Imaging Component decoder, which the HEIF Image Extension and the HEVC Video
//! Extension from the Microsoft Store provide. Marxy carries no HEVC decoder; where the system has none, the probe says
//! so and the facts give the card's answer instead of a failed decode.

use std::fs::File;
use std::io::{Cursor, Read};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use image::{DynamicImage, RgbaImage};
use windows::core::HRESULT;
use windows::Win32::Foundation::{
    WINCODEC_ERR_COMPONENTINITIALIZEFAILURE, WINCODEC_ERR_COMPONENTNOTFOUND,
    WINCODEC_ERR_UNKNOWNIMAGEFORMAT, WINCODEC_ERR_UNSUPPORTEDOPERATION,
};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICImagingFactory,
    WICConvertBitmapSource, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};

use super::{png_of, rewound, within_budget, within_pixels, Turn, MAX_INPUT_BYTES};
use crate::file_scheme::Decoder;

/// How long one decode may take before the page is answered without it. A 48 MP photo decodes in about a second.
const DECODE_TIMEOUT: Duration = Duration::from_secs(20);

/// A 64 x 32 HEIC, red left and blue right, written by Windows' own HEIF encoder: what the probe asks the system to
/// decode, since the HEIF decoder is present without the HEVC one it needs.
pub const PROBE: &[u8] = include_bytes!("probe.heic");

/// Why a decode through WIC failed, and whether the system has said for certain it cannot decode (a missing component,
/// an unknown format) rather than failing for now (COM, a thread, memory, a timeout).
#[derive(Debug)]
struct Failure {
    why: String,
    definite: bool,
}

impl Failure {
    fn now(why: impl Into<String>) -> Failure {
        Failure {
            why: why.into(),
            definite: false,
        }
    }
}

impl From<String> for Failure {
    fn from(why: String) -> Failure {
        Failure::now(why)
    }
}

/// A failure from the decoder itself: definite when WIC says the decoder is missing or the format unknown, or the
/// HEVC decoder underneath (Media Foundation's facility) refuses.
fn decoder_failed(e: windows::core::Error) -> Failure {
    let code = e.code();
    let definite = [
        WINCODEC_ERR_COMPONENTNOTFOUND,
        WINCODEC_ERR_UNKNOWNIMAGEFORMAT,
        WINCODEC_ERR_UNSUPPORTEDOPERATION,
        WINCODEC_ERR_COMPONENTINITIALIZEFAILURE,
    ]
    .contains(&code)
        || facility(code) == 0xD;
    Failure {
        why: e.message(),
        definite,
    }
}

fn facility(code: HRESULT) -> u32 {
    (code.0 as u32 >> 16) & 0x1FFF
}

/// The probe's answer, kept once it is definite: decoded, or refused for certain. A timeout, a thread or COM that would
/// not start, or a panic is not kept, so the next HEIC asks again.
static PROBED: Mutex<Option<bool>> = Mutex::new(None);

#[cfg(test)]
thread_local! {
    static FORCED: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// Makes the probe answer `answer` on this thread (None: ask the system), for tests of a system with or without it.
#[cfg(test)]
pub fn force_probe(answer: Option<bool>) {
    FORCED.with(|f| f.set(answer));
}

/// Whether this system decodes HEIC: Some once the system has answered, None while it has not (and will be asked
/// again).
fn probe() -> Option<bool> {
    #[cfg(test)]
    if let Some(answer) = FORCED.with(|f| f.get()) {
        return Some(answer);
    }
    let mut known = PROBED.lock().unwrap_or_else(|e| e.into_inner());
    if known.is_some() {
        return *known;
    }
    let answer = match decode_rgba(PROBE.to_vec()) {
        Ok(img) => Some(img.dimensions() == (64, 32)),
        Err(f) if f.definite => Some(false),
        Err(_) => None,
    };
    *known = answer;
    answer
}

/// Whether this system decodes HEIC, as far as it has said.
pub fn codec_present() -> bool {
    probe() == Some(true)
}

/// Whether the probe has never been answered while a decode is stuck: busy, not missing.
pub fn stalled() -> bool {
    #[cfg(test)]
    if FORCED.with(|f| f.get()).is_some() {
        return false;
    }
    let known = *PROBED.lock().unwrap_or_else(|e| e.into_inner());
    stalled_given(known, STUCK.load(Ordering::SeqCst))
}

fn stalled_given(known: Option<bool>, stuck: usize) -> bool {
    known.is_none() && stuck > 0
}

struct Com;

impl Com {
    fn enter() -> Result<Com, Failure> {
        // SAFETY: called on a thread of our own, left by `Drop` on the same thread.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| Failure::now(e.message()))?;
        Ok(Com)
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: pairs the successful CoInitializeEx in `enter`, on the same thread.
        unsafe { CoUninitialize() };
    }
}

/// The picture in `bytes` as RGBA, through WIC on this thread, refused before its pixels are allocated when the
/// decoder's size is past the budget. WIC applies the item's `clap` and `irot` itself.
fn wic_rgba(bytes: &[u8]) -> Result<RgbaImage, Failure> {
    let _com = Com::enter()?;
    // SAFETY: plain COM calls on interfaces this function owns; `bytes` outlives the stream that reads it, and the
    // buffer CopyPixels fills is sized from the stride and height it is given.
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| Failure::now(e.message()))?;
        let stream = factory
            .CreateStream()
            .map_err(|e| Failure::now(e.message()))?;
        stream
            .InitializeFromMemory(bytes)
            .map_err(|e| Failure::now(e.message()))?;
        let decoder = factory
            .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)
            .map_err(decoder_failed)?;
        let frame = decoder.GetFrame(0).map_err(decoder_failed)?;
        let (mut w, mut h) = (0u32, 0u32);
        frame.GetSize(&mut w, &mut h).map_err(decoder_failed)?;
        within_budget(w, h)?;
        if w == 0 || h == 0 {
            return Err(Failure::now("the decoder found no picture"));
        }
        let rgba = WICConvertBitmapSource(&GUID_WICPixelFormat32bppRGBA, &frame)
            .map_err(decoder_failed)?;
        let mut px = vec![0u8; w as usize * h as usize * 4];
        rgba.CopyPixels(std::ptr::null(), w * 4, &mut px)
            .map_err(decoder_failed)?;
        RgbaImage::from_raw(w, h, px).ok_or_else(|| Failure::now("a short pixel buffer"))
    }
}

/// Workers past their timeout and not yet returned. While one is, no new decode starts: a decoder that hangs on one file
/// keeps one thread and its buffers, never a pile of them.
static STUCK: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Job {
    Running,
    Done,
    Abandoned,
}

/// Marks the job done when the worker ends, returned or panicked, and lets go of the stuck count if it was given up on.
struct Finish {
    job: Arc<Mutex<Job>>,
    stuck: &'static AtomicUsize,
}

impl Drop for Finish {
    fn drop(&mut self) {
        let mut job = self.job.lock().unwrap_or_else(|e| e.into_inner());
        if *job == Job::Abandoned {
            self.stuck.fetch_sub(1, Ordering::SeqCst);
        }
        *job = Job::Done;
    }
}

/// `work` on a worker thread of its own, given up on after `timeout`; refused while a worker counted in `stuck` has not
/// returned.
fn run_bounded<T: Send + 'static>(
    stuck: &'static AtomicUsize,
    timeout: Duration,
    work: impl FnOnce() -> Result<T, Failure> + Send + 'static,
) -> Result<T, Failure> {
    if stuck.load(Ordering::SeqCst) > 0 {
        return Err(Failure::now(
            "the system's decoder has not finished an earlier picture; open this again once it has",
        ));
    }
    let job = Arc::new(Mutex::new(Job::Running));
    let finish = Finish {
        job: Arc::clone(&job),
        stuck,
    };
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("marxy-wic".into())
        .spawn(move || {
            let _finish = finish;
            let _ = tx.send(work());
        })
        .map_err(|e| Failure::now(e.to_string()))?;
    match rx.recv_timeout(timeout) {
        Ok(answer) => answer,
        Err(RecvTimeoutError::Disconnected) => Err(Failure::now(
            "the system's decoder stopped without an answer",
        )),
        Err(RecvTimeoutError::Timeout) => {
            let mut state = job.lock().unwrap_or_else(|e| e.into_inner());
            if *state == Job::Done {
                drop(state);
                return rx.try_recv().unwrap_or_else(|_| {
                    Err(Failure::now(
                        "the system's decoder stopped without an answer",
                    ))
                });
            }
            *state = Job::Abandoned;
            stuck.fetch_add(1, Ordering::SeqCst);
            Err(Failure::now(format!(
                "the system's decoder took more than {} seconds",
                timeout.as_secs()
            )))
        }
    }
}

/// `wic_rgba` on a worker thread (COM is entered there, never on a Tauri thread), bounded by `DECODE_TIMEOUT`.
fn decode_rgba(bytes: Vec<u8>) -> Result<RgbaImage, Failure> {
    run_bounded(&STUCK, DECODE_TIMEOUT, move || wic_rgba(&bytes))
}

fn reads_heic(extension: &str, head: &[u8]) -> bool {
    crate::facts::is_heic(head)
        || (matches!(extension, "heic" | "heif" | "hif") && head.len() >= 12)
}

/// HEIC through the system's decoder, when the probe found one.
pub struct Wic;

impl Decoder for Wic {
    fn reads(&self, extension: &str, head: &[u8]) -> bool {
        reads_heic(extension, head)
    }

    fn decode(&self, file: File) -> Result<Vec<u8>, String> {
        let _turn = Turn::take();
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        if len > MAX_INPUT_BYTES {
            return Err(format!(
                "{len} bytes, past the {MAX_INPUT_BYTES} read whole"
            ));
        }
        let mut bytes = Vec::with_capacity(len as usize);
        rewound(file)?
            .take(MAX_INPUT_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        decode_bytes(bytes)
    }
}

/// The PNG of the HEIC in `bytes`: its coded size (each tile's, for a grid) judged before the system's decoder sees
/// it, then decoded there.
fn decode_bytes(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let layout = crate::facts::heic_layout(&mut Cursor::new(&bytes))
        .map_err(|e| e.to_string())?
        .ok_or("no primary image")?;
    within_budget(layout.coded_width, layout.coded_height)?;
    within_pixels(layout.coded_pixels)?;
    match probe() {
        Some(true) => {}
        Some(false) => return Err(crate::facts::HEIC_WINDOWS_WHY.into()),
        None if stalled() => return Err(crate::facts::HEIC_STALLED_WHY.into()),
        None => return Err("the system's decoder did not answer; open this again".into()),
    }
    // WIC applies the item's `clap`, `irot` and `imir` itself, in the item's order: the pixels come out as the facts'
    // orientation says, so nothing is turned here.
    png_of(DynamicImage::ImageRgba8(
        decode_rgba(bytes).map_err(|f| f.why)?,
    ))
}

pub static WIC: Wic = Wic;

#[cfg(test)]
mod tests {
    use super::*;
    use image::metadata::Orientation;
    use image::ImageFormat;

    fn png_pixels(png: &[u8]) -> RgbaImage {
        image::load_from_memory_with_format(png, ImageFormat::Png)
            .unwrap()
            .to_rgba8()
    }

    /// Adds an `irot` or `imir` property after `bytes`' item's others, keeping `mdat` where it is by shrinking `free`.
    fn with_transform(bytes: &[u8], kind: &[u8; 4], value: u8) -> Vec<u8> {
        let mut b = bytes.to_vec();
        let at = |b: &[u8], t: &[u8]| b.windows(4).position(|w| w == t).unwrap() - 4;
        let size = |b: &[u8], o: usize| u32::from_be_bytes(b[o..o + 4].try_into().unwrap());
        let put = |b: &mut Vec<u8>, o: usize, v: u32| b[o..o + 4].copy_from_slice(&v.to_be_bytes());
        let (meta, iprp, ipco, ipma) = (
            at(&b, b"meta"),
            at(&b, b"iprp"),
            at(&b, b"ipco"),
            at(&b, b"ipma"),
        );
        let count_at = ipma + 18;
        let ipma_end = ipma + size(&b, ipma) as usize;
        let index = boxes_in(&b[ipco + 8..ipco + size(&b, ipco) as usize]) + 1;
        b.insert(ipma_end, 0x80 | index);
        b[count_at] += 1;
        let n = size(&b, ipma);
        put(&mut b, ipma, n + 1);
        let ipco_end = ipco + size(&b, ipco) as usize;
        let mut prop = 9u32.to_be_bytes().to_vec();
        prop.extend_from_slice(kind);
        prop.push(value);
        b.splice(ipco_end..ipco_end, prop);
        for (o, grow) in [(ipco, 9), (iprp, 10), (meta, 10)] {
            let n = size(&b, o);
            put(&mut b, o, n + grow);
        }
        let free = at(&b, b"free");
        let n = size(&b, free);
        put(&mut b, free, n - 10);
        b.drain(free + 8..free + 18);
        assert_eq!(b.len(), bytes.len());
        b
    }

    fn boxes_in(b: &[u8]) -> u8 {
        let (mut at, mut n) = (0, 0u8);
        while at + 8 <= b.len() {
            at += u32::from_be_bytes(b[at..at + 4].try_into().unwrap()) as usize;
            n += 1;
        }
        n
    }

    fn need_codec() -> bool {
        if !codec_present() {
            eprintln!("skipped: this system has no HEIC decoder (HEIF and HEVC extensions)");
        }
        codec_present()
    }

    /// The probe's pixels as stored, turned by `orientation`: what the page should show.
    fn expected(orientation: u16) -> RgbaImage {
        let mut img = DynamicImage::ImageRgba8(RgbaImage::from_fn(64, 32, |x, _| {
            if x < 32 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            }
        }));
        img.apply_orientation(Orientation::from_exif(orientation as u8).unwrap());
        img.to_rgba8()
    }

    fn red(p: &image::Rgba<u8>) -> bool {
        p.0[0] > 200 && p.0[2] < 60
    }

    fn same_halves(got: &RgbaImage, want: &RgbaImage) {
        assert_eq!(got.dimensions(), want.dimensions());
        let (w, h) = got.dimensions();
        for (x, y) in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)] {
            assert_eq!(
                red(got.get_pixel(x, y)),
                red(want.get_pixel(x, y)),
                "at {x},{y}"
            );
        }
    }

    #[test]
    fn the_probe_names_heic_and_a_decode_is_upright_at_its_cropped_size() {
        assert!(Wic.reads("heic", PROBE));
        assert!(Wic.reads("bin", PROBE));
        assert!(!Wic.reads("avif", b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf"));
        let layout = crate::facts::heic_layout(&mut Cursor::new(PROBE))
            .unwrap()
            .unwrap();
        assert_eq!((layout.width, layout.height), (64, 32), "clap crops");
        assert_eq!((layout.coded_width, layout.coded_height), (68, 34));
        if !need_codec() {
            return;
        }
        let img = png_pixels(&decode_bytes(PROBE.to_vec()).unwrap());
        same_halves(&img, &expected(1));
    }

    /// The decoded pixels agree with the facts' orientation whichever order the item lists its turn and its mirror in.
    #[test]
    fn irot_and_imir_in_either_order_come_out_as_the_facts_say() {
        if !need_codec() {
            return;
        }
        let cases = [
            vec![(b"irot", 1)],
            vec![(b"imir", 0)],
            vec![(b"imir", 1)],
            vec![(b"irot", 1), (b"imir", 0)],
            vec![(b"imir", 0), (b"irot", 1)],
            vec![(b"irot", 3), (b"imir", 1)],
        ];
        let mut seen = Vec::new();
        for case in cases {
            let file = case
                .iter()
                .fold(PROBE.to_vec(), |b, (kind, v)| with_transform(&b, kind, *v));
            let layout = crate::facts::heic_layout(&mut Cursor::new(&file))
                .unwrap()
                .unwrap();
            let got = png_pixels(&decode_bytes(file).unwrap());
            same_halves(&got, &expected(layout.orientation));
            seen.push(layout.orientation);
        }
        assert_eq!(
            seen[3], seen[4],
            "the turn comes before the mirror, as Windows draws it"
        );
    }

    /// A HEIC declaring 100,000 x 100,000 is refused from its boxes, before the system's decoder is asked for anything,
    /// and so is one that `clap` crops to 100 x 100, since the decoder fills the coded size.
    #[test]
    fn a_heic_past_the_pixel_budget_is_refused_before_decoding() {
        use crate::facts::isobmff::tests::{clap_box, heif_items, heif_sized, ispe_box};
        let started = std::time::Instant::now();
        let err = decode_bytes(heif_sized(b"heic", 100_000, 100_000)).unwrap_err();
        assert!(err.contains("past the 67108864"), "{err}");
        let cropped = heif_items(
            &[(
                1,
                b"hvc1",
                vec![ispe_box(100_000, 100_000), clap_box(100, 100)],
            )],
            &[],
        );
        let err = decode_bytes(cropped).unwrap_err();
        assert!(err.contains("past the 67108864"), "{err}");
        let tile = |id| (id, b"hvc1", vec![ispe_box(8000, 8000)]);
        let grid = heif_items(
            &[(1, b"grid", vec![ispe_box(100, 100)]), tile(2), tile(3)],
            &[2, 3],
        );
        let err = decode_bytes(grid).unwrap_err();
        assert!(err.contains("past the 67108864"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_truncated_or_broken_heic_is_an_error_not_a_panic() {
        for cut in [0, 12, 40, 200] {
            assert!(decode_bytes(PROBE[..cut].to_vec()).is_err(), "cut at {cut}");
        }
        if need_codec() {
            let mut junk = PROBE.to_vec();
            let n = junk.len();
            junk[n - 40..].fill(0xAA);
            let _ = decode_bytes(junk);
        }
    }

    #[test]
    fn a_probe_never_answered_while_a_decode_is_stuck_is_busy_not_missing() {
        assert!(stalled_given(None, 1));
        assert!(!stalled_given(None, 0), "not yet asked, nothing stuck");
        assert!(
            !stalled_given(Some(false), 1),
            "the system said it has no codec"
        );
        assert!(!stalled_given(Some(true), 1));
    }

    #[test]
    fn with_the_probe_forced_absent_a_decode_says_what_would_draw_it() {
        force_probe(Some(false));
        let err = decode_bytes(PROBE.to_vec()).unwrap_err();
        force_probe(None);
        assert_eq!(err, crate::facts::HEIC_WINDOWS_WHY);
    }

    #[test]
    fn a_worker_past_its_timeout_holds_off_new_decodes_until_it_returns_and_a_panic_is_said_as_one()
    {
        static STUCK_HERE: AtomicUsize = AtomicUsize::new(0);
        let short = Duration::from_millis(50);
        let err = run_bounded(&STUCK_HERE, short, || {
            std::thread::sleep(Duration::from_millis(400));
            Ok(())
        })
        .unwrap_err();
        assert!(
            err.why.contains("took more than") && !err.definite,
            "{err:?}"
        );
        let refused = run_bounded(&STUCK_HERE, short, || Ok(1)).unwrap_err();
        assert!(
            refused.why.contains("has not finished an earlier picture"),
            "{refused:?}"
        );
        let started = std::time::Instant::now();
        while STUCK_HERE.load(Ordering::SeqCst) > 0 {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "the worker never let go"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(run_bounded(&STUCK_HERE, short, || Ok(2)).unwrap(), 2);
        let panicked = run_bounded(
            &STUCK_HERE,
            Duration::from_secs(5),
            || -> Result<(), Failure> { panic!("a decoder that panics") },
        )
        .unwrap_err();
        assert!(
            panicked.why.contains("stopped without an answer"),
            "{panicked:?}"
        );
        assert_eq!(STUCK_HERE.load(Ordering::SeqCst), 0);
    }
}
