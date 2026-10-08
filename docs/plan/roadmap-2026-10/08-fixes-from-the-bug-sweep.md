# 08 — Lane F: fixes from the bug sweep

**Date:** 2026-10-07 · **Status:** current · **Read with:** `00-orchestration.md`, `progress.md`.

**Abstract.** Two sweep waves outside the repository filed 23 findings against `af61a675` and
`12aca959`. The sweepers were weak agents, so the lead re-verified every finding against `a7cde730`
by running something: a repro script, a throwaway WebKit test, or a mutation that a test should
have caught. 21 reproduce and 2 do not. The 21 become eleven stories in lane F. The stories that touch
`app.ts` or `selection/view.ts` run before B-12, because B-12 to B-15 move that code and a reader
bug should not wait for a refactor. The rest have their own paths and run beside lane B.

Story ids are `F-nn`. Commitlint passes `(F-01)` as a plain parenthetical; no tooling change is
needed.

## Verdicts

| Finding | What a reader sees | Verdict at `a7cde730` | Story |
| --- | --- | --- | --- |
| S-07-0001 | Text typed after Jump to source is not saved, and the next Mod+E discards it with no undo | confirmed, **data loss** | F-03 |
| S-04-0003 | Copying a code line over 1000 characters adds "… N more characters" to the clipboard | confirmed | F-01 |
| S-01-0001 | A link's `&sol=`, `&amp=`, `&lt=` and `&gt=` query parameters are rewritten | confirmed | F-02 |
| S-07-0002 | Leaving Source after an edit jumps to the top of the document (worse than filed) | confirmed | F-04 |
| S-08-0001 | A file that opens in Source reopens at the first byte; markdown saved in Source reopens elsewhere | confirmed | F-04 |
| S-08-0002 | Quitting from Source stores the wrong place | confirmed (the cause differs from the one filed: in Source the window scrolls, not `.cm-scroller`) | F-04 |
| S-05-0001 | A byte inside a block restores to the bottom of that block | confirmed in core; latent in the app until S-07-0002 is fixed | F-04 |
| S-05-0003 | The "within one line" place check accepts any fraction | confirmed, test only | F-04 |
| S-02-0001 | Resizing the window moves the reading block (540 px in the test) | confirmed | F-04 |
| S-04-0002 | A link to a heading that is not mounted yet never scrolls (long documents, same page or another document) | confirmed; the claimed `startsWith` throw did not reproduce | F-05 |
| S-04-0001 | Alt+Shift+Up on a link in a top-level paragraph does not select the paragraph | confirmed | F-06 |
| S-05-0002 | Math in a heading is missing from the outline | confirmed | F-07 |
| S-06-0002 | Enter in an open outline lands on the wrong heading, or none, after another document opens | confirmed | F-07 |
| S-06-0001 | The palette drops a recent folder's file once 50 other files match | confirmed, ranking only | F-08 |
| S-03-0001 | A failed read of `trust.json` lets the next grant erase every other grant | confirmed, latent (needs an I/O error) | F-09 |
| S-03-0002 | The trust LRU-cap test passes with the cap removed | confirmed, test only | F-09 |
| S-04-0004 | The jump-to-source test passes with the scroll removed | confirmed, test only | F-03 (strengthened there) |
| S-07-0003 | The mode round-trip tests assert the offset they were given | confirmed, test only | F-04 |
| S-07-0004 | The editorconfig browser test never reads the tab size | confirmed, test only | F-10 |
| S-02-0003 | `slash-break.test.ts` is never run, and its ceiling sums a prose table | confirmed, test only | F-10 |
| S-02-0002 | A reflow inside the paragraph under the reading line moves the text by lines, while the block top stays still | confirmed (via `resetChanged`); rarer | F-11 |
| S-01-0002 | `foldText` drops carriage returns | **not a bug**: the editor keeps CR as content for CR and mixed files, so the fold never sees LF-normalised text; a real CodeMirror round trip kept every CR | — |
| S-01-0003 | Align table pipes splits a cell on a pipe in a code span | **not a bug**: GFM splits cells on unescaped pipes inside code spans, tags and links; the parser yields the same cells | — |

## Order

- **Third wave:** F-14 before B-12; F-15 before C-11; F-16 any time.
- **Now, beside lane B (own paths):** F-01, F-02, F-06, F-07, F-08, F-09.
- **The `app.ts` chain, before B-12:** F-03 → F-04 → F-05 → F-12 → B-12. F-10 runs beside it.
- **After B-02.8** (same file, `packages/typeset/src/index.ts`): F-11.
- **After F-05, before B-12:** F-12 (`source-view.ts`, `app.ts` teardown).

## Stories

### F-01 — Copy a long code line without the elision note

**Model:** sonnet · **Size:** XS · **Paths:** `apps/desktop/src/selection/copy-text.ts`, a copy test.
Add `marxy-elided` to the copy skip set. Acceptance: a real selection across a 1500-character line copies
exactly the source line; a shorter line copies unchanged.

### F-02 — Keep a link's query parameters as written

**Model:** sonnet · **Size:** S · **Paths:** `packages/core/src/sanitize/escape.ts`, `urls.ts`, their tests.
Decode to a fixed point only to check the scheme; emit the href as the browser would read the attribute.
Acceptance: `&sol=`, `&amp=`, `&lt=` and `&gt=` survive through the real pipeline; doubled references
that hide `javascript:` are still refused.

### F-03 — Keep what you type after Jump to source

**Model:** opus · **Size:** S · **Paths:** `commands/source-view.ts`, `source/mode-open.ts`, `app.ts`
(the single Source entry only), jump-to-source tests. One way into Source: the jump goes through the app's
`showSource`, so the mode, the fold, the dirty state and undo all see the editor. Acceptance: jump, type,
Mod-S writes exactly the edit; the edit survives Mod+E twice and Mod+Z undoes it; the jump test reads a
real landing on a long document (S-04-0004).

### F-04 — Keep the place across modes, resize and reopen

**Model:** opus · **Size:** M · **Depends on:** F-03 · **Paths:** `apps/desktop/src/app.ts`,
`apps/desktop/src/source/mode-switch.ts`, `apps/desktop/src/position/*`, `packages/core/src/position/blocks.ts`
and its tests, desktop place tests, and the mode round-trip tests (`source/mode-switch.test.mjs`,
`source/harness-entry.ts`, `source/source-browser.test.mjs`), which must measure the real landing (S-07-0003).
- One Source reading-position helper that reads the window scroll and the reading line (in Source the
  window scrolls; `.cm-scroller.scrollTop` is always 0). Leaving Source after an edit, quit, `pagehide`
  and the scroll listener use it, and record mode `source` (S-07-0002, S-08-0002).
- `finishDocumentOpen` passes the restored byte to `showSource`, and a markdown file saved in Source
  restores its place (S-08-0001).
- `blockForByteOffset` returns the block that contains the byte, as `restore.ts`'s `blockAt` does
  (S-05-0001); `sameFirstVisibleBlock` compares `dFraction × block height` with the line height, and both
  tests gain a pair a block apart (S-05-0003).
- Resize saves the position, relays out, waits for `ready`, and restores, as `relayoutKeepingReader`
  already does for theme and size (S-02-0001).
- `listenForReaderScroll`'s window `wheel` listener is removed when the anchor is released. B-02.8 found that
  any wheel listener makes WebKit repaint the whole page after every layout (+25 % on a 1 MB document's
  `content_complete`); the app's listener is never removed, so a document opened deep (reload, `at`) still pays.
Acceptance: each bullet has a WebKit or Node test that fails on `a7cde730`; `persist-reading`,
`scroll-persistence`, `source-mode-shell`, `keep-place` and `large-document` green.

### F-05 — A link to a heading not yet mounted still lands

**Model:** sonnet · **Size:** S · **Depends on:** F-04 · **Paths:** `apps/desktop/src/selection/view.ts`,
`apps/desktop/src/render/progressive.ts` (if `ensureThrough` is needed), `app.ts` (the fragment hand-off),
`links.test.mjs`/`progressive.test.mjs`. On a miss, mount through the target (or wait for content
complete) and keep the fragment until found; capture the fragment value in the frame callback. Also clear
the Jump-to-source carrier (`__marxyJumpCarrier`) when another document opens: today a click in document A
survives the open of B and the jump lands at a meaningless offset (F-03 review, sequence K).
Acceptance: same-page and cross-document links to a late heading in a 5000-paragraph document land.

### F-06 — Alt+Shift+Up from an inline selects its block

**Model:** sonnet · **Size:** XS · **Paths:** `apps/desktop/src/selection/selection.ts`,
`apps/desktop/test/selection.test.mjs`. An inline resolves to its enclosing block; only a block walks to its
parent. The list-item-to-list case still passes.

### F-07 — The outline shows math, and Enter lands on the heading it marks

**Model:** sonnet · **Size:** S · **Paths:** `packages/core/src/outline/outline.ts` and its test,
`apps/desktop/src/outline/view.ts`, `apps/desktop/test/outline.test.mjs`. `mathInline` contributes its TeX
source; `refresh` computes the current heading before it sets the selected row.

### F-08 — Recent folders survive the palette's cap

**Model:** sonnet · **Size:** S · **Paths:** `apps/desktop/src/palette/search.ts` and its test. Rank the
recent root inside the capped heap (or one heap per recent root). Acceptance: 51 equal matches in a
non-recent root do not push out the recent folder's file.

### F-09 — A failed trust read never erases grants

**Model:** sonnet · **Size:** S · **Paths:** `apps/desktop/src/trust/trust.ts`, `trust.test.ts`. Only
not-found starts empty; any other read failure leaves the store unpersisted (the controller already
handles a null store). The LRU-cap test drives the real store with a recording writer and fails when the cap
is removed.

### F-10 — Two tests that can fail

**Model:** sonnet · **Size:** S · **Paths:** `apps/desktop/test/tab-width.test.mjs`,
`packages/typeset/test/slash-break.test.ts` and the package test script. The round trip reads the real
landing; the tab-width test reads `.cm-content`'s computed `tab-size`; the slash-break ceiling runs in a
script `pnpm test` executes and is computed from a run, not a prose table. Each is mutation-checked. (The mode
round-trip tests, S-07-0003, moved to F-04, which rewrites the helper they cover.)

### F-11 — The words under the reading line stay when their own paragraph reflows

**Model:** opus · **Size:** S–M · **Depends on:** B-02.8 · **Paths:** `packages/typeset/src/index.ts`,
typeset tests. `keepPlace` anchors to a point inside the block under the reading line (a line box or a
caret range) when the block is taller than the reading band. Acceptance: markers written above the reading
line inside that paragraph leave the text at the reading line within one line.

### F-12 — Toggle line numbers is not a second way into Source

**Model:** sonnet · **Size:** S · **Depends on:** F-05 · *From the F-03 review.* · **Paths:**
`apps/desktop/src/commands/source-view.ts`, `apps/desktop/src/app.ts` (`teardownDocument` only), a Source test.
`view.toggle-line-numbers` calls `createSourceEditor({ parent: host, buffer })` itself when no editor is active,
and `teardownDocument` empties `#marxy-source` without destroying a shared editor the app does not own; after
another open, Jump to source or Mod+E shows an empty Source (mode `source`, no lines). Nothing is typeable, so
nothing is lost, but it breaks "one way into Source". The command records the preference and, if Source is
showing, asks the app to reconfigure its editor; teardown destroys `activeSourceEditor()`. Acceptance: toggle in
Rendered, open another document, Jump to source: the editor shows the new document's lines. Also from the F-04
review: `repaint` calls `sourceEditor.replaceBuffer(snap.buffer)` unconditionally, so a handle-level `commitEdit`
(or an app-level undo from the palette) while Source holds unfolded text drops that text from the editor (the
store's bytes are untouched; reproduced on main). `repaint` folds or keeps unfolded Source text first.

## Flaky under load

`apps/desktop/test/variant-render.test.mjs` failed four times in local `pnpm precheck` runs on 2026-10-07
("Promise resolution is still pending but the event loop has already resolved") with the machine at load 25–70,
on branches that do not touch it, and passed alone each time. CI has not shown it. AGENTS.md: a flaky test is
fixed or deleted. If CI ever shows it, it becomes a story; until then, it is recorded here.

The same day, `packages/core test` failed three times inside local `pnpm precheck` under load (F-02, C-03, C-01
branches, none touching the failing area) with a bare `diff: 'simple'` assertion line, and passed alone each time.
The slowest core test (`splice is identity and X-local over every node of 32-long-reference.md`, about 420 s alone
on a loaded machine) is the first suspect. Same rule: a story if CI shows it.

### F-13 — Say so when trust settings cannot be read, and try again

**Model:** sonnet · **Size:** S · **Depends on:** F-09 · *From the F-09 review.* · **Paths:**
`apps/desktop/src/trust/controller.ts`, `apps/desktop/src/trust/trust-copy.ts`, a trust test.
After F-09 a failed read of `trust.json` fails closed (nothing trusted, nothing overwritten), but the reader is
not told: `load()` sets `store = null` with no notice, and `grantHtml` returns early while the grant offer is
still on screen, so "Allow HTML" does nothing (honest; nothing hidden silently). The failure is also sticky for
the session, though EMFILE or EAGAIN are transient. On load failure, notify once ("Marxy could not read its
trust settings, so nothing is trusted this session."); on the next `grantHtml` with no store, retry the load
once, and notify again if it still fails. Acceptance: a rejected read shows the notice; a grant after a
transient failure retries and persists; a grant after a second failure writes nothing and says so.

## The third wave (2026-10-07, evening)

Sweeps S-09 to S-12 filed six findings against `986a082a` (packets P-19 to P-23 outside the repository). The lead
re-verified each against `75b0358a` with a repro: a Rust test on the real scan and diff, a node test on the real
functions, or the rewritten CSS loaded in WebKit with every request to the remote host aborted. Four are real, one
is real but contrived, one cannot be reached.

| Finding | What a reader sees | Verdict at `75b0358a` | Story |
| --- | --- | --- | --- |
| S-10-0001 | In a README in a subfolder, `/assets/x.png` and `../img/x.png` show no image; an in-repository `../other.md` link is refused as outside the folder | confirmed: `pathsForDocument` returns the document's folder as the image root, though ADR-0027 §5 says the repository root (the index service already knows it) | F-14 |
| S-09-0001 | A document opened through a symlink goes stale when its target is edited, and nothing is said when the link is deleted | confirmed (Rust and JS repros); the cross-directory drop the finding blames on `tauri.ts` went with C-05, and the event now dies at `samePath`. Reached by following a link or by history; argv, drop and the palette canonicalise or omit links | F-15 |
| S-09-0002 | — (the symlink reload test passes through a `cfg(test)` helper that canonicalises; production does not) | confirmed, test only | F-15 |
| S-12-0001 | A theme can carry a remote image past the loader inside a raster `data:` URL broken by a raw newline; WebKit parses the rest as a live rule | confirmed at the text level, **latent**: the shipping CSP's `img-src` refuses the request. Breaks the loader's promise (`05-theme.md` §Loader) and would phone home if the CSP ever loosened | F-16 |
| S-09-0003 | An outside rewrite that keeps inode, size and mtime is not reloaded | confirmed but contrived (`cp -p` from a same-size file stamped identically, or two same-size in-place writes in one millisecond); no editor does this. Not fixed: catching it costs a hash of the open file on every wake-up | — |
| S-10-0002 | A watch event could read and list a `.gitignore`d file outside a nested root whose name looks like a file (`notes.d`) | first judged **not reachable** (no walker produces such a path); **wrong**: C-11's watch events reached it. Fixed in C-11 with one strict `pathUnder` in core | C-11 |

### F-14 — Images and links in a nested document resolve against the repository root

**Model:** sonnet · **Size:** M · **Depends on:** none; **before B-12** (it touches the link guard in
`selection/view.ts`) · **Paths:** `apps/desktop/src/render/images.ts`, `apps/desktop/src/startup/idle-work.ts`,
`apps/desktop/src/selection/view.ts` (the relative-link guard only), image and link tests.
`pathsForDocument` gives the image root as the document's directory. Resolve it as ADR-0027 §5 says: the
repository root the document is indexed under (`rootFor` in the index service, the nearest `.git`), else the
document's directory. `stripNonLocalImages` runs on the first-text path and is synchronous: it must not strip a
`/x` or `../x` image before the root is known (the `marxyDone` flag makes a strip permanent). The asset scope
widens to the repository root, which is what the ADR decided; say so in the PR. Acceptance (each fails today): in
`/repo/docs/readme.md` with `.git` at `/repo`, `/assets/logo.png` loads `/repo/assets/logo.png`; `../diagram.png`
loads `/repo/diagram.png`; `../../etc/x.png` is still refused; `allowAssetScope` is called with `/repo`; a
`../README.md` link from `/repo/docs/a.md` opens; a document with no repository keeps today's behaviour.

### F-15 — A document opened through a symlink reloads, and says when the link is gone

**Model:** sonnet · **Size:** M · **Depends on:** none · **Before C-11** (same watcher) · **Paths:**
`apps/desktop/src-tauri/src/watch/mod.rs` (and `tree.rs` if the recursive watch has the same gap), the
`effect_for_open_document` test helper, `apps/desktop/test/live-reload.test.mjs`.
`scan_entries` keeps `is_file()` entries only, and `DirEntry::metadata` does not follow links, so a link is never
in the snapshot. Record a symlink that resolves to a file under its link path, with the target's identity
(`fs::metadata` follows), so an edit of the target is `Modified` on the link and deleting the link is `Removed`.
Make the test helper the production comparison (or delete it and assert on the real events). Acceptance: open
`docs/link.md` → `docs/real.md`, edit `real.md`: an event names `link.md` and the page reloads; the same with the
target in another directory; delete the link: the removal notice shows; a plain file behaves as today; the Rust
symlink test fails if the comparison is slash-normalising only.

### F-16 — A theme's `data:` image cannot hide a remote URL

**Model:** sonnet · **Size:** S · **Depends on:** none · **Paths:** `packages/theme/src/css-urls.ts`,
`packages/theme/src/css-urls.test.ts`, a loader test. **Review:** Opus (privacy).
`findParenClose` counts raw parentheses and ignores quotes and newlines; the CSS tokenizer ends a quoted string at
a raw newline and closes `url(` at the next `)`. Reject a `data:` body containing a raw `\n`, `\r`, `\f`, a quote,
a parenthesis or a backslash after unquoting (real base64 and percent-encoded rasters contain none), with a
warning; apply the same newline rule to the relative-path branch. Acceptance (each fails today):
`url("data:image/png,(AA\n)}b{background:url(https://evil.example/p.png)}")` leaves no `evil.example` in the
output and records a warning, for double and single quotes, unquoted, `\r`, `\f` and inside `image-set`; an
ordinary base64 png passes unchanged; `data:image/svg+xml` is still removed; `loadTheme` on such a theme returns a
warning and no remote host.

### F-15.1 — A renamed symlink target says the link is gone

**Model:** sonnet · **Size:** S · **Depends on:** F-15 · *From the F-15 review.* · **Paths:**
`apps/desktop/src-tauri/src/watch/mod.rs`, its tests.
A link's snapshot entry carries its target's inode, so `mv elsewhere/real.md elsewhere/moved.md` pairs by inode and
reports `Renamed{docs/link.md → elsewhere/moved.md}`: the open document silently retargets to a file in another
directory while the link itself now dangles. A link entry never pairs as a rename; a link whose target vanished is
`Removed` on the link path. While there: `diff`'s rename search can give two `Renamed` events one `to` (skip a `to`
already used), and the extra roots (target parents) are computed once at open, so a link retargeted into a new
directory relies on the 200 ms poll; say so in a comment. Acceptance: renaming the target of an open link shows the
removal notice; renaming a plain open file still follows it.

### F-16.1 — The theme loader escapes the asset URL it inserts

**Model:** sonnet · **Size:** S · **Depends on:** F-16 · *From the F-16 review.* · **Paths:**
`packages/theme/src/css-urls.ts`, its tests.
The final substitution writes the caller's `assetUrl(path)` into `url("…")` escaping only `"`: a backslash or a line
break in the result can end the string early. Unreachable in Tauri (`convertFileSrc` percent-encodes); the loader
should not rely on that. Escape `\` and `\n`/`\r`/`\f` for a CSS string (or refuse such a result with a warning).
While there, `image-set` string candidates lose their `type()` and resolution descriptors (pre-existing); keep them
if the change is small. Acceptance: a callback returning `a\` or `a\nb){x:url(https://evil.example/q)}` yields one
url token and no remote URL outside a string; ordinary results are byte-identical.

### F-17 — A document with only images finishes opening

**Model:** sonnet · **Size:** S · **Depends on:** none · *From the F-14 review, reproduced on main.* · **Paths:**
`apps/desktop/src/app.ts` (the boot branch only), `apps/desktop/src/startup/` if the cause is there, a desktop test.
A document with no text characters gets `no_text` from `waitForFirstText`, and `bootDocument` calls `finish(1)`,
skipping `finishDocumentOpen`: a local image keeps its raw `src` and never loads, and with two image blocks `start`
never resolves. The reader sees a half-open document (no images, probably no watch and no saved place). Fix the boot
so such a document finishes opening while measurements stay honest about there being no text. Acceptance: one local
image loads; two image blocks resolve `start` and register the watch; an empty file behaves as today. Runs beside
B-12 (same file): keep the change local to the boot branch.

From the same review, smaller: the link refusal says "outside this folder" where it now means the repository (B-12
may carry it); a refused image has no visible mark (commitment 4; a story with E-lane image work); the
`await resolveImageRoot` in idle work is untested.

### F-17.1 — Tell an empty file from a text-less one by its source

**Model:** sonnet · **Size:** S · **Depends on:** F-17, and after B-13 (the boot code moves) · *From the F-17
review.* · **Paths:** `apps/desktop/src/startup/measure.ts`, the boot branch, a desktop test.
F-17 continues a `no_text` open when `evidence.blocks > 0`, but `blocks` counts only h1–h6, p, pre, ul, ol, table
and blockquote. A lone `---` or `***`, an HTML comment alone, front matter alone (a `<dl>`, real text reported as
`no_text`) and a lone `<div>` still end with `finish(1)`: no watch and no saved place, as on main. Decide "empty" by
the source bytes or the parse (zero non-white-space bytes, or no blocks in the AST), not by the rendered selector,
and widen the evidence selector so front matter counts as text. The `no_text` mark stays honest (ADR-0032).
Acceptance: each of the five documents above opens with a watch; front matter alone reaches `first_text`; an empty
file is unchanged.

