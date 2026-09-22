---
key: MARXY-52
design: [14-release, 06-shell]
depends: [MARXY-16, MARXY-45]
verify: [pnpm precheck, pnpm done MARXY-52]
---
# MARXY-52 — Signed, notarized macOS DMGs; AppImage, deb and Flatpak; notices and the about document

**Design:** [14-release](../../design/14-release.md) (all sections but Budgets and The v1 gate) · **Depends on:** MARXY-16 (v0.0.1 workflow and `verify-release.mjs`), MARXY-45 (final CSP/capabilities, so the notarized binary is the final one) · **Human-gated:** the Apple secrets (`orchestration/needs-human.md`). Everything else is doable without them; the `v1.*` signing check is written now and fires only on a `v1.*` tag.

**Outcome.** A tag produces two Mac DMGs that open with no Gatekeeper warning, an AppImage, a deb and a Flatpak with no network permission, plus `SHA256SUMS`. "About Marxy" in the palette opens a typeset document crediting the typefaces and every dependency, generated from the same resolver the licence gate uses.

## Files and signatures
- `.github/workflows/release.yml` — Intel DMG matrix row; the `v1.*` secrets check; `spctl`/`stapler` verification; a `flatpak` job (container `ghcr.io/flathub-infra/flatpak-github-actions:gnome-<branch>`) consuming the Linux job's binary artifact; `SHA256SUMS`; `verify-release.mjs` on every artifact.
- `apps/desktop/src-tauri/entitlements.plist` (JIT only); `tauri.conf.json` `bundle.macOS.entitlements`, `hardenedRuntime: true`; `bundle.linux.deb.depends` per §13.
- `packaging/flatpak/dev.marxy.app.yml`, `dev.marxy.app.metainfo.xml`, `dev.marxy.app.desktop`.
- `scripts/lib/licences.mjs` — the resolver extracted from `gate-licences.mjs` (the gate imports it; its self-check must still pass unchanged).
- `scripts/notices.mjs` + `scripts/notices.test.mjs`; outputs `THIRD_PARTY_NOTICES.md` and `apps/desktop/src/about/about.md` (committed); CI step `node scripts/notices.mjs --check` in `ci.yml`'s fast job.
- `apps/desktop/src/commands/app.ts` — `about` command: opens `about.md`, imported into the frontend bundle as text (Vite `?raw`), as a buffer with the path `marxy:about` (read-only by §01 §Save step 3). No shell member is needed.
- `apps/desktop/src-tauri/src/main.rs` — `--version` prints `marxy <version>` and exits 0 before creating a window.
- `README.md` — the four promises and the Flatpak image note (§13).

## Do this, in order
1. Resolver extraction (no behaviour change; gate self-check green).
2. `notices.mjs` + `--check` + test; generate and commit both outputs.
3. `--version`; about command; read-only save refusal (§01 §Save step 3 — if MARXY-49 has landed, add the path check there; otherwise leave a failing-test TODO for 49 in "For the reviewer").
4. Release workflow: Intel row, Flatpak job, sums, verification, `v1.*` secrets check.
5. Cut `v0.9.0-rc.1` from `main` to exercise the whole workflow unsigned (allowed pre-1.0); attach the run URL.

## Tests → expected
| Check | Expect |
| --- | --- |
| `notices.test.mjs` | §13 Tests row |
| `notices.mjs --check` | green on the PR; add a dependency without regenerating → red |
| release run on the rc tag | five artifacts + `SHA256SUMS`; `verify-release.mjs` green for each |
| Flatpak job | `flatpak run dev.marxy.app --version` prints the version; `flatpak info --show-permissions` has no `network` |
| harness: `about` command | a document opens whose first heading is `marxy <version>`; `Mod+S` → the read-only notice, no write recorded |
| `v1.0.0-test` tag on a fork with empty secrets (or a dry-run input) | the workflow fails at the secrets check |

## Acceptance → check
CSV: Gatekeeper opens the DMG with no override → `spctl` step on a `v1.*` tag (human-gated; until secrets exist the PR states it is unverified and the needs-human entry stays open); Flatpak installs from the bundle → Flatpak job; about surface credits Literata, JetBrains Mono, Tauri → about harness case + a grep over `about.md`; notices generated in CI → `--check`.

## Do not
Add an updater or any network call. Use the App Sandbox. Give the Flatpak `--share=network`. Commit any secret or certificate.
