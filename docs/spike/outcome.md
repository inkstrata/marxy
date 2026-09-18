# Stack spike — outcome

**Date:** 2026-09-18 · **Rule applied:** `stack-decision-rule.md` (committed 00:15, before any code)
**Decision: Tauri.** Recorded as ADR-0010.

## What was measured

The spike code lives at `~/Dev/marxy-spike` (throwaway; `SPIKE.md` there explains how to
run it). Of the five planned measurements, **M1 (WebKitGTK weight fidelity) is the only one
that could change the stack under the rule**, and it was run first:

- Specimen page: Literata (variable, wght 200–900) and iA Writer Quattro (variable, wght
  400–700) at requested weights 300–700 in 50-unit steps, 17px and 34px, set twice per weight
  (`font-weight` and `font-variation-settings`).
- Rendered by WebKitGTK 2.52.6 via the Tauri shell and by Chromium 152 via the Electron shell on
  Ubuntu 26.04 (OrbStack, Xvfb at 2× scale, default fontconfig), and on macOS 26.6 by Playwright
  WebKit (CoreText, the same rasteriser as WKWebView) and by Electron.
- Metric: ink coverage per sample, inverse-interpolated on the macOS curve for the same face,
  size and scale → *effective weight*. Offset = effective − requested.

## Result

Effective-weight offset versus macOS WebKit, Literata, `font-weight` (the fvs series is identical):

| Engine on Linux | 17px @400 | @500 | @600 | @700 | 34px @400 | @600 |
| --- | --- | --- | --- | --- | --- | --- |
| **WebKitGTK 2.52.6, Ubuntu 26.04 (Tauri)** | −67 | −78 | −90 | −56 | −13 | −20 |
| Chromium 152, Ubuntu 26.04 (Electron) | −74 | −87 | −104 | −70 | −62 | −85 |
| **WebKitGTK 2.50.6, Debian 12 (Tauri)** | −118 | −133 | −154 | −120 | −55 | −67 |
| Chromium 152, Debian 12 (Electron) | −88 | −103 | −120 | −84 | −62 | −85 |

Two distributions, two WebKitGTK versions, same Chromium: WebKitGTK sits within 12 units of
Chromium on Ubuntu and about 30 units lighter than Chromium on Debian at reading size, and
both engines render lighter on Debian than on Ubuntu (distribution fontconfig defaults differ).

Calibration: Electron on macOS versus Playwright WebKit on macOS is −7 to −10, so two
different engines on the same rasteriser agree to within ten units.

Three things follow:

1. **The reported defect (~100 units heavier) does not reproduce** on WebKitGTK 2.52 with the
   Skia backend. At reading size WebKitGTK is *lighter* than macOS, by the same amount Chromium
   is. At 34px WebKitGTK is ~50 units heavier than Linux Chromium but still slightly lighter
   than macOS.
2. **The macOS–Linux difference is a property of macOS** (CoreText dilation), not of WebKitGTK,
   because Electron shows the same gap. Any shell would need the same per-platform weight
   adjustment to look identical across platforms; that adjustment is *upward* on Linux, which
   every variable font can do. Quattro cannot go below 400, which only matters if the direction
   were the other way; it is still a reason to prefer a wide-axis body face (ADR-0015).
3. **T1 passes, with compensation.** Versus macOS the Linux build needs roughly +75 on
   WebKitGTK 2.52 and +125 on 2.50 at body size (less at heading size), all inside Literata's
   200–900 axis with the result still below 900 at 700. The magnitude varies with the WebKitGTK
   version and the distribution's fontconfig, so `--marxy-weight-offset` must be keyed to the
   runtime WebKitGTK version (Tauri exposes it) with a per-distribution override, and story
   MARXY-022 measures it on real desktops. Against Chromium on the same machine, the difference
   is 12–34 units: within or just over the threshold, and in either case the same shape of
   fix Electron would have needed versus macOS.

## What was not measured, and why that is acceptable

- **M3 cold start** on the target machine was not run. Under the rule it can only move the
  outcome if Electron is more than 1.25× faster *and* Tauri misses the 500 ms budget. The
  budget is enforced as a CI gate on the real application from Phase 0 (ADR-0013), on the
  actual bundle with fonts and grammars, which is the only startup number that matters.
  The one same-app benchmark in the literature found a 40 ms difference; the budget is 500 ms.
- **M4 CodeMirror and M5 index** were captured for WebKitGTK (`results/`), not analysed; the
  Rust index libraries (`ignore`, `nucleo`, `notify`) were already the reason to want a Rust
  core, and Electron would have needed them via `napi-rs` anyway.
- The user judged the remaining Electron half of the spike not worth its cost once M1 was
  in. The rule was written so that M1 alone could decide in Tauri's favour; it did.

## Residual risk, recorded honestly

- Xvfb with default fontconfig is not a GNOME or KDE desktop. Hinting (`hintslight`),
  subpixel AA and FreeType stem darkening are desktop settings that change stem weight.
  The bug reports came from real desktops. **Re-run the harness on a real Linux desktop
  in Phase 1** (story MARXY-1xx in the plan); A1 is downgraded from critical to medium, not closed.
- Only WebKitGTK 2.52 (Ubuntu 22.04–26.04 all ship 2.50–2.52 as security updates; Debian 12
  ships 2.50.6). The brainstorm's "2.36 on older distros" is stale. Debian 12 capture is
  in `results/` if the background run completed.
- One typeface pair. The harness takes any font; re-run when the face changes.

## Context numbers, excluded from the rule by design

Tauri release binary 8.9 MB; assembled Electron app 289 MB. Tauri first release build on the
M5: 1m05s incremental after dependencies; the Linux build compiles ~400 crates (~12 min in the VM).

## Images

`results/u26-tauri-specimen-17-dpr2-off0.png` (WebKitGTK), `results/u26-electron-specimen-17-dpr2-off0.png`
(Chromium/Linux), `results/mac-pwwebkit-specimen-17-dpr2-off0.png` (macOS WebKit). The
reading-size block at the bottom of each is what to look at. `results/summary-2026-09-18.md`
is the analyser's full output.
