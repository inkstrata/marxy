---
key: MARXY-22
design: [05-theme]
depends: [MARXY-21]
verify: [pnpm precheck, pnpm done MARXY-22]
---
# MARXY-22 — Run the weight harness on a real Linux desktop and record the offset

**Design:** [05-theme](../../design/05-theme.md) §Weight offset; `~/Dev/marxy-spike/SPIKE.md` · **Depends on:** MARXY-21. **Human-gated:** needs a Linux desktop (see `needs-human.md`).

## Outcome
The table in `offset.ts` holds measured values, and an ADR-0010 follow-up records the measurement.

## Do this
1. Move `marxy-spike/web/src/main.ts`'s `specimenMode` and `tools/measure/*.py` + `tools/analyze.py` into `scripts/weight-harness/` (a Playwright page for the reference capture, the analyser as a uv project), with a README that says: run `scripts/weight-harness/run.sh` on GNOME at 1× and 2×, then on macOS.
2. Run it (a person, per `needs-human.md`), commit the PNGs under `docs/spike/results/desktop-<distro>-<date>/` and the analyser output.
3. Update the table in `offset.ts` and write `docs/adr/0010-stack-tauri.md` → append "Follow-up 2026-xx: measured offsets" (ADRs are append-only; a dated follow-up section is allowed).

## Acceptance → check
Residual |effective − requested| ≤ 25 at 400 and 600 after compensation, from the analyser's summary; the table values in `offset.ts` equal the recorded ones (a test reads both).
