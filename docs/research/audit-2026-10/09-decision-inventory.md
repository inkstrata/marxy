# Decision inventory: what constrains Marxy, and what each constraint costs today

Date: 2026-10-01. Task name: `decision-inventory`. Worktree: `MARXY-346` at `origin/main`.

**Abstract.** Marxy is governed by 43 ADRs (not 40; the index lists 43), four commitments in `AGENTS.md`, six design constraints, a scope cut table, and 35 numbered design decisions (D-A1 to D-A35). This document lists every one of them, says why it exists, how well the reason is evidenced, what enforces it today, how much code and process it produced, and what it makes hard. It then goes deep on the nine decisions that most constrain the three features the author is weighing (a tracked collection with a quick-jump bar, tiled splits, strong clipboard and text tools). Classifications are provisional and are the lead's to overrule. The headline is that the project has two kinds of decision. Most of the product decisions are cheap, reasonable and carry no real cost for the new features. A small cluster (the network mechanism, the one-document and one-window shape, node-granular selection, the fixed single-article DOM, and the "never" cuts) is where the cost sits. Separately, the decision record itself has drifted: five ADRs are `proposed` and three of those are already implemented, two accepted ADRs describe code that does not exist, and the one decision that most needs an owner (ADR-0037) is stuck behind a human gate.

Numbers are labelled `[C1]`, `[C2]`, and so on. Each label is a command in the appendix. Where I quote an ADR's own figure rather than my own measurement, I say so.

## 1. Findings up front

1. **"No telemetry" and "the webview has no network" are different decisions, and only the second one costs anything.** No telemetry is a promise with no code behind it and no named gate. The webview-has-no-network rule is a mechanism (CSP, a 396-line gate, a CSS `url()` rewriter, a planned Rust fetcher) that has produced up to about 3,000 lines of gate, CSP check, theme-URL rewriter, image-root and consent-store code beyond the 2,305-line sanitiser [C1], and today delivers nothing to the reader: every remote image is blocked and the consent notice says "Images will load when Marxy can fetch them." (`apps/desktop/src/notices/blocked.ts:205`).
2. **The frozen contracts have never changed in the contract directory.** The five files under `packages/core/src/contracts/` have one commit, the bootstrap [C2]. The cost of a field is not the hash; it is that every feature that needs per-pane state, a second document, or a clipboard source has to be argued as an ADR first.
3. **Single document, single window, single article is structural, not a preference.** `apps/desktop/src/app.ts` holds 33 module-level `let` variables, one document, one article element, and one reading anchor [C3]. ADR-0037 would centralise that into one store and explicitly leaves "more than one open document" undecided.
4. **Node-granular selection (D-A2) rules out the text tools the author wants.** A drag selection is `{kind:'text'}`, copy only, and never resolves to bytes. No v1 operation declares `'span'` [C4].
5. **The aesthetics machinery has a human half that mostly has not happened.** The queue has 50 dated rows, 9 with a decision and 41 without [C5]. Two taste reviews were held, both recorded on 2026-09-19. The blind comparison against Typora and Marked 2 that ADR-0014 names as the pass criterion was never run (the capture directories are empty) [C6]. The ADR-0011 reversal test (review #2) is a blank form.
6. **Linux parity is claimed by design and verified by proxy.** There is no Flatpak manifest, no `packaging/` directory, a weight-offset table still marked as awaiting measurement, and Linux screenshots come from Playwright WebKit in a container, not WebKitGTK on a desktop [C7].
7. **Knuth-Plass is real but narrow.** The default breaker is the project's own 151-line `ragged.ts`; the young `justif` dependency is only used for hanging punctuation and for a justified engine the app never selects [C8]. The author's own review called the visible gain "subtle", and "a wash" on the plan document.
8. **Decision debt is concentrated in four places** (section 4): proposed ADRs acting as accepted, accepted ADRs the code does not implement, `AGENTS.md` contradicting the ADR index, and ADR-0013/0022/0032 layering over each other.
9. **Under the restated spirit** (free, beautiful, minimal, reader-first but adept at writing, user owns data and tools) most decisions survive untouched. Of the 19 decisions section 5 reviews, 6 are kept, 9 are loosened and 4 are dropped, each with a one-line amendment.

Classification totals for the inventory rows are in section 2.5 [C9].

## 2. The inventory

Column key. **Evidence**: *measured* (a number someone took), *argued* (reasoned, not tested), *handoff* (inherited from the pre-repo brainstorm), *taste* (the author's call), *research* (the graded handbooks). **Enforced by**: a script, a test, a hash, a CODEOWNERS path, or "nothing". **Class**: spirit, contingent (evidence-backed and could change), taste, process (only about how the repo is run), over-fit.

Quotes are the ADR's own words, 15 words or fewer.

### 2.1 Product and architecture ADRs

| ID | Decision | Why, in the ADR's words | Evidence | Enforced by | Code and process produced | Forecloses | Class |
|---|---|---|---|---|---|---|---|
| 0001 | Reading is primary; the default surface has no caret | "When reading and editing want different things, reading wins." | argued, handoff | Nothing mechanical; the AGENTS.md inclusion test | Rendered mode has no caret; Source mode is a separate CodeMirror surface (21 files, 851 lines [C10]) | WYSIWYM, in-place Rendered editing, table editors | spirit |
| 0002 | Webview shell; no native toolkit | "First-class user CSS is a headline feature; shipping it natively means writing a CSS engine." | argued | `check-boundaries.mjs` keeps `@tauri-apps` under `src/shell` | Frontend is the product; WebKit-baseline CSS rule (no Chromium-only features) | Native text rendering, any per-engine pixel guarantee | contingent |
| 0003 | One buffer, one AST, byte provenance on every node | "Adding it later means reworking renderer and editor together" | argued; later measured (6 ms median parse, 20 KB, ADR-0021's figure) | `ast.ts` hash pin; 46 golden files (604 KB) [C11]; AST invariants test; `gate-fidelity.mjs` 688 lines | `packages/core/src/parse|sourcemap|buffer`; every node has `{file,start,end}` | Incremental/diffing renderers (D-A3 re-parses on every splice); a second authoritative model | spirit |
| 0004 | Edits are pure `string -> string` over a byte range; no plugin or scripting API "now or in v1.1" | "A theme cannot corrupt a document; an operation can" | argued | `operation.ts` hash pin; byte-fidelity property tests; nothing technical stops a future registry | `packages/core/src/operations`: 4 operations, 1,054 lines with tests [C12] | User-written operations, macros, pipe-to-command, anything the author would call "my tools" | over-fit (the "never"); the pure-function design itself is spirit |
| 0005 | Two modes only: Rendered and Source | "the largest cluster of risk in the project, dissolved by deleting scope" | argued | default-mode and mode-switch tests | CodeMirror 6 Source mode; position carried across modes | Live-render editing; a third "split" mode | contingent |
| 0006 | MIT, OFL fonts, grammar and pattern allow-lists | "this decision is the cheap one now" | argued; the author's ethic | `gate-licences.mjs` 832 lines, 3,104 lines of allow-lists, 528 Rust crates audited [C13] | Generated `THIRD_PARTY_NOTICES.md`; CommonMark spec fetched, never vendored | GPL grammars (Shiki's default pack), vendoring spec examples, copying AGPL code | spirit |
| 0007 | Own Knuth-Plass line breaking, ragged-right, hanging punctuation | "the only identified route to being measurably better set than every incumbent" | argued; partly measured (justif made ragged worse; own breaker built); review #1: prose "subtle", plan "a wash" | `gate-aesthetics.mjs` rag check against 44 stored baselines; typeset unit tests | `packages/typeset` 1,280 non-test lines [C14]; `justif ^0.9.1` | Browser-native wrapping as the only path; every resize re-runs it | taste |
| 0008 | Themes are declarative CSS under a token contract; no JS, no network | "Give theme authors the variables, not the declarations" | argued | `check-tokens.mjs` (55 tokens); `lint-default-theme.mjs`; `css-urls.ts` 284 lines | `packages/theme` 1,700 lines | Themes with scripts, conditional logic, remote fonts | spirit |
| 0009a | Sanitise raw HTML always | "a reader that reports what they read betrays them" (for the whole ADR) | argued | `packages/core/src/sanitize/` 2,305 lines incl. tests [C1]; hostile fixture; CODEOWNERS | Own 588-line tokenizer-based sanitiser, not DOMPurify | Rendering untrusted HTML as-is | spirit |
| 0009b | A visible per-document opt-in widens the allow-list | (same ADR) | argued | `policy.ts` `WIDE_POLICY`; trust tests | `trust.ts` 225 lines, `trust-copy.ts` 163, `blocked.ts` 207; ADR-0036 clause 4 then moved most layout HTML into the default policy | A global "trust everything" switch (D-A24) | contingent |
| 0009c | Remote images and CSS `url()` are blocked by a strict CSP; the webview has no network (sharpened by ADR-0027) | "That is one boundary where ADR-0009 promised two." (ADR-0027) | argued; no measurement of any attack | `gate-no-network.mjs` 396 lines (+431 in core gate files), `check-csp.mjs` 124, CSP in `tauri.conf.json:25` | See deep dive 3.1. The mechanism's net output is that no remote content loads today | Remote images, link previews, URL fetch into the reader, web fonts, update checks, a hive/static-site target that fetches | over-fit |
| 0009d | No telemetry, crash reports, update pings or version checks by default | "Some readers are at risk." (AGENTS.md) | argued; the author's ethic | Nothing named. Indirectly the CSP (`connect-src ipc:`) and the licence gate | Zero code | Nothing feature-level; it only forbids reporting | spirit |
| 0010 | Tauri 2; privileged work behind `shell-api` | "A rule was committed before measuring." | measured (spike: WebKitGTK within about 12 weight units of Chromium; 8.9 MB vs 289 MB) | `check-boundaries.mjs` raw-`invoke(` ban; `shell-boundary.test.mjs` | `main.rs` 1,053 lines; `shell/tauri.ts` 203; 29-member `Shell` interface [C15] | A single bundled engine (tracks Verso/Servo) | contingent |
| 0011 | The palette is the tab manager; no tab bar | "Instant switching plus a navigable history removes both reasons" | argued; reversal criterion defined and never run (review #2 form is blank) | `palette.test.mjs:162` asserts no tab bar in the live document | `apps/desktop/src/palette/` 2,115 lines [C16]; history.json (MRU, pins, 12 recent roots) | Any visible set of open or tracked documents at rest | taste |
| 0012 | Index root is the enclosing git repo; search covers titles, headings, paths; no settings surface for roots; 50,000 entries; contents search deferred | "Indexing node_modules once would destroy the speed claim" | argued | `index-entry.ts` hash pin; `INDEX_LIMITS` | `index-model` 1,581 lines in core; Rust walker 573 lines (std only, not `ignore`/`nucleo` as ADR-0010 said) | A user-chosen set of files or folders; a collection not equal to a repo; full-text search | over-fit (single-root, no-settings); the deny list and ceiling are contingent |
| 0013a | Speed budgets are hard CI gates | "Very fast" is a promise the user tests within ten seconds. | argued | Overtaken by 0029 and 0032 (no timing fails CI) | 1,897 lines of perf machinery still maintained [C17] | - | process |
| 0013b | Single instance always; resident mode opt-in | (same ADR; Q13: "surprising for a reader") | argued | `tauri_plugin_single_instance` at `main.rs:795`; one window label in `tauri.conf.json` | A second `marxy file.md` replaces the document in the one window | Multiple windows, per-window state, splits implemented as windows | contingent |
| 0014 | "Aesthetics paramount" gets a two-tier test: mechanical gate plus scheduled human review | "Features have completion criteria; taste does not" | argued | `gate-aesthetics.mjs` 1,124 lines; 168 baseline PNGs, 18 MB [C18] | Both variants and both engines baselined; tier 2 mostly not held (deep dive 3.8) | - | process |
| 0015 | Literata and JetBrains Mono | "Literata was designed for extended screen reading" | taste (review #0), then superseded on sizes by 0033 | `gate-font-attrs.mjs`, licence gate | `fonts/` | A sans default | taste |
| 0016 | Machine gates for everything checkable; a taste queue for the rest | "never by interrupting a task with 'does this look right?'" | argued | Queue became voluntary on 2026-09-29; the ADR text still says every visible PR appends a row | `taste-queue.mjs` + lib 212 lines; queue.md; `queue.d/` fragments | - | process |
| 0018 | Reading position is a source-map coordinate, never a scroll offset | "a scroll offset is meaningless across any of them" | argued | `position.ts` hash pin (9 lines) | `core/src/position` 1,221 lines; `apps/desktop/src/position` 53 | One position per path (a split showing one file twice has one shared position) | spirit |
| 0019 | The v1 cut | "The most likely failure is never shipping." | argued | `check-deferrals.mjs` 141 lines | See section 2.4 | See section 2.4 | contingent |
| 0020 | `core` and `typeset` never depend on the shell | "That costs one module boundary." | argued | `check-boundaries.mjs` (no Node built-ins, no DOM in core) | Gates run in Node without a shell | Nothing that matters; this is what keeps a browser/static-site target possible | contingent (keep) |
| 0021 | Parser is mdast/micromark, not markdown-it | "meeting ADR-0003 on top of it would mean re-deriving inline positions" | measured (6 ms median parse, 20 KB, ADR-0021's own figure) | CommonMark spec suite in CI, fetched and digest-pinned | `core/src/parse` 811 non-test lines; dropped the autolink transform (3 classes of input lose their link) | markdown-it plugins | contingent |
| 0023 | Provenance rides in the DOM on per-call secret attribute names | "a forged range would make an operation splice bytes the reader did not point at" | argued; a first design failed on implementation | `render/contract.test.ts`; `provenance-forgery` vector | Nonce rename pass in render | - | spirit |
| 0024 | Dark is primary; light designed second | "a reader used at length is used in the evening" | taste (the author) | `palettes.test.mjs`; aesthetics gate runs both | Every baseline doubled (84 PNGs per engine) | - | taste |
| 0026 | Amend `Shell` once for v1 | "turn the frozen contract into a floor that the real app no longer matches" | argued | `registry.json` `frozen`; `check-story.mjs:38` demands an ADR in the same commit | Three later amendments each needed an ADR (0038, 0039, 0041) | A new privileged capability without ADR | process |
| 0027 | Remote images fetched by Rust, only on per-document per-host consent; CSP never lists http(s) | "That is one boundary where ADR-0009 promised two." | argued | `gate-no-network.mjs`, `check-csp.mjs`; `fetchRemoteImage` in the frozen `Shell` but unimplemented in Rust | Consent store built; fetcher not built (MARXY-97 waits on an earlier phase) | See 3.1 | over-fit |
| 0029 | No product cold-start ceiling | "makes every later story either lie or reopen the budget" | measured (ADR: 2,844 ms macOS, 1,735 ms Linux, packaged) | `scripts/lib/no-ceiling.test.mjs` | - | A "fast launch" claim on a tag | contingent |
| 0030 | The grid unit is half the body line box | "the grid gate would have failed by construction" | argued (arithmetic) | Aesthetics grid check; `grid.test.mjs` | `snapToGrid` 86 lines pads code, images, math, tables, wrapped headings | Free-form layout blocks (a split pane gutter must itself sit on the grid) | taste |
| 0031 | Token names and units are the contract; the values are taste | "the rule inverting its own purpose" | argued | `check-tokens.mjs` 135 lines against `tokens.contract.json` | Hash pin on `tokens.css` replaced with a names-and-kinds check | - | process |
| 0033 | Typography follows the reader-typography research | "this research supersedes every earlier taste decision, including the font choices" | research (graded handbook, some measured in WebKit) | Measure gate (66 average chars, 10%), contrast gates | 20 px, 66-char measure, restrained code colour, authored-width code | Taste review as the arbiter of typographic values | contingent |
| 0035 | Where the two research handbooks overlap, the higher-graded claim wins, then the property owner | "Without a rule, a story can cite whichever handbook suits it" | argued | Nothing mechanical | Overlap table | - | process |
| 0036 | Artifact units: removals reported, instruction-file tags kept, diff tokens, no diagrams in v1 | "one thing to accept or send back, clause by clause" | research (mostly grade D, "reasoned defaults") | Partly built; contract half landed as MARXY-232 | Sanitiser policy changes pending on a CODEOWNERS path | Rendered Mermaid (EPL-2.0 `elkjs`); per-block scrollers | contingent |
| 0037 | One document store with seven transitions | "each fix since then has added one more holder of the document" | measured (reproduced data loss: file 1,907 to 1,711 bytes on undo after a failed write) | Nothing; proposed, MARXY-249 `human-gated` | None. `apps/desktop/src/document/` does not exist | Leaves "more than one open document" explicitly open | contingent |
| 0038 | Window controls hide at rest through the shell | "Permanent chrome above the page" | argued | `Shell.setWindowControls` in the frozen contract | One more shell member and Rust window code | - | spirit |

### 2.2 Process and orchestration ADRs

| ID | Decision | Why, in the ADR's words | Evidence | Enforced by | Produced | Forecloses | Class |
|---|---|---|---|---|---|---|---|
| 0017 | Trunk-based, one issue one branch one PR, CODEOWNERS on sensitive paths | "two agents editing one document concurrently corrupt both changes" | handoff | `check-story.mjs`, `check-pr.mjs`, branch protection | `scripts/` 10,820 lines [C19] | Cross-cutting refactors by one actor | process |
| 0022 | Two-tier perf enforcement (reference vs CI envelope) | "CI does not measure a scaled version of the reader's experience." | measured (its own CI runs: 7,719 ms vs 1,901 ms) | Superseded in effect by 0032 | `gate-perf.mjs` 798, `measure-startup.mjs` 511 | - | process |
| 0025 | Review order and a review WIP limit | "This is a livelock, not a backlog." | measured (9 PRs, 6 behind, 3 conflicting) | `review-order.mjs`; partly amended by 0034 | - | - | process |
| 0028 | CODEOWNERS is a security floor, not a taste gate | "A human reviewing the merge adds a second pass over the same thing" | argued | `.github/CODEOWNERS` (7 paths) | Status is `proposed` yet the file matches it | - | process |
| 0032 | Speed numbers are recorded, never CI failures | "A gate that fails the merge bar on a number we do not promise" | the author's ruling after a 0.05 ms miss failed main | `gate-perf.mjs` exits 1 only on a missing or dishonest record | - | A speed regression gate of any kind | process |
| 0034 | The fleet is a level-triggered reconciler | "a state without one is a bug" | measured (about 80 `orchestration/` fix commits) | `machine.mjs` `STATES` test | `orchestration/` 12,549 lines, 6,674 non-test [C19] | - | process |
| 0039 | One shared stub for `Shell` compile checks | "Those stubs were hand-copied object literals" | argued | `pnpm typecheck` | - | - | process |
| 0040 | Land green PRs without bringing them up to date; main-red guard replaces strict protection | "a small, mostly theoretical risk" | argued | `cycle.mjs` main guard; `gate-protection.mjs` still requires `strict` (see section 4) | - | - | process |
| 0041 | `Shell` gains `onCloseRequested` and `confirmClose` | "the close-confirmation flow cannot listen for the Tauri event" | argued | Shell-boundary test | Two more members | - | process |
| 0042 | One plan file per story, not a shared CSV | "always conflict, though they share no meaning" | measured (91 commits to the CSV in 14 days) | Migration in progress; CSV still present, `docs/plan/stories/` has 1 file [C20] | - | - | process |
| 0043 | When main goes red, revert the first red commit and reopen its story | "Waiting for a person is the cost this removes" | argued | `revert.mjs` 306 lines; status `proposed` yet merged in #306 | - | - | process |

### 2.3 Commitments and design constraints

| ID | Decision | Why | Evidence | Enforced by | Produced | Forecloses | Class |
|---|---|---|---|---|---|---|---|
| C1 | MIT, free, no paid tier, no accounts | AGENTS.md: "never ship a GPL dependency or grammar" | the author's ethic | `gate-licences.mjs` | see 0006 | Paid tier, sync, accounts | spirit |
| C2 | No telemetry, ever | "Some readers are at risk." | the author's ethic | Nothing named | none | Crash reporting, usage counting | spirit |
| C3 | Nothing phones home by default; themes cannot make network requests; remote images blocked until opt-in | same | argued | `gate-no-network`, CSP, `css-urls.ts` | see 0009c | See 3.1. "By default" is the spirit; the webview-has-no-network mechanism is the part that over-reaches | spirit (the promise) / over-fit (the mechanism) |
| C4 | Never touch a byte the user did not ask to change | AGENTS.md | argued; measured by property tests | `gate-fidelity.mjs` 688 lines, `atomic_write.rs` 836 lines, per-operation range tests | 1,524 lines total [C19] | Normalising formatters, auto-save | spirit |
| K1 | Measure in average characters, never `ch` | "Every incumbent caps in px" | measured (zero is 0.58 em, an average char 0.463 em) | Aesthetics gate: 66 chars, 10%, sizes 16 to 28 px | `--marxy-measure-chars`, `--marxy-avg-char` | A user-set pixel column | contingent |
| K2 | One baseline grid, units of half a line | (design-language) | argued | Aesthetics grid gate | `snapToGrid`; 24 corpus documents | Free layout | taste |
| K3 | Space belongs above | "Getting this backwards is what makes Obsidian's default feel wrong." | taste | Partial (`taste.test.mjs` asserts grid multiples, not the 2.5 ratio) | CSS | - | taste |
| K4 | Hierarchy from size and weight only; no coloured headings | (design-language) | taste | `lint-default-theme.mjs` | Theme lint | Boxed callouts by default (now partly overtaken by ADR-0036 alert roles) | taste |
| K5 | Monospace is a voice: matched x-height, own line box, verbatim | (design-language) | research (ADR-0033) | font-attr gate | code at 18 px | Ligatures, scrollers | contingent |
| K6 | Chrome at rest is zero | "every affordance will feel worth 32 px of permanent chrome, and none is" | taste, then reinforced | `palette.test.mjs:162`; fixed DOM skeleton (D-A19) | No toolbar, sidebar or tab bar elements exist in the DOM | Any visible pane, list or split at rest | spirit (minimal), over-fit in its strictest form |

### 2.4 Scope cuts and architecture decisions that bind

| ID | Decision | Evidence | Enforced by | Forecloses | Class |
|---|---|---|---|---|---|
| S1 | No tabs (ADR-0011) | argued | `palette.test.mjs:162` | Visible multi-document UI | taste |
| S2 | No plugins or scripting, "never" (scope.md) | argued | Nothing mechanical | User tools | over-fit |
| S3 | No export or PDF, v2 | argued; "a project under Tauri" | - | Publish from Marxy | contingent |
| S4 | No settings UI; a config file suffices (v1.1: "settings as a document") | argued | `docs/design/11-config-and-storage.md` | A collection manager or per-root settings screen | taste |
| S5 | Linux at parity from v1, Flatpak and AppImage (scope cut order puts "Linux at v1 parity" fifth) | argued; A5 risk | CI matrix runs both OSes; release.yml builds `appimage,deb` only | Any feature that needs a Linux machine to verify | contingent |
| S6 | Single window and instance (see 0013b) | argued | `main.rs:795` | Splits-as-windows | contingent |
| S7 | macOS and Linux only; Windows after v1 | argued | CI matrix | Chromium-only CSS; WebView2 quirks deferred | contingent |
| S8 | Wikilinks, backlinks, graph, sync, accounts, mobile, publishing: "never" | argued ("a different product") | - | Backlinks across a tracked collection | taste (over-fit if a collection ships) |
| S9 | Spines and transclusion: v1.1 read-only at earliest | argued | - | The roadmap's nearest relative of a tracked collection | contingent |
| D-A2 | Selection is node-granular; drag text never resolves to bytes | argued | `selection.ts:7-12` | Text tools (3.5) | over-fit |
| D-A3 | A splice triggers a full reparse and re-render | argued | - | Live editing performance at scale | contingent |
| D-A19 | The DOM skeleton is fixed: one `<article>`, five ids, "no other chrome exists" | argued | `design/09` | Splits (3.3) | over-fit |
| D-A22 | The webview never has network (see 0027) | argued | `gate-no-network` | See 3.1 | over-fit |
| D-A24 | Per-document grants only; no global switch | argued | `trust.ts` | A "trust this folder" switch | taste |
| D-A34 | Flatpak has no network permission | argued | Design only; no Flatpak manifest exists [C7] | Remote content on Flatpak | over-fit (designed, unbuilt) |

### 2.5 Tally

[C9] counts the Class column of the four tables above. There are 72 rows (the 43 ADRs, with 0009 split into four rows and 0013 into two; the four commitments; the six constraints; the scope and D-A rows). A row with a split class (C3, K6) is counted under its first label.

| Class | Rows |
|---|---|
| spirit | 14 |
| contingent | 20 |
| process | 17 |
| taste | 12 |
| over-fit | 9 |

The nine over-fit rows are 0004 (the "never" on user-authored operations), 0009c, 0012, 0027, S2, D-A2, D-A19, D-A22 and D-A34. C3's mechanism half and K6's strictest reading are also over-fit but are counted as spirit because the promise behind each is. The lead should read the rows, not the count.

## 3. Deep dives

### 3.1 The network posture

The author's concern was that "guaranteeing network trust" restricts design decisions. The evidence supports a narrower claim than the one the project has built.

**Three things travel under one name.** (a) *No telemetry*: Marxy does not report what the reader does. (b) *Nothing phones home by default*: Marxy makes no request the reader did not cause. (c) *The webview has no network*: the page can never make a request, for any document, ever (ADR-0027 §1, D-A22). (a) and (b) are the spirit. (c) is one mechanism for achieving them, chosen because "a CSP cannot be widened per document at runtime in Tauri" (ADR-0027 context). Everything costly in this section comes from (c).

**What enforces what.**

| Promise | Enforced by | Lines |
|---|---|---|
| (a) No telemetry | Nothing named. No gate searches for it; `grep -ri telemetry` over scripts, apps, packages finds no hit [C21]. It holds because no code exists to send anything | 0 |
| (b) Nothing phones home by default | The CSP in `apps/desktop/src-tauri/tauri.conf.json:25` (`default-src 'none'`, `connect-src ipc: http://ipc.localhost`, no http source) | 1 line of config + `check-csp.mjs` 124 lines |
| (c) Webview has no network | The same CSP, `gate-no-network.mjs` (396 lines, both engines, hostile fixture, three controls that must fire), the observability report in `packages/core/scripts` (about 430 lines with tests), `css-urls.ts` (284 + 120 test) | about 1,350 |
| Consent store for the exception | `trust.ts` 225, `trust-copy.ts` 163, `blocked.ts` 207, `commands/trust.ts` 57, `trust.test.mjs` 306 | about 1,000 |
| The sanitiser (also needed for XSS, not only network) | `packages/core/src/sanitize/` | 2,305 |

The total across all of the above is 5,336 lines [C1]. Of that, 2,305 is the sanitiser, which is needed for XSS safety whatever the network rule is. The other 3,031 lines are the gate, the CSP check, the theme-URL rewriter, the image-root logic and the consent store. Some of that would exist anyway (the gate also proves sanitiser behaviour; the image-root code also serves local images), so I attribute somewhere between 2,000 and 3,000 lines to the (c) posture, about 1,000 of which (the consent store) exist only to serve an exception that cannot yet be used. I did not separate these any finer; the split is a judgement, not a measurement.

**What it delivers to the reader today: nothing.** The Rust fetcher (`fetch_remote_image`, ADR-0027 §2-3) does not exist; `fetchRemoteImage` appears only in the frozen interface and the in-memory test shell [C22]. The reader sees a consent notice that ends "Images will load when Marxy can fetch them." (`apps/desktop/src/notices/blocked.ts:205`). The story that delivers it (MARXY-97) waits on an earlier phase. Priority-one content (READMEs, "badge-heavy" in ADR-0009's own words) therefore renders without its badges and screenshots, and will until a socket-opening Rust function, a new HTTPS crate through the licence gate, an in-memory scheme handler and a `trust.json` host list all exist.

**What each constraint forbids.**

| Capability | Forbidden by | What it would take |
|---|---|---|
| Remote images in READMEs | (c), ADR-0027 | Rust fetcher (ureq or reqwest; `reqwest` is already in `Cargo.lock` transitively), custom URI scheme handler, CSP `img-src marxy-remote:`, per-host consent (already built) |
| Link previews | (c) | Same fetcher generalised past `image/` content types; an ADR (new `Shell` member); capabilities change on a CODEOWNERS path |
| Fetching a URL into the reader (an AI artifact on a gist, a docs page) | (c); no `Shell.fetchText` exists; `openExternal` only hands a URL to the OS browser | New shell member + Rust command + sanitiser path for fetched HTML |
| A future static-site or "hive" target | Not forbidden by (c). ADR-0020 (core is shell-free) is what keeps it open, and it is cheap | Nothing now; the roadmap's `marxy-render` is a build of `core` + `typeset` |
| Web fonts in themes | ADR-0008 and `css-urls.ts` reject remote `url()` and `@import`; fonts must be bundled | A theme author vendors the font. This one is defensible: it is a licence and privacy rule, not a mechanism cost |
| Mermaid via CDN | (c), and separately ADR-0036 clause 11 declines diagrams for an EPL-2.0 dependency | Bundle it (size, licence) or leave a source block |
| Update checks | ADR-0009 §4: "The updater, if ever added, is opt-in and documented" | Not forbidden; no updater exists. Release is manual download |

**Alternatives that satisfy the spirit with less mechanism.** None of these is a recommendation; they are the options the lead can weigh.

1. Keep (a) and (b), drop (c): allow `img-src https:` only after the reader grants the document, by reloading the document view in a second webview (or a per-document `<iframe sandbox>` with its own CSP) that is the only surface allowed `https:`. Cost: a second boundary, which is exactly what ADR-0027 chose to avoid.
2. Keep (c) but build the fetcher and treat it as a general "shell fetch" (images, text, URL) behind one consent store. Cost: one Rust module and one ADR; benefit: every item in the table above becomes a call, not an architecture change.
3. Make remote images a user setting ("load images from these hosts, always") rather than per-document grants. This is what a reader who is not "at risk" will want; the per-document store (D-A24, 2,000-entry LRU) exists to serve the at-risk reader.

The spirit restated by the author ("user is a first-class owner of their data and tools") reads most naturally as option 2 with a user-visible default, because owning your tools includes choosing whether they can fetch.

### 3.2 The frozen contracts and the cost of adding a field

**What is frozen.** Five files under `packages/core/src/contracts/` (`ast.ts` 77 lines, `operation.ts` 46, `position.ts` 9, `index-entry.ts` 14, a 8-line test). `test:contracts-frozen` in `package.json:14` diffs them against a freeze commit (`a859f6b…`) and pins each blob hash. `packages/shell-api/src/` is frozen by a different mechanism: `registry.json` `frozen` plus `check-story.mjs:38`, which fails any commit touching a frozen path unless a `docs/adr/*.md` file is in the same commit. `tokens.css` is frozen by name and unit kind only (ADR-0031): 55 tokens in `tokens.contract.json`.

**History.** The core contracts have one commit [C2]. `shell-api/src/index.ts` has five commits: bootstrap, ADR-0026 (1 amendment, 12 members), ADR-0038, ADR-0039, ADR-0041 [C2]. In ten days the "frozen" `Shell` grew by four ADR-gated changes to 29 members.

**What a field costs.** Take `ReadingPosition`, which a split or a collection would need to extend (a pane id, or a collection id). The steps are: (1) write an ADR; (2) edit `position.ts`; (3) move the freeze commit hash `h` inside the one-line inline script in `package.json:14`, or the test fails; (4) update every referent: 8 files mention `ReadingPosition`, 9 mention `OperationInput`/`OperationResult`, 16 mention `IndexEntry` [C23]; (5) regenerate goldens if the AST shape moved (46 files); (6) the PR must touch only the contract plus its ADR (AGENTS.md "Contracts are frozen"). It is about a day of ceremony, not a technical obstacle. The real cost is that the contract encodes single-document assumptions: `Document.path` is one string, `ReadingPosition.path` is one string with no pane, `OperationInput.document` is one `Document`, and `OperationResult.clipboard` is write-only. Nothing in them can express "another document" or "the clipboard's current contents" without a field.

**Assessment.** The freeze is not what blocks the features; the shape it froze is. ADR-0031 already shows the project's own remedy (freeze names and kinds, free the values). The same move for the core contracts would be: keep the AST invariants frozen, allow additive optional fields by test rather than by ADR, and require an ADR only for a removal or a change of meaning.

### 3.3 No tab bar (ADR-0011) versus collections and splits

ADR-0011 forecloses a tab bar. It does not, by itself, foreclose a tracked collection with a jump bar: the palette already holds MRU, pins and recent roots (`palette/history.ts`, 239 lines; `INDEX_LIMITS.recentRoots` = 12). A "tracked collection" is a persistent, named, user-chosen subset of that. What blocks it is not ADR-0011 but ADR-0012 (the root is the enclosing repo; "No settings surface for roots in v1") and the `IndexEntry.root` contract field, which makes a collection a repo.

A split is different. ADR-0011's own reversal criterion contemplated "tabs revealed only while switching". A split is a persistent second surface, so it hits constraint 6 ("chrome at rest is zero") and D-A19 (the DOM skeleton has one `<article>`; "no other chrome exists"). The rule is enforced by `palette.test.mjs:162`, a DOM assertion that there is no tab bar, and `design/09`'s skeleton; the code that assumes one article is spread across 31 global DOM lookups and a 1,399-line `app.ts` [C3]. The honest reading is that constraint 6 is a spirit decision ("minimal") that was written in its strictest form. A pane gutter is not a toolbar; a tiling layout with no chrome between panes honours the constraint if the pane edges are the only structure. The reversal criterion that would test whether palette-only switching suffices has never been run (review #2 is a blank form, `docs/taste-review/2026-09-review-2/decisions.md`). So the project has no evidence either way on whether palette-only navigation is enough for cross-referencing documents.

### 3.4 The one-document store (ADR-0037) versus splits

ADR-0037 is the clearest case where an in-flight decision would make the splits feature cheaper or dearer depending on one clause. Today three modules each hold part of "the open document": `app.ts` (33 module-level `let`s), `selection/view.ts` (10), `commands/edits.ts` (4) [C3]. ADR-0037 proposes `apps/desktop/src/document/store.ts` with one record and seven transitions. It ends: "Not decided here: more than one open document." That sentence is the whole splits question.

Two designs follow. If the store is a singleton, a split means a second `App`, i.e. a second webview or a rewrite. If the store is a factory (`createDocumentStore(shell)`, which is how MARXY-249's card words it), a split is two stores and a layout. The card already says `createDocumentStore(shell)`; the ADR text says "the open document has one owner". The cheapest decision the author can make is to amend ADR-0037 before it is accepted so that the store is per-document and `AppHandle.dispatch()` addresses a document id. The story is `human-gated` and unimplemented [C20], so this is free today and expensive after MARXY-49's save path and the 33 module variables have been re-pointed at a singleton.

The ADR's evidence is strong (a reproduced data-loss path: after a failed write, undo shrank `03-ai-plan.md` from 1,907 to 1,711 bytes), so the store itself is not over-fit; its scope clause is the open question.

### 3.5 Node-granular selection (D-A2) versus text tools

D-A2 and `docs/design/03-selection-and-operations.md` state the rule: click selects a node, the outline selects a section, a drag is `{kind:'text'}` and "never resolves to bytes in v1" (`apps/desktop/src/selection/selection.ts:7-12`). The reason is real: smart typography and soft hyphens make painted characters differ from source bytes, and "a drag that starts inside a link and ends inside a code span has no byte range that is 'the selected text'". The frozen `Applicability` type already includes `'span'`, so the contract anticipated the feature; no v1 operation declares it [C4].

The cost for the author's third feature is concrete. "Wrap the selected phrase in a code span", "copy this selection as Markdown", "strip formatting from the selection" are all span operations. Under D-A2 they can only be offered on whole nodes (a paragraph, a code block, a table). A clipboard tool that reads the clipboard has a second gap: `clipboardWrite` is the only clipboard member in `Shell` (`packages/shell-api/src/index.ts:36`), and `capabilities/default.json` grants `clipboard-manager:allow-write-text` and `allow-write-html` only; there is no read permission. That file is on the CODEOWNERS list.

What it would take to resolve a drag to a byte range: map each text-node endpoint to its provenance element (`data-marxy-s`), then to a byte offset inside the element's source, correcting for smart-typography substitutions (a text-run transform in core per D-A13) and soft hyphens. The first is easy; the second needs the render pass to record per-run offset deltas. ADR-0036 deferred a related change (P04, `OperationInput.source`) to v1.1 "each changes a frozen contract". This is the most expensive of the three decisions to relax, and the spirit supports relaxing it ("adept at both").

### 3.6 Knuth-Plass (ADR-0007) and the young dependency `justif`

**What is actually in use.** `packages/typeset/src/index.ts:114` defaults the engine to `'ragged'`, which is the project's own 151-line `ragged.ts` (a total-fit breaker with a 2 em right-skip, written because `justif` has no right-skip and "made technical paragraphs worse than the engine's own wrapping", ADR-0007 Amendment 1). The `'justif'` engine is selected only if a caller passes `engine: 'justif'`; no app code does [C8]. `justif/core` is imported in exactly two places: `items.ts` (85 lines, the unused justified engine) and `hang.ts` (79 lines, hanging punctuation via `hangingCharacters` and `latinProtrusion`). So the "young dependency" risk in `docs/risks.md` is real but small: the project depends on `justif@0.9.1` for two helper functions and a dormant engine.

**What it delivers.** Taste review #1 recorded the prose result as "prefer after (typeset). Difference is subtle." and the plan document as "wash" (`docs/taste-review/2026-09-review-1/decisions.md`). ADR-0007's own clause says that if the review finds no visible improvement the breaker is cut by a superseding ADR. The review found a subtle one, so the clause did not fire, and no ADR records that judgement. `packages/typeset/RESEARCH.md` reports 287 candidate paragraphs on the corpus of which 167 were set and 102 were already one line (the document's figure, not re-run), with viewport passes of 0 to 53 ms across its two recorded runs.

**What it costs.** 1,280 non-test lines in `packages/typeset` [C14], a rag baseline set (44 files) in `fixtures/baselines/rag`, a text-measure pipeline that re-runs on open, resize, font load and theme change, and a hanging-punctuation path that must stay in step with the engine.

**Assessment.** Contingent and taste. The decision does not constrain the three new features except that a split pane is a second resize target for the breaker. Cheap to keep, cheap to remove (the app never calls the justified path). A restated spirit ("beautiful") keeps it.

### 3.7 Linux parity from the first release, with no Linux machine

The scope says "macOS and Linux at parity", the A5 risk keeps the cut order for "Linux at v1 parity" fifth, and MARXY-22 (run the weight harness on a real Linux desktop) is `blocked`: "deferred: no Linux desktop or notarization account yet (author 2026-09-22)" [C24].

What exists: CI runs `gates` on `macos-latest` and `ubuntu-latest` (`ci.yml:186-193`), the browser suite on Ubuntu, and Linux screenshot baselines (84 PNGs) beside the macOS ones (84) [C18]. Per ADR-0033 those Linux PNGs were generated by Playwright WebKit in a `mcr.microsoft.com/playwright:v1.63.0-noble` container as `linux/amd64`. That is Playwright's WebKit build under Xvfb, not WebKitGTK on a desktop. `fixtures/baselines/webkitgtk` holds a `.gitkeep` only [C7].

What does not exist: a Flatpak manifest (`packaging/` is absent; D-A34's no-network permission is a design that has no file to enforce it), a signed macOS build (the release workflow publishes a pre-release "unsigned until notarization secrets are configured"), and measured weight offsets. `apps/desktop/src/theme/offset.ts` still carries the comment "MARXY-22 measures real desktops and replaces the numbers"; the 75/125/100 values come from the spike under Xvfb. `release.yml` builds `appimage,deb`, not Flatpak.

So "parity" is currently: the same CSS, tested in a proxy engine. That is a reasonable engineering position, but it means the parity commitment costs process (a doubled matrix, doubled baselines, a unit-bearing token and per-version offset table) without any real-desktop verification behind it. For the three new features the constraint matters little (splits and a jump bar are layout), but "verify on Linux" is a gate nothing can pass. Class: contingent.

### 3.8 The taste-review machinery (ADR-0014 and ADR-0016) and its real state

The machinery has two halves. The machine half is large and working: `gate-aesthetics.mjs` is 1,124 lines, there are 168 baseline PNGs (18 MB) and 44 rag baselines, `grid.test.mjs`, palette contrast tests and a theme lint. The human half is where the decision stops being evidenced.

Facts from the repo [C5, C6]:

| Item | State |
|---|---|
| Queue rows (`docs/taste-review/queue.md`) | 50 dated rows |
| Rows with a recorded decision | 9 (all dated 2026-09-18 or 2026-09-19) |
| Rows with no decision | 41 (dated 2026-09-19 to 2026-09-29) |
| Reviews held | #0 (typeface) and #1 (first styled page), both recorded 2026-09-19 |
| Review #2 (ADR-0011 reversal test) | form is blank |
| Blind comparison vs Typora and Marked 2 (ADR-0014 tier 2 pass criterion: preferred on 2 of 3) | never run; `docs/taste-review/review-1/typora/` and `marked/` are empty; the capture spec asks a human to supply them |
| Queue entries required? | No. The author ruled on 2026-09-29 that they are voluntary; ADR-0016 still says every visible PR appends one, and AGENTS.md's definition of done still lists it |

The author's own verdict on the first styled page was "not a book yet". The next two substantive typography changes (ADR-0033, 20 px and 66 characters) were not made by taste review; they were made by a research handbook, with the sentence "this research supersedes every earlier taste decision". That is the clearest evidence of what works here: the human review produced two sessions in 15 days of repository history, then the project switched its arbiter for typographic values from taste to evidence.

This is not a criticism of the gates. It does mean ADR-0014's tier 2 is currently not a gate, ADR-0016's queue is not a process, and "aesthetics are the differentiator" is verified by tier 1 only (grid, measure, contrast, rag, layout shift). Class: process, with a note that the differentiator claim has never been tested against a competitor.

### 3.9 Single instance (ADR-0013)

`tauri_plugin_single_instance::init` (`main.rs:795`) forwards a second launch's argv and cwd to the first process, which focuses the one window and emits `marxy:open-files`; paths arrive in the app as an `open` of the single document (`deliver_open_files`, `take_pending_opens`). The window list in `tauri.conf.json` has one entry and the close menu item comments "Marxy is single-window, so closing the one window leaves nothing to open into and is the same as quitting" (`main.rs:614`).

Single instance is a reasonable default and the ADR's reason (Q13) is a taste argument: a reader is "surprising" as a resident process. What the decision actually constrains is the combination: one instance, one window, one document (ADR-0037, app.ts). To use two documents side by side a user today has to run two applications, and single instance prevents that. A split inside one window removes the need for a second window; therefore the decision is only a blocker if splits are implemented as windows. Class: contingent.

## 4. Decision debt

**Proposed ADRs treated as accepted in code.**

| ADR | Status | What the code does |
|---|---|---|
| 0027 remote content through the shell | proposed | `Shell.fetchRemoteImage` is in the frozen interface (ADR-0026, accepted, cites it); D-A22 and the consent store assume it; CSP follows it. The ADR says MARXY-97 and MARXY-45 "move it to accepted". |
| 0028 CODEOWNERS floor | proposed | `.github/CODEOWNERS` already matches it exactly. |
| 0034 fleet reconciler | proposed | `machine.mjs`, `store.mjs`, `cycle.mjs` implement it; `AGENTS.md` describes the result as current. |
| 0043 revert first | proposed, "the repo owner has not read it yet" | `revert.mjs` (306 lines) merged in #306 on 2026-09-29. |
| 0037 one document store | proposed | Not implemented, but the stated invariant ("no other module keeps a field of this record at module scope") is also unenforced; MARXY-49 shipped around it. |

**Accepted ADRs the code does not implement or contradicts.**

| ADR | Says | Code |
|---|---|---|
| 0009 §1 | "parse → sanitise (DOMPurify in the frontend …)" | The sanitiser is the project's own 588-line tokenizer (`sanitize-html.ts`); `check-boundaries.mjs` forbids `dompurify` in `core` and `apps/desktop/src`. The ADR was never amended. |
| 0010 | "The index, matcher and watcher are Rust (`ignore`, `nucleo`, `notify`)" | `Cargo.toml` has `notify` only. The walker is std-only Rust (573 lines); fuzzy matching is TypeScript in the app; `Shell.listRoot` and `fuzzy` are `@deprecated` (ADR-0026). |
| 0013 | Hard CI failures on speed | Amended by 0022, 0029, 0032; but `AGENTS.md`, 0013's text and `gate-perf.mjs` selftest vocabulary still read "gate". |
| 0014 | Tier 2 blind comparison is the pass criterion | Never run (3.8). |
| 0016 | Every visible PR appends a queue entry | Voluntary since 2026-09-29; ADR not amended. |
| 0019 / scope | Flatpak, signed notarised DMG ship in v1 | No Flatpak manifest; unsigned pre-release; no notarisation account. |
| 0042 | One plan file per story | Accepted; `docs/plan/stories/` has 1 entry and the CSV still exists. Migration in progress. |
| 0036 clauses 1 and 2 | Removals reported; instruction-file tags kept | Pending in the sanitiser (CODEOWNERS path). |

**Contradictions between documents.**

1. `AGENTS.md:204` says "ADR-0035 is proposed, so its spec lines are recommendations". The ADR index and the ADR file both say `accepted 2026-09-26`, and ADR-0036 says it "Depends on ADR-0035 (proposed; this ADR applies it)". Three statuses for one record.
2. `docs/decisions.md` says "Nineteen technical decisions (D-A1…D-A19)"; `docs/design/00-architecture.md` lists D-A1 to D-A35.
3. `docs/decisions.md` records the Tauri argument with "a 500 ms budget that CI enforces on the real bundle"; ADR-0029 and 0032 withdrew both halves of that sentence.
4. `docs/brief.md` says of its four content types "None of these are written in Marxy", and ADR-0004 and `scope.md` say no scripting ("never"); the restated spirit says "adept at both" and "tools" the user owns. Not a contradiction yet, but the brief and those two documents are what the new spirit overrides.
5. `gate-protection.mjs` requires `required_status_checks.strict === true` (`gate-protection.mjs:32-35`), while ADR-0040 and `ci-contract.md:18` set `strict=false`, and `hygiene.md:198` still prints `strict=true`. The gate is not run in CI (only `--selftest` in `pnpm test`), so the contradiction is silent.
6. The ADR index count: 43 ADRs; the audit brief and some docs speak of 40.
7. ADR-0022 Amendment 3 table adopts per-class tolerance numbers; ADR-0032 says none of it can fail a build; `ci.yml` still runs nine launches, `perf-budgets-unchanged`, and the perf gate on both runners. All of it stays as monitoring, 1,897 lines [C17].

**Roadmap collisions.** `docs/roadmap.md` Horizon 2 lists a "read-only spine" (an ordered list read as one document), which is the nearest existing design to a tracked collection. `scope.md` places spines at "v1.1 read-only spine at the earliest" and wikilinks, backlinks and graph at "never"; `docs/brief.md` line 72 lists "library browsing" as out of scope. A tracked collection with a jump bar has to be placed explicitly relative to all three.

## 5. If the spirit is restated

The restated spirit is: free, beautiful, minimal software to manage AI output in MD/HTML; reader before writer but adept at both; the user is a first-class owner of their data and tools. For each over-fit or contingent decision that the restatement touches, one line says whether it keeps, loosens or drops it, and the amendment that records that.

| Decision | Verdict | One-line ADR amendment |
|---|---|---|
| 0004 no plugin/scripting "now or in v1.1" | loosens | "Operations remain pure and range-bound; the bar on user-authored operations is lifted, and a user-supplied operation is allowed if it runs sandboxed with no I/O." |
| 0009c / 0027 / D-A22 webview has no network | loosens | "The promise is no request the reader did not authorise; the webview-only mechanism is replaced by a shell-owned fetch the reader can grant per host, per document, or as a default." |
| C3 "themes cannot make network requests" | keeps | "Themes still bundle their assets; this is a supply-chain rule, not a mechanism cost." |
| 0009d no telemetry | keeps | no change. |
| 0012 root is the enclosing repo, no root settings | loosens | "A root may be any folder or a user-named list of paths; the repo rule is the default, not the only rule." |
| 0011 / K6 no tab bar, chrome at rest zero | loosens | "Panes are allowed when the reader summons them; at rest a single document is chrome-free and a pane edge is not a toolbar." |
| D-A19 fixed single-article DOM skeleton | drops | "The skeleton holds N article regions; one at rest." |
| D-A2 node-granular selection | loosens | "A text drag may resolve to a byte range when its endpoints map through provenance; node selection stays the default." |
| 0037 one store | loosens (before acceptance) | "The store is per-document; the app holds a set of stores." |
| 0013b single instance | keeps | "Single instance remains; documents open in panes, not windows." |
| S2 plugins/scripting "never" | drops | "Replace 'never' with 'not before the operation sandbox exists'." |
| S8 wikilinks, backlinks "never" | loosens | "Backlinks over a tracked collection are in scope; a graph view is not." |
| 0001 / 0005 reader, two modes | keeps | "Add: Source mode is a first-class editor surface; Rendered stays caret-free." |
| 0007 Knuth-Plass | keeps | no change; remains taste. |
| 0014 tier-2 competitor test | loosens | "Tier 2 is a first-reaction review by the author, not a blind competitor comparison." |
| 0020 core is shell-free | keeps | no change; it is what enables a static-site or hive target. |
| S5 / S7 Linux parity from v1 | loosens | "Linux ships when it can be verified on a real desktop; until then it is labelled preview." |
| 0013a / 0022 / 0032 CI speed machinery | drops (as ceremony) | "Speed is a measured, recorded, human-read set of numbers; no CI step may exist solely to defend them." |
| 0016 queue rows | drops | "Taste queue entries are optional (the 2026-09-29 ruling); this ADR's 'every PR' is withdrawn." |

## 6. Appendix: commands run

```sh
# C1  network/trust/sanitiser footprint (5,336 lines total, includes tests and the sanitiser)
cd /Users/ian/Dev/marxy-wt/MARXY-346 && wc -l scripts/gate-no-network.mjs packages/core/scripts/gate-assertions.ts packages/core/scripts/gate-assertions.test.ts packages/core/scripts/gate-checks.ts packages/core/scripts/gate-observability.ts packages/core/scripts/unobservable-classes.test.ts packages/core/src/sanitize/*.ts packages/theme/src/css-urls.ts packages/theme/src/css-urls.test.ts scripts/check-csp.mjs scripts/check-csp.test.mjs apps/desktop/src/trust/*.ts apps/desktop/src/notices/blocked.ts apps/desktop/src/notices/trust-copy.ts apps/desktop/src/commands/trust.ts apps/desktop/test/trust.test.mjs packages/core/src/render/images.ts packages/core/src/render/images.test.ts | tail -1
wc -l packages/core/src/sanitize/*.ts | tail -1        # 2305

# C2  contract history
git log --oneline -- packages/core/src/contracts          # one commit (bootstrap)
git log --oneline -- packages/shell-api/src/index.ts       # five commits

# C3  document state held at module scope
grep -c "^let " apps/desktop/src/app.ts apps/desktop/src/commands/edits.ts apps/desktop/src/selection/view.ts   # 33, 4, 10
wc -l apps/desktop/src/app.ts                               # 1399
grep -rn "document.querySelector\|document.getElementById" apps/desktop/src packages/typeset/src --include='*.ts' | grep -v test | wc -l   # 31

# C4  selection and span
sed -n 1,20p apps/desktop/src/selection/selection.ts
grep -n "appliesTo" packages/core/src/operations/*.ts | grep -v test

# C5  taste queue (50 dated rows, 9 decided, 41 undecided)
python3 - <<'EOF'
import re
rows=[l for l in open('docs/taste-review/queue.md') if re.match(r'\| 20\d\d-\d\d-\d\d \|',l)]
print(len(rows), sum(1 for r in rows if re.split(r'(?<!\\)\|',r.strip())[1:-1][-1].strip()))
EOF

# C6  competitor captures never supplied
ls docs/taste-review/review-1/typora docs/taste-review/review-1/marked    # both empty
cat docs/taste-review/2026-09-review-2/decisions.md                       # blank form

# C7  Linux packaging and baselines
ls packaging; for d in fixtures/baselines/*; do echo $d $(find $d -type f | wc -l); done
sed -n 14,21p apps/desktop/src/theme/offset.ts

# C8  justif usage
grep -rn "justif" packages/typeset/src apps/desktop/src --include='*.ts' | grep -v test
grep -rn "engine:" apps/desktop/src --include='*.ts'                       # no call selects 'justif'

# C9  classification tally: parse the Class column of the section 2 tables of this file
python3 - <<'EOF'
import re,collections
t=open('docs/research/audit-2026-10/09-decision-inventory.md').read()
sec=t.split('## 2. The inventory')[1].split('### 2.5 Tally')[0]
c=collections.Counter()
for l in sec.split('\n'):
    if not l.startswith('|') or l.startswith('|---') or l.startswith('| ID') or l.startswith('| Decision'): continue
    m=re.match(r'(spirit|contingent|taste|process|over-fit)',[x.strip() for x in l.strip().strip('|').split('|')][-1].lower())
    if m: c[m.group(1)]+=1
print(sum(c.values()),c)   # 72 rows: contingent 20, process 17, spirit 14, taste 12, over-fit 9
EOF

# C10 source mode size
wc -l apps/desktop/src/source/*.ts | tail -1                               # 851

# C11 goldens
ls packages/core/goldens | wc -l; du -sh packages/core/goldens             # 46 files, 604K

# C12 operations
wc -l packages/core/src/operations/*.ts | tail -1                          # 1054

# C13 licence gate
wc -l scripts/gate-licences.mjs; find scripts/allowlists -type f | xargs cat | wc -l; grep -c '^name = ' apps/desktop/src-tauri/Cargo.lock

# C14 typeset
ls packages/typeset/src/*.ts | grep -v test | xargs cat | wc -l            # 1280

# C15 Shell member count
awk '/^export interface Shell/,/^}/' packages/shell-api/src/index.ts | grep -cE '^\s+(readonly )?[a-zA-Z]+(\(|:)'   # 29

# C16 palette
wc -l apps/desktop/src/palette/*.ts | tail -1                              # 2115

# C17 perf machinery
wc -l scripts/gate-perf.mjs scripts/measure-startup.mjs scripts/measure-parse.mjs fixtures/perf-budgets.json scripts/lib/no-ceiling.test.mjs   # 1897

# C18 baselines
find fixtures/baselines -type f | wc -l; du -sh fixtures/baselines; find fixtures/baselines -name '*.png' | wc -l

# C19 scripts, orchestration, fidelity
cat scripts/*.mjs scripts/lib/*.mjs | wc -l                                # 10820
cat orchestration/*.mjs | wc -l                                            # 12549
ls orchestration/*.mjs | grep -v test | xargs cat | wc -l                  # 6674
wc -l scripts/gate-fidelity.mjs apps/desktop/src-tauri/src/atomic_write.rs # 688 + 836

# C20 plan stories migration, ADR-0037 files
ls docs/plan/stories | wc -l; ls apps/desktop/src/document

# C21 telemetry
grep -rni telemetry scripts apps/desktop/src apps/desktop/src-tauri/src packages --include='*.mjs' --include='*.ts' --include='*.rs' --include='*.json' --exclude-dir=node_modules --exclude-dir=dist -l   # no hits

# C22 remote fetcher
grep -rln "fetchRemoteImage\|fetch_remote_image" apps/desktop/src apps/desktop/src-tauri/src packages/shell-api/src   # memory.ts and shell-api only

# C23 contract referents
grep -rln "ReadingPosition" apps packages scripts --include='*.ts' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=dist | wc -l   # 8
grep -rln "OperationInput\|OperationResult" apps packages scripts --include='*.ts' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=dist | wc -l   # 9
grep -rln "IndexEntry" apps packages scripts --include='*.ts' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=dist | wc -l                   # 16

# C24 MARXY-22 deferral
sed -n 15p orchestration/needs-human.md
```

## For the synthesis

1. The costly part of the "network trust" posture is the mechanism (webview has no network, ADR-0027/D-A22), not the promise (no telemetry, nothing phones home by default); the mechanism has cost up to about 3,000 lines beyond the sanitiser (including a 396-line gate) and today delivers no remote image at all, so separate the two in the ADR and keep only the promise as spirit.
2. The three new features are blocked less by the frozen contract hash than by single-document assumptions baked into `Document.path`, `ReadingPosition.path`, `app.ts`'s 33 module-level variables, one `<article>` (D-A19) and a write-only clipboard; ADR-0037 is the one place where a one-clause change (per-document store, not singleton) is free today and expensive after it is accepted.
3. Node-granular selection (D-A2) is the single most expensive decision to relax and the one that blocks the text tools: a drag never resolves to bytes, and the clipboard has no read capability.
4. A tracked collection is blocked by ADR-0012 (the root is the repo, no settings for roots) and by the `IndexEntry.root` field far more than by the no-tabs rule; the palette already holds MRU, pins and 12 recent roots.
5. No tab bar and "chrome at rest is zero" (ADR-0011, constraint 6) are taste decisions whose own reversal test (review #2) was never run; a pane edge is not a toolbar, so splits need an amendment of D-A19 and constraint 6's wording, not a reversal of the spirit.
6. The aesthetics-as-differentiator claim has never been tested: 41 of 50 taste-queue rows have no decision, the blind comparison against Typora and Marked 2 (ADR-0014's pass criterion) was never run, and the author's own typography changes came from a research handbook, not taste review.
7. Linux parity is verified only by proxy (Playwright WebKit in a container); there is no Flatpak manifest, no real-desktop weight measurement and no notarisation, so the commitment costs a doubled matrix without verification behind it and should be labelled preview until it can be verified.
8. Knuth-Plass is cheap to keep: the default breaker is the project's own 151-line file, `justif` supplies only hanging-punctuation helpers and a justified engine nothing calls, and the author's review rated the gain "subtle"; it is a taste decision, not a constraint on the new features.
9. Decision debt is real: five `proposed` ADRs (three already implemented), accepted ADRs that name code that does not exist (ADR-0009's DOMPurify, ADR-0010's Rust `ignore`/`nucleo`), three statuses for ADR-0035, and ADR-0013/0022/0032 layered so that 1,897 lines of perf machinery defend numbers that fail nothing.
10. Under the restated spirit most decisions keep; the amendments to make are 0004 and S2 (user-authored tools), 0009c/0027/D-A22 (shell-owned grantable fetch), 0012 (user-chosen roots), D-A2 (span resolution), D-A19 and constraint 6 (panes), and ADR-0037 (per-document store), each a one-line change recorded in section 5.
