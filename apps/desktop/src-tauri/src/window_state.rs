//! The main window's size, position and maximised state, kept between launches in `window.json` in the data folder.
//!
//! Not tauri-plugin-window-state (2.5): it puts its file under `app_config_dir` and creates that folder on every save, which
//! under `MARXY_DATA_DIR` is a stray folder in the reader's own profile, and it saves on `RunEvent::Exit`, which `quit_now`'s
//! `process::exit` never reaches. The window is created hidden (tauri.conf.json) and shown here, once it is in place.

use crate::atomic_write::write_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent};

const FILE_NAME: &str = "window.json";

/// How much of the window's top strip must be on a screen for its saved position to be kept: enough to grab and drag.
const GRAB_WIDTH: u32 = 96;
const GRAB_HEIGHT: u32 = 16;

/// The window's normal (not maximised) bounds in physical pixels: outer position, inner size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Saved {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn state_path(data: &Path) -> PathBuf {
    data.join(FILE_NAME)
}

pub fn read(path: &Path) -> Option<Saved> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice::<Saved>(&bytes)
        .ok()
        .filter(|s| s.width > 0 && s.height > 0)
}

pub fn write(path: &Path, saved: &Saved) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(saved)?;
    write_atomic(path, &bytes).map_err(|e| std::io::Error::other(e.to_string()))
}

fn overlap(a_start: i32, a_len: u32, b_start: i32, b_len: u32) -> u32 {
    let start = i64::from(a_start).max(i64::from(b_start));
    let end = (i64::from(a_start) + i64::from(a_len)).min(i64::from(b_start) + i64::from(b_len));
    u32::try_from((end - start).max(0)).unwrap_or(u32::MAX)
}

/// Where the saved bounds go on the screens there are now (work areas). The position is kept only when a screen still holds
/// enough of the window's top strip to grab it; otherwise it is None and the OS places the window on `fallback`. The size is
/// cut to the chosen screen, and a window cut to fit is put at that screen's corner.
pub fn placement(
    saved: &Saved,
    areas: &[Area],
    fallback: Option<Area>,
) -> (Option<(i32, i32)>, (u32, u32)) {
    let need_w = saved.width.min(GRAB_WIDTH);
    let need_h = saved.height.min(GRAB_HEIGHT);
    let holder = areas
        .iter()
        .map(|a| {
            let w = overlap(saved.x, saved.width, a.x, a.width);
            let h = overlap(saved.y, GRAB_HEIGHT.min(saved.height), a.y, a.height);
            (a, w, h)
        })
        .filter(|&(_, w, h)| w >= need_w && h >= need_h)
        .max_by_key(|&(_, w, h)| u64::from(w) * u64::from(h))
        .map(|(a, _, _)| *a);
    let screen = holder.or(fallback).or_else(|| areas.first().copied());
    let size = match screen {
        Some(a) => (saved.width.min(a.width), saved.height.min(a.height)),
        None => (saved.width, saved.height),
    };
    let position = holder.map(|a| {
        if size != (saved.width, saved.height) {
            (a.x, a.y)
        } else {
            (saved.x, saved.y)
        }
    });
    (position, size)
}

/// What the window's events have told us. `prev` is the position before the last move: on Windows maximising reports its
/// move to the screen corner before the window reads as maximised, so the normal position is the one before it.
#[derive(Default)]
struct Tracked {
    cur: Option<(i32, i32)>,
    prev: Option<(i32, i32)>,
    size: Option<(u32, u32)>,
}

static TRACKED: Mutex<Tracked> = Mutex::new(Tracked {
    cur: None,
    prev: None,
    size: None,
});

fn work_area(m: &Monitor) -> Area {
    let r = m.work_area();
    Area {
        x: r.position.x,
        y: r.position.y,
        width: r.size.width,
        height: r.size.height,
    }
}

/// Puts the window where `path` says it was, shows it, and starts tracking its moves. Shows it even when nothing is saved.
pub fn restore_and_show<R: Runtime>(window: &WebviewWindow<R>, path: Option<&Path>) {
    let saved = path.and_then(read);
    let mut seed = Tracked::default();
    if let Some(saved) = saved {
        let areas: Vec<Area> = window
            .available_monitors()
            .map(|ms| ms.iter().map(work_area).collect())
            .unwrap_or_default();
        let fallback = window
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| work_area(&m));
        let (position, (width, height)) = placement(&saved, &areas, fallback);
        if let Some((x, y)) = position {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
        let _ = window.set_size(PhysicalSize::new(width, height));
        seed.cur = position;
        seed.size = Some((width, height));
        if saved.maximized {
            let _ = window.maximize();
        }
    }
    if seed.cur.is_none() {
        seed.cur = window.outer_position().ok().map(|p| (p.x, p.y));
    }
    if seed.size.is_none() {
        seed.size = window.inner_size().ok().map(|s| (s.width, s.height));
    }
    seed.prev = seed.cur;
    if let Ok(mut t) = TRACKED.lock() {
        *t = seed;
    }
    let _ = window.show();

    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(p) if !tracked.is_minimized().unwrap_or(false) => {
            if let Ok(mut t) = TRACKED.lock() {
                t.prev = t.cur;
                t.cur = Some((p.x, p.y));
            }
        }
        WindowEvent::Resized(s)
            if s.width > 0
                && s.height > 0
                && !tracked.is_minimized().unwrap_or(false)
                && !tracked.is_maximized().unwrap_or(false) =>
        {
            if let Ok(mut t) = TRACKED.lock() {
                t.size = Some((s.width, s.height));
            }
        }
        _ => {}
    });
}

/// The bounds to save: the live ones when the window is in its normal state, the tracked ones when it is maximised or
/// minimised (whose live bounds are not the ones to come back to). A minimised window is never saved as minimised.
fn current<R: Runtime>(window: &WebviewWindow<R>) -> Option<Saved> {
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let mut t = TRACKED.lock().ok()?;
    if !maximized && !minimized {
        if let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) {
            t.cur = Some((p.x, p.y));
            t.prev = t.cur;
            if s.width > 0 && s.height > 0 {
                t.size = Some((s.width, s.height));
            }
        }
    }
    let (x, y) = if maximized { t.prev.or(t.cur) } else { t.cur }?;
    let (width, height) = t.size?;
    Some(Saved {
        x,
        y,
        width,
        height,
        maximized,
    })
}

/// Writes the window's bounds to `path`; called on the way out, before the window is destroyed.
pub fn save<R: Runtime>(window: &WebviewWindow<R>, path: &Path) {
    if let Some(saved) = current(window) {
        let _ = write(path, &saved);
    }
}

#[cfg(test)]
mod tests {
    use super::{placement, read, state_path, write, Area, Saved};
    use std::path::Path;

    const SCREEN: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const RIGHT: Area = Area {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1400,
    };

    fn saved(x: i32, y: i32, width: u32, height: u32) -> Saved {
        Saved {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn the_file_lives_in_the_data_folder() {
        assert_eq!(
            state_path(Path::new("/tmp/marxy-data")),
            Path::new("/tmp/marxy-data").join("window.json")
        );
    }

    #[test]
    fn the_file_reads_back_what_was_written_and_nothing_damaged() {
        let dir = std::env::temp_dir().join(format!("marxy-window-state-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = state_path(&dir);
        assert_eq!(read(&path), None, "no file");
        let s = Saved {
            maximized: true,
            ..saved(-1200, 40, 1100, 800)
        };
        write(&path, &s).expect("write");
        assert_eq!(read(&path), Some(s));
        std::fs::write(&path, b"{ not json").expect("damage");
        assert_eq!(read(&path), None);
        std::fs::write(
            &path,
            br#"{"x":0,"y":0,"width":0,"height":600,"maximized":false}"#,
        )
        .expect("zero");
        assert_eq!(read(&path), None, "a zero size is no window");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_window_on_a_screen_that_is_there_comes_back_where_it_was() {
        let s = saved(2100, 120, 1200, 900);
        assert_eq!(
            placement(&s, &[SCREEN, RIGHT], Some(SCREEN)),
            (Some((2100, 120)), (1200, 900))
        );
        // Snapped to the left edge on Windows: the outer position sits a few pixels off screen.
        let snapped = saved(-7, 0, 960, 1000);
        assert_eq!(
            placement(&snapped, &[SCREEN], Some(SCREEN)).0,
            Some((-7, 0))
        );
    }

    #[test]
    fn a_window_on_a_screen_that_is_gone_is_placed_by_the_os_and_fits_the_one_left() {
        let s = saved(2100, 120, 2400, 1300);
        assert_eq!(placement(&s, &[SCREEN], Some(SCREEN)), (None, (1920, 1040)));
        assert_eq!(
            placement(&s, &[], None),
            (None, (2400, 1300)),
            "no screen known: as saved"
        );
    }

    #[test]
    fn a_window_whose_title_strip_is_off_every_screen_is_not_kept_there() {
        assert_eq!(
            placement(&saved(100, -400, 900, 700), &[SCREEN], Some(SCREEN)).0,
            None,
            "above the top"
        );
        assert_eq!(
            placement(&saved(1880, 100, 900, 700), &[SCREEN], Some(SCREEN)).0,
            None,
            "only a sliver at the right edge"
        );
        assert_eq!(
            placement(&saved(1800, 100, 900, 700), &[SCREEN], Some(SCREEN)).0,
            Some((1800, 100)),
            "enough to grab"
        );
    }

    #[test]
    fn a_window_larger_than_its_screen_is_cut_to_it_at_the_corner() {
        let s = saved(1950, 10, 3000, 1600);
        assert_eq!(
            placement(&s, &[SCREEN, RIGHT], Some(SCREEN)),
            (Some((1920, 0)), (2560, 1400))
        );
    }
}
