# Development

Setting up, running, building and shipping Marxy. Testing and the checks are in
[testing.md](testing.md); how the code fits together is in [architecture.md](architecture.md); how a
change is tracked and carried to `main` is in [working.md](working.md).

## Toolchain

| Need | Version | Notes |
| --- | --- | --- |
| Node | 24 or later | `engines` in `package.json`; tests use `node --test --experimental-strip-types` |
| pnpm | 11.18.0 | `packageManager` in `package.json` |
| Rust | stable, MSVC target on Windows | for `apps/desktop/src-tauri` |
| C/C++ build tools | Visual Studio Build Tools, "Desktop development with C++", on Windows; the Xcode Command Line Tools (`xcode-select --install`) on macOS | `rusqlite` builds SQLite from source |
| WebView2 | ships with Windows 11 | the app's webview, and what `check:tauri` drives |
| Playwright browsers | `pnpm exec playwright install webkit chromium` | WebKit for the browser tests and gates; Chromium for `gate-no-network`, the demo tour and a few tests |
| Python 3 | optional | only `fixtures/media/make-xiph.py` and `fixtures/sheets/make-number-formats.py` |

`mise.toml` pins the same versions for machines that use mise. On Linux the Tauri build also needs the
WebKitGTK development packages (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`). macOS bundles are signed ad hoc only, so a downloaded
build needs its quarantine flag cleared (`xattr -dr com.apple.quarantine /Applications/Marxy.app`).

```bash
pnpm install
```

pnpm's pre and post script hooks are off (`pnpm-workspace.yaml`); `micromark@4.0.2` carries a patch
(`patches/`) that merges adjacent text events in one pass.

## Repository layout

The packages, the app, the fixtures and the tools are mapped in the root [README](../README.md#repository);
each has a `README.md` of its own with its layout, commands and tools, and
[scripts/README.md](../scripts/README.md) says where a tool of each sort lives. The folders beside the
checkout (worktrees, kept builds, the tracker) are in [working.md](working.md#the-workspace).

## Running

### In a browser (fastest loop)

```bash
pnpm --filter @marxy/desktop exec vite --port 1420 --strictPort
```

Open `http://localhost:1420/`. Outside Tauri, `apps/desktop/src/main.ts` boots the whole app over an
in-memory shell (`src/harness/web.ts`, `src/shell/memory.ts`) holding every file of `fixtures/demo/`
under `/demo`, a fake `.git` so the folder counts as one repository, and a sparse 2 GB disk image.

- `?open=<path under fixtures/demo>` opens that file first (default `plans/pg16-upgrade-plan.md`),
  for example `http://localhost:1420/?open=data/release.json`.
- `window.marxy` holds `{ handle, shell }` for inspection.
- Nothing is written to disk; a reload starts over.
- What needs native code comes from stand-ins: database and workbook pages from
  `src/harness/tables-demo.json`, font and media facts from `src/harness/native-facts.ts` (both written
  by Rust tests; see [desktop-shell.md](desktop-shell.md#tests)). There is no open dialog, no system
  opener, no `run_command` and no native menu.
- A file added under `fixtures/demo/` is picked up by Vite's import glob only after `src/harness/web.ts`
  is touched or the server restarts.

The preview tool's launch configurations (`.claude/launch.json`) run this same command.

### As the desktop app

```bash
pnpm --filter @marxy/desktop dev
```

`tauri dev` starts Vite on port 1420 (which must be free) and opens the real window over it, with the
real shell (`src/shell/tauri.ts`).

### The demo build

```bash
pnpm --filter @marxy/desktop build:demo     # apps/desktop/demo-dist, the browser build with the demo files
pnpm --filter @marxy/desktop preview:demo   # serves it on http://localhost:4173/
pnpm --filter @marxy/desktop tour:demo      # drives it in Chromium and prints PASS/FAIL per step
```

## Building

```bash
pnpm --filter @marxy/desktop build    # vite build, release binary, smoke check
pnpm --filter @marxy/desktop bundle   # vite build, release binary and installer
```

| Output | Path |
| --- | --- |
| Front end | `apps/desktop/dist/` (only `index.html` ships; `app.html` is left out) |
| Binary | `apps/desktop/src-tauri/target/release/marxy.exe` (`marxy` on macOS) |
| Windows installer (NSIS, per-user) | `apps/desktop/src-tauri/target/release/bundle/nsis/Marxy_<version>_x64-setup.exe` |
| macOS app and disk image | `apps/desktop/src-tauri/target/release/bundle/macos/Marxy.app`, `bundle/dmg/Marxy_<version>_aarch64.dmg` |

`build` ends with `scripts/smoke-cli-open.mjs`, which launches the binary in harness mode on a corpus
file, an empty file, a missing file and no file, each with its own temporary `MARXY_DATA_DIR`, and
checks the startup marks, the rendered text and that the file's bytes are unchanged. A machine that
delivers no animation frames gives a skip, not a failure; `pnpm --filter @marxy/desktop verify:cli`
(with `MARXY_SMOKE_REQUIRED=1`) makes skips fail.

The packages' own `build` scripts only type-check (`tsc` with `noEmit`); the desktop app is the only
thing `pnpm build` produces.

The Windows installer's file associations are in [desktop-shell.md](desktop-shell.md#file-associations-on-windows);
a new extension with a page goes in `src-tauri/installer-hooks.nsh` (and in `tauri.conf.json` when its row is `associated`).

## Signing (Windows)

Tauri calls `apps/desktop/scripts/sign-windows.mjs` for each file it signs (`signCommand` in
`tauri.windows.conf.json`). `MARXY_SIGN` picks the mode:

| `MARXY_SIGN` | Effect |
| --- | --- |
| unset | left unsigned (every ordinary local build) |
| `self` | signs with a certificate in `Cert:\CurrentUser\My`: `MARXY_SIGN_THUMBPRINT`, else the newest valid certificate named `CN=<MARXY_SELF_SIGN_NAME>` (default `Marxy (self-signed)`). Writes `marxy-self-signed.cer` next to the installer. Timestamp from `MARXY_SIGN_TIMESTAMP` (`none` signs offline). |
| `azure` | Azure Artifact Signing through `signtool` and the Azure dlib; needs `MARXY_SIGN_ENDPOINT`, `MARXY_SIGN_ACCOUNT`, `MARXY_SIGN_PROFILE` and an Azure sign-in |

Any mode but unset fails the build when it cannot sign. `MARXY_SIGNTOOL` and `MARXY_SIGN_DLIB` override
the tool paths; `MARXY_SIGN_LOG` appends one line per signed file.

```bash
pnpm --filter @marxy/desktop sign:self-cert   # create (or reuse) the self-signed certificate
```

The certificate is RSA 3072, five years, with a non-exportable key; `--remove` deletes it. A machine
trusts the build only after the `.cer` is imported into its trusted roots and trusted publishers, which
is a step for the machine's owner.

## An installer of a ref, kept and installed

`pnpm work installer` runs `scripts/installer-macos.mjs` on macOS and `scripts/installer-windows.ps1` on
Windows, with the workspace's paths.

### macOS

```bash
pnpm work installer                                  # origin/main, installed in /Applications and opened
pnpm work installer --ref agent/x --no-launch
pnpm work installer --no-install --dmg               # build and keep the app and the DMG only
```

1. Fetches `origin`, resolves `--ref` (default `origin/main`, else `main`) to a commit and checks it
   out, detached, in `<checkout>-wt/app`, the script's own worktree. A ref that lacks `main` gets it
   merged in there, on no branch; a conflict, or local changes in that worktree, stops the run.
2. `pnpm install` (offline first), the web build, then `tauri build --bundles app` (`app,dmg` with
   `--dmg`; the DMG step drives Finder to lay out its window, so it is off by default).
3. Checks the bundle: `codesign --verify --deep --strict`, sealed resources (`signingIdentity: "-"`
   in `tauri.conf.json`; Apple silicon kills an unsealed bundle at launch), the bundle id and its
   document types.
4. Keeps `Marxy.app.zip` (zipped, so Launch Services never registers it), the DMG if made and a
   `BUILD.txt` in `builds/<date>-<time>-<commit>/` in the main checkout.
5. Unless `--no-install`: asks a running installed Marxy to quit (builds run from `target` folders are
   left alone), swaps the new bundle into `/Applications` (`~/Applications` when that is not
   writable; `--dest` to choose), checks it again, registers it with Launch Services so its file types
   take effect at once and unregisters every other copy of the bundle id (the build folder, old
   worktrees, DMGs once mounted), so Finder's Open With offers only the installed one, and writes a `marxy` command to `~/.local/bin` when that is on the PATH
   (`--cli-dir`, `--no-cli`). `marxy <files>` opens them in the installed app the way Finder would; a
   file of that name the script did not write is left alone. Then opens the app unless `--no-launch`.

The build is ad-hoc signed, not notarized; built on the machine it runs on, it carries no quarantine flag
and opens without a Gatekeeper prompt.

### Windows

```bash
pnpm work installer                                  # main, self-signed, installed for this user and opened
pnpm work installer -Ref agent/round-12 -NoInstall
```

`scripts/installer-windows.ps1` (Windows PowerShell 5.1 or later) does the whole of it:

1. Resolves `-Ref` (default `main`) to a commit and checks it out, detached, in
   `<checkout>-wt/exe`, a worktree that is the script's own. A ref that lacks `main` gets `main` merged
   in there, in a commit on no branch; a conflict stops the run. No branch and no other worktree is
   touched. Local changes in `<checkout>-wt/exe` stop the run too.
2. `pnpm install` (offline first), then sets the signing mode from `-Sign self|azure|none` (default
   `self`, which runs `sign:self-cert` first) and runs `bundle`.
3. Checks the installer's signature: `Valid` for `azure`; for `self`, `Valid` or `UnknownError` (a
   machine that does not trust the certificate yet), by the expected certificate, with a timestamp.
   `NotSigned` or `HashMismatch` fails the run.
4. Copies the installer, the self-signed `.cer` and a `BUILD.txt` (ref, `main`, the commit built, the
   signing result) to `builds/<date>-<time>-<commit>/` in the main checkout (git ignores `builds/`).
5. Unless `-NoInstall`: asks a running installed Marxy to close (builds run from `target` folders are
   left alone), installs silently for this user, checks the installed `marxy.exe`'s signature, and opens
   it unless `-NoLaunch`.

A cold release build takes ten minutes or more; later ones reuse `<checkout>-wt/exe`'s build folder. When a
self-signed result reads `UnknownError`, the script prints the two `Import-Certificate` commands that
make this machine trust the certificate. They add a trusted root, so they are for the machine's owner
to run.

## Environment variables

| Variable | Effect |
| --- | --- |
| `MARXY_DATA_DIR` | one folder for config, data and the webview profile, with its own single-instance identifier |
| `MARXY_QUIT_AFTER_PAINT` | `1`: print startup marks and exit after the first paint (also `--quit-after-paint`) |
| `MARXY_BIN` | the binary the smoke check and `measure-startup.mjs` launch |
| `MARXY_SMOKE_REQUIRED` | `1`: skips in the smoke check fail |
| `MARXY_SIGN` and `MARXY_SIGN_*`, `MARXY_SELF_SIGN_NAME` | signing, above |
| `MARXY_BROWSER_HEADED` | `1`: browser tests show their WebKit window |
| `MARXY_BROWSER_TESTS_REQUIRED` | `1`: a missing WebKit fails browser tests instead of skipping them |
| `MARXY_CHECK_SHOTS` | folder for `check:tauri` screenshots |
| `MARXY_WORKTREES` | the folder `pnpm work` makes worktrees in, in place of `<checkout>-wt` beside the main checkout |
| `MARXY_COMMONMARK_SPEC` | where the CommonMark spec file is read from |
| `MARXY_BLESS` | `1`: `cargo test stand_in` rewrites `src/harness/native-facts.ts` |

Test size knobs and measurement variables are listed in [testing.md](testing.md).

## Common changes

| To add | Do |
| --- | --- |
| An npm package or a Rust crate | add it to `scripts/allowlists/dependencies.json`, then run `node scripts/gate-licences.mjs` and add any missing licence record to `scripts/allowlists/dependency-licences.json` or `crate-licences.json` |
| A `data-marxy-*` attribute, a `marxy:` event, a startup mark or a private `--marxy-*` property | list it in `scripts/registry.json`; `pnpm check` fails otherwise |
| Markup from a string (`innerHTML` and the like) | only in a file listed in `innerHtmlAllowedIn` in `scripts/registry.json`, and only sanitised output |
| A Tauri command | the Rust function, `COMMANDS` in `src-tauri/build.rs`, `generate_handler!` in `main.rs`, the capability in `capabilities/main.json`, the method on `Shell` (`packages/shell-api/src/index.ts`) or on the app's own `AppShell` (`apps/desktop/src/app-types.ts`), its call in `src/shell/tauri.ts`, and its in-memory version in `src/shell/memory.ts` |
| A bundled theme | a look in `packages/theme/src/looks/`, then the sheet writer ([themes-and-type.md](themes-and-type.md#writing-theme-sheets-from-looks)) |
| A file type | its row in the kind registry ([file-kinds.md](file-kinds.md#adding-a-file-type)) |
| A demo file | a file under `fixtures/demo/`, then touch `apps/desktop/src/harness/web.ts` |
| A browser test file | list it in `scripts/verify-map.json` under the source folder it covers |
| A tool | the folder [scripts/README.md](../scripts/README.md#where-a-tool-goes) gives for it, and a line in that level's `README.md` |

## Windows notes

- The repository pins its pnpm version (`packageManager`). Run pnpm from inside the tree it is to act on: a
  pnpm of another version started elsewhere and pointed in with `-C` refuses to run.
- Package scripts written as `VAR=value command` (`verify:cli`, core's stress tests) run under pnpm's own shell
  emulator (`shellEmulator` in `pnpm-workspace.yaml`), because `cmd.exe`, its default on Windows, would not
  set the variable. Write a new script that needs a variable the same way.
- Tests that link a directory fall back to a junction when symlinks are refused (no Developer Mode or privilege), so they run; a few that need a real symlink still skip.
- `git worktree remove` can stop part-way on a pnpm `node_modules`. `pnpm work clean --apply` removes the
  rest of the folder and prunes; by hand, `Remove-Item -Recurse -Force` then `git worktree prune`.
- `pnpm check:tauri` uses the fixed WebView2 debugging port 9333, so only one run can drive a window at a
  time on a machine.
