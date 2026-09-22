# 13 — Release: artifacts, signing, notices, the about document, and the v1 checklist

Phase 4 (`docs/plan.md`). MARXY-16 ships v0.0.1 as an unsigned pre-release from the existing
`.github/workflows/release.yml`; this document is what that workflow becomes by v1.0
(MARXY-52), what "notices and attributions" means in a reader with no chrome, how budgets are
tightened (MARXY-53), and the v1 gate (MARXY-54).

## Artifacts

| Platform | Artifact | Built by | Notes |
| --- | --- | --- | --- |
| macOS 13+, Apple silicon | `marxy_<v>_aarch64.dmg` | `tauri-action`, `--target aarch64-apple-darwin` | signed + notarized + stapled |
| macOS 13+, Intel | `marxy_<v>_x64.dmg` | `--target x86_64-apple-darwin` on `macos-latest` (cross) | separate DMG, not universal: each stays inside `bundle_installed_mb.macos` and is measured on its own |
| Linux x86_64 | `marxy_<v>_amd64.AppImage` | `tauri-action`, `--bundles appimage` | |
| Linux x86_64 | `marxy_<v>_amd64.deb` | `--bundles deb` | `depends` = `libwebkit2gtk-4.1-0 (>= 2.44)`, `libgtk-3-0` |
| Linux x86_64 | `marxy_<v>_x86_64.flatpak` | `flatpak-builder` + `flatpak build-bundle` in a second job | single-file bundle; not on Flathub in v1 |
| all | `SHA256SUMS` | the release job's last step | one line per artifact; the release body lists the file |

No updater, no update check, no crash reporter, in any artifact (ADR-0009 §4). `tauri.conf.json`
`plugins.updater` stays absent; a test in `scripts/verify-release.mjs` fails if the built
binary contains the string `tauri-plugin-updater`.

## macOS signing and notarization

`tauri-action` already reads the six `APPLE_*` secrets. Needed from a human, once
(`orchestration/needs-human.md` already asks): an Apple Developer account, a Developer ID
Application certificate exported as base64 `.p12` (`APPLE_CERTIFICATE`), its password, the
signing identity string, an app-specific password for notarization, and the team id.

- Hardened runtime on; entitlements file `apps/desktop/src-tauri/entitlements.plist` with
  **only** `com.apple.security.cs.allow-jit` (WebKit's JavaScriptCore JIT). No network client
  entitlement is needed outside the App Sandbox, and marxy does not use the App Sandbox in v1
  (sandboxed apps cannot read an arbitrary file named on the command line without a user-selected
  bookmark, which breaks `marxy file.md`).
- The workflow **fails** on a tag matching `v1.*` if any `APPLE_*` secret is empty. Pre-1.0 tags
  may still ship unsigned, as today.
- Verification step on the macOS runner after the build: `spctl --assess --type open --context
  context:primary-signature -v <dmg>` and `xcrun stapler validate <dmg>`; both must pass for a
  `v1.*` tag.

## Linux

- **AppImage** and **deb** from `tauri-action` as today. The AppImage runs on the WebKitGTK the
  host provides; the weight offset follows the host's version (§05), so no special casing.
- **Flatpak**: manifest `packaging/flatpak/dev.marxy.app.yml`, runtime `org.gnome.Platform`
  pinned to the newest stable branch whose WebKitGTK is ≥ 2.50 (record the branch and its
  WebKitGTK version in the manifest's header comment; the weight offset table in §05 must have
  a row for that version). The module installs the release binary built in the Linux job
  (artifact hand-off), the `.desktop` file, the icons and the AppStream metainfo
  (`packaging/flatpak/dev.marxy.app.metainfo.xml`, licence `MIT`, content rating none).
  `finish-args`:

  ```
  --socket=wayland --socket=fallback-x11 --share=ipc --device=dri
  --filesystem=home          # read and save documents where they are
  --filesystem=xdg-config/marxy:create --filesystem=xdg-data/marxy:create
  ```

  **No `--share=network`.** A Flatpak marxy cannot fetch remote images even after consent
  (ADR-0027). `fetchRemoteImage` then fails with `unsupported`, and the image notice says so once:
  "This copy of marxy has no network access (Flatpak). Images from other sites cannot be loaded."
  A reader who wants them runs `flatpak override --user --share=network dev.marxy.app`; the
  README says so. The sandbox enforcing the promise is worth more than badges.

## Notices and the about document

The app has no about window and no menu item that opens one. "About marxy" is a **palette
command** that opens a bundled document, `about.md`, in Rendered mode, read-only (it is compiled
into the frontend bundle as text and opened as a buffer whose path is `marxy:about`; `Mod+S` on
it is a no-op with a notice). It is a real markdown
document, so the reader sees the attribution typeset like everything else:

```
# marxy <version>

A markdown reader. MIT licence. No telemetry. Nothing phones home.

## Typefaces
Literata … (OFL-1.1, Reserved Font Name) · JetBrains Mono … (OFL-1.1)

## Built with
Tauri (MIT/Apache-2.0) · CodeMirror (MIT) · Shiki core (MIT) · KaTeX (MIT) · justif (…) · mdast/micromark (MIT)

## Third-party notices
<generated: every npm package and Rust crate in the shipped build, grouped by licence, with each
licence text once and its copyright lines>
```

- `scripts/notices.mjs` generates `THIRD_PARTY_NOTICES.md` (repo root, committed, the file GitHub
  shows) and `apps/desktop/src/about/about.md` (bundled into the frontend) from the same data
  `scripts/gate-licences.mjs` resolves: the pnpm production dependency closure of
  `apps/desktop`, `Cargo.lock` crates reachable from the `marxy` binary (`cargo metadata`
  `resolve` walk, no dev-dependencies), and `fonts/*/LICENSE` for the two bundled faces
  (only the faces the default theme ships; review-#0 alternatives are not bundled).
- CI runs `node scripts/notices.mjs --check`: regenerate to a temp file and fail on any
  difference, so a dependency change that forgets the notices goes red. The licence gate and the
  notices share one resolver (`scripts/lib/licences.mjs`, extracted from the gate) so they cannot
  disagree about what ships.
- Licence text sources, in order: the package's own `LICENSE*`/`COPYING*` file; for crates, the
  `~/.cargo/registry/src` copy; SPDX text from `spdx-license-list-data` is **not** a source (it has
  no copyright line). A package with no licence file fails `--check` with its name.

## Budgets before v1 (MARXY-53)

Exactly as the CSV states it, with the procedure fixed so it can be run by an agent:

1. `node scripts/measure-startup.mjs --reference --runs 5` on the reference machine (the author's Mac;
   `needs-human.md`), per corpus document the budget file names. Product budget := ceil(1.2 ×
   median). Record `derived_from` as `{ commit, machine, date, runs_n }`.
2. For each CI runner class: take `observed_warm_ms` from five `ci` workflow runs on five distinct
   `main` commits (`gh run list --workflow ci --branch main --json databaseId,headSha`, then the
   `results/perf.json` artifact of each). Baseline := max of the five. `cold_envelope_ms` recomputed
   from the fresh `observed_cold_ms` with the unchanged multiplier.
3. `node scripts/gate-perf.mjs --selftest` and the cross-run invariant
   `(max/min of observed_warm_ms) × tolerance ≤ 1.20` must hold; if it does not for a runner class,
   that class keeps its old baseline and the PR says why (never widen a tolerance to pass).
4. Bundle: `bundle_installed_mb` := ceil(measured × 1.1) per platform from the v0.x release that
   precedes the PR; the measured sizes come from `scripts/verify-release.mjs` output.

A helper `scripts/tighten-budgets.mjs --from <run ids…> --reference <file>` does steps 2–4 and
prints the diff; the human part is step 1 only.

## The v1 gate (MARXY-54)

v1.0.0 is tagged when every row is true, and the PR that bumps the version pastes this table
with evidence links:

| Check | Evidence |
| --- | --- |
| All Phase 1–3 stories done; no story `in_review` | board export |
| Taste review #3 decided (dark, notices, opt-in); every queue row older than it has a decision | `docs/taste-review/queue.md` |
| Tier 2 blind side-by-side passed on a Mac and on a Linux laptop (ADR-0014) | `docs/taste-review/review-4/decisions.md`, first reactions verbatim |
| Signed, notarized DMGs verified by `spctl`; AppImage, deb and Flatpak install and open `02-readme-real-world.md` on Ubuntu 24.04 and Fedora 42 | release workflow run; a human's checklist in `needs-human.md` |
| Budgets tightened (MARXY-53) and green on `main` | CI run |
| `THIRD_PARTY_NOTICES.md --check` green; about document opens from the palette | CI run; screenshot |
| No network: `gate:no-network` over the packaged renderer, and `nettop`/`strace -f -e trace=network` over a 60 s scripted session with no consent given shows zero sockets | gate log; the trace attached |
| README states the four promises (MIT, no telemetry, nothing phones home, never touches a byte) and how to allow images in the Flatpak | README diff |

## Tests

- `scripts/verify-release.mjs` (from MARXY-16) grows: artifact list per platform present;
  `SHA256SUMS` matches; the updater string absent; the `marxy <version>` heading of `about.md` present in each bundle's JS; sizes
  within `bundle_installed_mb`.
- `scripts/notices.test.mjs`: a fixture lockfile with an MIT package, an Apache crate and an OFL
  font produces the expected sections; a package without a licence file fails.
- Flatpak job: `flatpak run dev.marxy.app --version` inside the CI container prints the version;
  `flatpak info --show-permissions` has no `network` line.
