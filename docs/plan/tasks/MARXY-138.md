---
key: MARXY-138
design: [02-render, 06-shell, 09-app-shell]
depends: [MARXY-26, MARXY-25, MARXY-95, MARXY-137]
verify: [pnpm precheck, pnpm done MARXY-138]
---
# MARXY-138 — the asset scope, the reserved box and the blocked-content notice

**Design:** [02-render](../../design/02-render.md) post-passes 3 and 4, [06-shell](../../design/06-shell.md) §Asset protocol and image scoping, [09-app-shell](../../design/09-app-shell.md) §Notices · **Depends on:** MARXY-26 (the core resolver), MARXY-25 (the headless render entry and the baselines), MARXY-95 (`startApp(shell)` and the harness), MARXY-137 (`app.ts` overlap and the baselines) · **ADRs:** ADR-0026, ADR-0027 §5.

> **Revised 2026-09-20, after PR #115 attempt 1 (`7e55ae4`) was returned.** PR #115 stays open; amend
> it, do not cut a new branch and do not close it. The return was **only** about boundary, not the
> feature: the product commit widened this story's own `Paths` cell in `docs/plan/jira-issues.csv` and
> then used that room to touch four other files. The landing story `MARXY-152` puts
> the real widening on `main` first (`docs/plan/deltas/2026-09-20-marxy-138-paths.md`); attempt 2
> rebases on top of it and **must not re-touch `docs/plan/jira-issues.csv` at all** — that file is not
> and never becomes one of this story's paths. Five files join `Files and signatures` below because the
> new PNG fixture genuinely needs them (the licence entry, the fidelity gate's binary exemption, the two
> buffer round-trip tests, the regenerated golden). AC11 ("only the two baselines moved") needs the
> re-submission to state, against `gate:aesthetics`'s own output, whether it re-rasterized `09` and `10`
> and found zero pixel delta, or short-circuited because nothing upstream of the raster changed — "the
> headless path unchanged" was plausible but unverified in the returned attempt.

**Outcome.** A local image loads and the text under it does not move; one line above the article says
which hosts were not loaded. This is the **first story a reader sees anything from**, so it carries a
`docs/taste-review/queue.md` row. The app half of the MARXY-26 split — read
`docs/plan/deltas/2026-09-19-marxy-26-split.md` first.

## Why this story exists in this shape
MARXY-26 escalated because its three criteria all needed files it could not touch. Two of them were
unreachable from core, and the third was *dead on `main`*: `tauri.ts` invoked `allow_asset_scope`, which
`main.rs` never registered, so `assetUrl` threw for every path; `assetProtocol.enable` was `false`; and
nothing called `assetUrl` at all. Those three facts survived typecheck, lint, the unit suite and a
review. Step 3 below is the check that makes the class impossible, and it matters more than the feature.

## Files and signatures
- `apps/desktop/src-tauri/src/commands/fs.rs` — `image_size(path) -> Option<ImageDimensions>` via the
  `imagesize` crate (MIT); `allow_asset_scope(dir) -> Result<(), ShellError>` calling
  `app.asset_protocol_scope().allow_directory(dir, /*recursive*/ true)`. Errors map through `error.rs`:
  `not-found` for a missing path, `invalid` for a path that is not a directory.
- `apps/desktop/src-tauri/src/main.rs` — both names added to `generate_handler!`.
- `apps/desktop/src-tauri/Cargo.toml` — `imagesize`. `Cargo.lock` is an `extraAllowedPaths` file.
- `apps/desktop/src-tauri/tauri.conf.json` — `app.security.assetProtocol.enable = true`, `scope: []`.
  **`csp` is not edited.** `img-src` already carries `asset: http://asset.localhost`; MARXY-45 owns the
  final CSP.
- `apps/desktop/src/shell/tauri.ts` — `imageSize` → `invoke('image_size')`, `allowAssetScope` →
  `invoke('allow_asset_scope')`, `assetUrl = convertFileSrc`, names and signatures exactly as ADR-0026.
  The shape at PR #95's `89709c8` is the intended shape; re-land it wired to the real commands.
- `apps/desktop/src/shell/memory.ts` — the same three for the harness: `imageSize` through core's
  `imageSizeFromBytes`, `allowAssetScope` recording the scope, `assetUrl` refusing a path outside every
  allowed scope. #95's version of this is good work; re-land it.
- `apps/desktop/src/render/images.ts` — `applyImages(article, ctx)`: post-pass 3.
- `apps/desktop/src/notices/index.ts` — `notify({ kind, text, actions?, transient? })`, `dismiss(id)`,
  rendering one line into `#marxy-notices` (§09). `apps/desktop/src/notices/blocked.ts` —
  `blockedContentNotice(result)` from core's `blockedImages`.
- `apps/desktop/src/app.ts` — call `applyImages` after the node map and links, then the notice.
- `apps/desktop/test/images.test.mjs`, `apps/desktop/test/shell-boundary.test.mjs` (extended).
- `fixtures/corpus/image.png` — a real PNG, **1200×400**, under 100 kB. `fixtures/corpus/README.md` gains
  a line saying what it is for.
- `docs/design/06-shell.md` — one sentence: `imageSize` is the Rust `imagesize` crate; core's
  `imageSizeFromBytes` is the pure fallback for the memory shell and the tests only.
- `scripts/allowlists/crate-licences.json` — one entry, `imagesize@0.13.0`, MIT. Nothing else in this
  file changes.
- `scripts/gate-fidelity.mjs` — the new binary `fixtures/corpus/image.png` needs a narrow, named
  exemption from the UTF-8 round-trip precondition the gate otherwise applies to every corpus file
  (a `CORPUS_ASSETS`-shaped allowlist of the exact filenames that are not text, not a general binary
  bypass). No other corpus file may be added to it without its own story.
- `packages/core/src/buffer/buffer.test.ts`, `packages/core/src/buffer/splice.property.test.ts` — the
  same named exemption for `image.png`, so the byte-fidelity property tests do not assert a PNG
  round-trips as UTF-8 text. No other change to either file.
- `packages/core/goldens` — regenerate only the entries the corpus `README.md`'s new sentence about
  `image.png` changes (`README.ast.txt`, `README.html.txt` or their equivalents). No other golden may
  move; a golden diff outside the README pair is a sign the fixture step leaked into parsing.

## Do this, in order
1. **The fixture first**, because two criteria are vacuous without it. `09-gfm-everything.md` line 81
   already reads `![Image alt](image.png "Image title")`, so adding `fixtures/corpus/image.png` changes
   **no existing document byte** and no golden (goldens are parse-level). 1200×400 is wider than the
   measure on purpose: one fixture exercises the scale-down and the recomputed reserved height.
   `05-pathological-table-and-nesting.md`'s `nope.png` stays missing — that is the not-found case.
2. **Rust**, then `tauri.conf.json`. Nothing in TypeScript may call a command before it is registered.
3. **The check that would have caught the escalation.** In `shell-boundary.test.mjs`: parse every
   `invoke('name')` literal in `apps/desktop/src/shell/tauri.ts`, parse the identifier list inside
   `generate_handler!` in `main.rs`, and fail naming any invoked name that is not registered. Show it
   failing once by removing a name from the handler list, and put the failing output in the PR body.
4. `tauri.ts` and `memory.ts`.
5. **Post-pass 3.** For each `img[src]` that is not `[data-marxy-remote]`: resolve through core's
   `resolveImageSrc`; a refusal keeps the alt text and gets no `src`; `allowAssetScope(imageRoot)` once
   per root per session; `imageSize`; `reserveImageBox` against the measure; set `width`/`height`;
   **then** `src = shell.assetUrl(path)`. The order is the whole point — the box has to be right in the
   first frame.
6. **The notices region.** One line, in flow above the article, empty at rest, dismissible, never a
   modal, never overlapping the text (§09). Build every node with `createElement` and set host text with
   `textContent`. `scripts/registry.json` permits `innerHTML` under `apps/desktop/src/notices.ts`; this
   story declines the permission, because host names come from a hostile document.
7. **Post-pass 4.** One notice per document from `blockedImages`, each host named once with a count. No
   allow action — MARXY-44 adds it.
8. Regenerate the baselines for `09-gfm-everything.md` and `10-hostile.md` only; list them in the PR body
   with a reason each. Add the taste-review row.

## Tests → expected
| Check | Expect |
| --- | --- |
| Rust `image_size` on `fixtures/corpus/image.png` | exactly `1200×400` |
| Rust `image_size` on `04-source.ts` | `None` |
| Rust `image_size` on a missing path | `not-found` |
| Rust `allow_asset_scope` on a file | `invalid` |
| `pnpm gate:licences` after the Rust build | green; `imagesize` resolved MIT |
| `invoke` ↔ `generate_handler!` | every invoked name registered; shown failing with one removed |
| `tauri.conf.json` | `assetProtocol.enable === true`, `scope` empty, `csp` byte-identical to `main`'s |
| post-pass 3, two images under one root | `allowAssetScope` called once |
| post-pass 3 on a refused path | alt text kept, no `src` attribute, `assetUrl` never called |
| post-pass 3 attribute order | `width`/`height` set before `src` (recorder) |
| `09-gfm-everything.md` in Playwright | summed `layout-shift` value **0** from before the pass until `decode()` resolves, and `naturalWidth > 0`; fails with the `width`/`height` assignment removed |
| `10-hostile.md` in the harness | exactly one notice; text names `example.invalid` once with a count; no host string inside the article |
| `01-long-technical.md` | notices region empty; height 0; the article's first line at the same offset as with the region absent |
| `apps/desktop/src/notices/**` | contains no `innerHTML` |
| `assetUrl` arguments over the corpus | none parses as an `http`/`https` URL |
| `pnpm gate:no-network` | green with both post-passes running over every corpus file |
| `pnpm gate:aesthetics` | green; report, pasted in the PR body, states whether `09-gfm-everything.md` and `10-hostile.md` re-rasterized with zero pixel delta or short-circuited, and names which — not inferred from an empty `fixtures/baselines` diff |
| `scripts/allowlists/crate-licences.json` | `imagesize@0.13.0`, MIT, and no other entry changed |
| `pnpm gate:fidelity` | green; `image.png` is exempted from the UTF-8 round-trip check by exact filename, no other corpus file is |
| `packages/core/src/buffer/buffer.test.ts`, `splice.property.test.ts` | green; `image.png` excluded by the same named list, no other fixture excluded |
| `git diff -- packages/core/goldens` | touches only the corpus `README.*` golden pair |
| `git diff -- docs/plan/jira-issues.csv` on this branch | empty |

## Acceptance → check
The row's eleven criteria map one-to-one onto the table above, in order; criterion 3 is step 3's check and
criterion 6 is the Playwright CLS measurement. Every one is a named case, not a grep for a member name.
AC11 additionally requires the `gate:aesthetics` re-rasterization statement above, stated against the
acceptance wording rather than assumed from a quiet diff.

## Do not
Add `http:` or `https:` to any CSP directive; touch `img-src` or `csp` at all. Fetch anything — the fetch
path is MARXY-97 and it is Rust, not the webview. Add the per-document allow action (MARXY-44). Use
`innerHTML` anywhere under `apps/desktop/src/notices`. Touch `packages/core` or `packages/shell-api`
(frozen; these members go on the concrete shell objects, per ADR-0026's transition rule). Regenerate a
baseline for a document that has no image. Set a `src` on an `img[data-marxy-remote]` (MARXY-96/97 own
those). Raise a budget to make a gate green. **Edit `docs/plan/jira-issues.csv` at all** — this story's
`Paths` cell is fixed by the `MARXY-152` landing story, not by this story; a diff to that
file on this branch, for any reason, is an automatic return regardless of what else is correct. Add any
file to `scripts/gate-fidelity.mjs`'s or the buffer tests' exemption list beyond `image.png`.
