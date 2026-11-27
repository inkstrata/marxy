# 01 Release mechanics (read-only probe of origin/main b16c76b3, 2026-11-26)

**Bottom line.** A tag push today would run `release.yml`, which still works in principle on the post-#773 tree: every path and script it calls exists (`build:web`, `gate:bundle`, `apps/desktop`). It builds one macOS arm64 DMG, ad-hoc signed (`signingIdentity "-"`), not notarised, and publishes it as a non-draft pre-release. It has not run since v0.1.0 (2026-10-07), and no dry run has been done on the new tree. Nothing in the workflow gates on `ci`, so a tag on a red main would publish anyway. The blockers are: main's CI is red on macOS (REL-01), the versions are all still 0.1.0 and the next tag is undecided (REL-02), and a dry run of the release workflow is needed first (REL-03). The SHOULD items are a zombie `nightly` workflow, no CHANGELOG or release notes, and unverified licence notices in the bundle. The release procedure in docs matches reality only for Windows.

## Findings

### REL-01 [BLOCKER] main CI is red on macOS, and `frame.test.mjs` is a repeatable failure, not a documented flake
- Run 45920645748 (push, b16c76b3): macos failed, windows passed. Failing test: "the top bar says what the bytes are…" in `apps/desktop/src/source/frame.test.mjs:77`, `page.waitForSelector` timeout 90000ms (`gh run view 45920645748 --log-failed`, step unit-desktop-browser).
- The same test failed earlier on macOS in run 45900475778 (bc2942f8) with a 30 s timeout, so the timeout was raised and it still fails. It appears in neither `work/STATE.md` "Flaky under load" (line 84) nor M4/M5 in `work/todo.md` (lines 21-22). It cannot be called a known flake.
- It is a loop of 8 cases, each booting a page and waiting for `#marxy-source .cm-line`. The first case that never renders would eat the whole budget.
- Run 45914709878 (986340ba) failed differently: the `build` step's `smoke-cli-open` (apps/desktop/scripts/smoke-cli-open.mjs) wanted `source=frame` on `MARK painted` and the app logged `signal=frames-only source=frame`, then `MARK no_paint reason=not-visible` and `quit code=1`. This looks like a hosted-runner timing problem with a hidden window. It was not reproduced afterwards.
- The only green main-bound run is 881fd9b9 (PR, 00:30), so both platforms can pass.
- Smallest fix: another investigator owns the macOS browser failures. For release, either fix the cause of the `.cm-line` wait, or move this file out of the macOS `--only` list in `ci.yml` (`unit-desktop` and `unit-desktop-browser`) with a M-row in `work/todo.md`, as was done for the 14 M4 files. Do not tag until `ci` is green on the commit to be tagged, twice in a row.
- Also (REL-01b): PR #774's macOS check is FAILURE right now (`gh pr view 774`).

### REL-02 [BLOCKER] Versions are consistent at 0.1.0 and name a release that already exists; decide the tag
- `apps/desktop/src-tauri/tauri.conf.json:4` "0.1.0"; `apps/desktop/src-tauri/Cargo.toml:3` 0.1.0 (`Cargo.lock:2663` agrees); `apps/desktop/package.json:3` 0.1.0. The root `package.json:4` and `packages/{core,shell-api,typeset,theme}/package.json:3` are 0.0.0 (private workspace packages, harmless).
- No `--version` flag and no About box of Marxy's own: `main.rs:1346` uses `PredefinedMenuItem::about(app, None, None)`, which shows Tauri's package version from tauri.conf.json. I found no frontend `getVersion` call. So the menu About is the only place a user sees the number.
- v0.1.0 exists as a pre-release (assets: `Marxy_0.1.0_aarch64.dmg`, 9.4 MB) built from the archived architecture. Re-tagging `v0.1.0` would collide with it, so the version must move.
- Recommendation: tag **v0.2.0** (pre-1.0, a whole new codebase, a new minor), still a pre-release because it is ad-hoc signed. Bump the three 0.1.0 files together plus `Cargo.lock`, in one PR, before tagging. The release workflow takes its name from the tag, but the DMG file name and About box come from tauri.conf.json, so a mismatch ships silently. A tag-vs-conf check is cheap (REL-04).
- Note the "Latest" badge on GitHub is currently the Archive release; a pre-release will not take it. Decide whether v0.2.0 should be a normal release, which means `prerelease: false` in release.yml.

### REL-03 [BLOCKER] The release workflow has never run on the reader architecture; do a dispatch dry run first
- `release.yml` trigger: `push: tags: ['v*']` and `workflow_dispatch`. History (`gh run list --workflow release.yml`): 3 failed then 2 successful dry runs 2026-10-03, success on tag v0.1.0 push 2026-10-07 (6m55s). No run since #773.
- A dispatch builds the DMG and uploads it as an artifact, with no tag or release (`tagName` empty). Nothing else needs to change; it is the safe rehearsal. It needs to run on a branch carrying the version bump from REL-02. It exercises the sealed-bundle `codesign --verify`, `gate:bundle` with `MARXY_BUNDLE_REQUIRED=1` and the 30 MB macOS budget (`fixtures/perf-budgets.json`), none of which has been measured on the new app. I could not measure the new DMG size here (no build; read-only).
- I did not trigger it (read-only brief).

### REL-04 [SHOULD] The workflow never checks that CI passed or that the tag matches the version
- The `release` job has no `needs`, no check of `ci` on the tagged commit and no version check. Smallest fix: first step `test "$(jq -r .version apps/desktop/src-tauri/tauri.conf.json)" = "${GITHUB_REF_NAME#v}"` (tag pushes only).

### REL-05 [SHOULD] `nightly` is a zombie scheduled workflow, failing daily
- `gh api actions/workflows` lists only `ci` and `release`, but 13 daily `nightly` runs (2026-11-14 to 11-26, cron `0 4 * * *`) fail, all on sha 41289f32, the old head of main. That sha has `.github/workflows/nightly.yml` (workflow id 362562145, jobs aesthetics-determinism, built-app-smoke on Ubuntu 26.04). #773 deleted the file from main (`git log -- .github/workflows` shows b16c76b3 as the last change), but GitHub keeps scheduling the cached definition.
- Failure is `built-app-smoke`, exit code 100 (an apt step, "Process completed with exit code 100"), unrelated to the new code. Nothing on main reads it.
- Why it matters for release: it adds a red daily failure badge/emails, and its ADR references (ADR-0032/0047/0056) belong to the archived system. Smallest fix: `gh workflow disable nightly -R inkstrata/marxy` (owner action; I did not run it), or restore a nightly file that makes sense.

### REL-06 [SHOULD] Licence and notices in the bundle: not verified, probably not shipped
- `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md` (root) and `apps/desktop/THIRD_PARTY_NOTICES.md` exist; `fonts/` has `LICENSE` and `THIRD_PARTY_NOTICES.md`. README line 80 points at the notices.
- `tauri.conf.json` has no `resources`, and a grep of `apps/desktop/src/notices/*.ts` and `scripts/gate-licences.mjs` found no reference to `THIRD_PARTY_NOTICES` being embedded. I could not confirm whether the app shows notices (there is `src/commands/notices.ts`, which looks to be about config notices, not licences). The OFL 1.1 and MIT of bundled dependencies need the notice text to travel with the binary.
- `pnpm gate:licences` is in the CI macOS and Windows steps (`licences` in `--only`), so the dependency licence policy is checked, but it checks policy, not the bundle's contents.
- Smallest fix: inspect the DMG from the REL-03 dry run for the notices, or add `bundle.resources` for the two notice files and `LICENSE`.

### REL-07 [SHOULD] No CHANGELOG or release notes; the release body is a single stale sentence
- No `CHANGELOG*`, no `docs/release*`. The `releaseBody` in `release.yml` says "Pre-release. The macOS build is ad-hoc signed, not notarized: open it with right-click, Open the first time." Right-click Open does not work on macOS 15 and later, and on macOS 26 (Darwin 25 here) you need System Settings, Privacy and Security, Open Anyway, or the quarantine strip.
- Smallest fix: write a short release body (what the reader is, what is new since v0.1.0, known limits such as M4/M5, macOS-only DMG) and replace the Gatekeeper sentence with the `xattr -dr com.apple.quarantine /Applications/Marxy.app` command that `docs/development.md:19-21` already gives.

### REL-08 [SHOULD] README has no install section for a downloaded build
- `README.md` covers `pnpm install` and `pnpm --filter @marxy/desktop bundle` (lines 30-33); nothing about downloading a release, Gatekeeper (ad-hoc, quarantine), or Windows SmartScreen. The only Gatekeeper note is one sentence in `docs/development.md` (line 19-21), in the toolchain table's paragraph.
- Windows: the release workflow builds no Windows artifact at all. The Windows NSIS installer is made and signed (self-signed or Azure) locally with `pnpm work installer` (`docs/development.md` "Signing (Windows)"); self-signed means SmartScreen and an untrusted-publisher prompt for any user who is not Ian. State this in the release notes, or ship macOS only.
- Smallest fix: a short "Install a release" section in README: macOS 13+, arm64 only (no Intel build), the quarantine command; Windows: not published.

### REL-09 [LATER] Platform and bundle gaps
- `tauri.conf.json` `bundle.targets` lists dmg, appimage, deb, nsis; the workflow overrides with `--bundles dmg` and a single `aarch64-apple-darwin` row. No Intel Mac, no Linux (`release.yml` comment says Linux has never been built), no Windows in CI. Fine for a pre-release; say so.
- No Apple Developer ID or notarisation. The workflow supports `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (names only), exporting each only when set; I did not read the repo's secret list (no access), so I cannot say whether any exist. With none set the build is ad-hoc signed.
- App icon: `apps/desktop/src-tauri/icons/` has icns, ico and PNGs; bundle id `dev.marxy.app`; category Productivity; min macOS 13.0. These are unchanged from v0.1.0. Whether the icon is final art is a design call I did not assess.

### REL-10 [LATER] Docs describe no release procedure
- `docs/development.md` (build, Signing (Windows), "An installer of a ref") and `docs/working.md` do not mention tags, the release workflow or `releaseDraft`/pre-release. A grep of README/AGENTS/docs for "release" finds only build-profile uses. The only procedure lives in comments in `release.yml`, and they are accurate (they describe a tag push building a DMG and publishing a pre-release, dispatch = artifact only). Smallest fix: five lines in `docs/development.md` under a "Releasing" heading, copied from the list below.
- `docs/development.md` still says macOS bundles are ad hoc signed (correct) and its toolchain row lists the Windows toolchain only; the macOS installer script (`pnpm work installer` on macOS, PR #774) is not on main yet and its CI is red.

## Tag procedure as it would run today
1. Get `ci` green on main (REL-01), twice, and merge or park PR #774.
2. One PR: bump `tauri.conf.json`, `apps/desktop/Cargo.toml`, `Cargo.lock` (the `marxy` entry) and `apps/desktop/package.json` to 0.2.0; add release notes and the README install section (REL-02, 07, 08).
3. Dry run: `gh workflow run release.yml --ref <branch>` (dispatch), then download the `marxy-dmg` artifact, check the size against 30 MB, open it with `xattr -dr com.apple.quarantine`, confirm notices (REL-03, 06).
4. Merge; `git tag v0.2.0 <main sha> && git push origin v0.2.0` (the owner does this).
5. `release.yml` runs on the tag (about 7 min): `build:web`, tauri-action builds the aarch64 DMG, creates the pre-release "marxy v0.2.0" with the body text, then `codesign --verify` and `gate:bundle`. The DMG is attached before those two checks run, so a failing gate still leaves a published release; delete it if so.
6. Open the published DMG on a clean Mac; promote from pre-release or leave as is.
