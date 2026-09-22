# Roadmap — the long horizon

`plan.md` is the five phases to v1. This is what comes after, what would cause the
foundations to be revisited, and the few numbers worth watching over years. It is a
direction, not a commitment; every line beyond v1 is subordinate to "surface quality over
feature breadth" (ADR-0019).

## Horizon 1 — v1: the reader (phases 0–4, ≈ 14 weeks of fleet time)

Opens instantly, never corrupts a file, phones nobody, sets a long document more beautifully
than anything else available, on macOS and Linux. Everything else waits.

## Horizon 2 — v1.x: the reader matures (the six months after v1)

Ordered by what a reader notices, one theme per minor release, at most four new operations per
release so the palette stays quiet.

1. **Content search** — `tantivy` behind `shell-api`; "that section of that document" over
   contents, not just headings. The first thing v1 users will ask for.
2. **Read-only spine** — a `SUMMARY.md`-style ordered list read as one document: continuous
   scroll, one outline, honest whole-work progress. Cheap because every node already carries
   provenance (ADR-0003); the reading feature that fits reading-first exactly.
3. **Operations catalogue** — pretty-print/minify JSON and YAML, extract code blocks and
   links, rewrap/unwrap, sort, promote/demote, copy as rich HTML, encoding utilities.
4. **Theme contract v2** — the linter, version negotiation, a curated theme list (a page in the
   repo, not a marketplace; no accounts, no ratings, no downloads that phone home).
5. **Windows** — WebView2. Chromium lacks `hanging-punctuation`, which the typesetter already
   supplies; run the weight harness there before shipping.
6. **Settings as a document** — a config file opened in Marxy like a theme is; still no chrome.
7. **Accessibility pass** — verify with VoiceOver and Orca that typeset paragraphs keep
   paragraph semantics (the inline-HTML promise), and fix what does not.
8. **CJK and RTL correctness** — the fixtures exist; kinsoku in the breaker, `keep-all` for
   Korean, bidi paragraphs. Currently known-unsupported, not broken silently.
9. **Mermaid** — on the first substantial request, restyled to the grid, never embedded as-is.

## Horizon 3 — v2: operate across documents (6–12 months after v1)

- **Cross-document operations** — "extract every unchecked task in this repository"; the
  operation signature already takes a `Document` so it can take several.
- **Editing across a spine**, routed by provenance to the right file.
- **Transclusion** with heading-level offsetting and cycle detection.
- **Export and PDF** — the typesetter's second render target (print), the thing people who love
  the typography ask for first. A real project under Tauri, not an afternoon (no `printToPDF`).

## Horizon 4 — the hive, if ever (not before v2)

The parked ambition: a pastebin on a git account, then "a serious publishing platform". The
only thing v1 does for it is keep `packages/core` and `packages/typeset` shell-free
(ADR-0020). The order, when the time comes:

1. `marxy-render`, a browser build of the pipeline (a web component or static-site plugin,
   MIT, zero server). This alone makes "a git repo as a document store" a static site.
2. A hosted service only if a static site is not enough; its licence (MIT or AGPL) is decided
   then, for a service, not pre-emptively for a desktop reader.

## Sustainability

There is no revenue, so maintenance is the budget. Rules that keep it bounded: the boundaries
in `CONTRIBUTING.md` are answered by pointing at an ADR, not by argument; the WebKitGTK
baseline moves once a year to the oldest supported LTS (currently 2.50); sponsorship, if any,
changes nothing about what is free; releases when a phase's review passes, never on a date.

## Tripwires — when a foundation gets re-examined

| Signal | What it reopens |
| --- | --- |
| Authoring re-enters scope | ADR-0005 first; then the stack (Electron's single engine matters again for `contenteditable`) |
| Weight harness on real Linux desktops shows residual > 25 after version-keyed offsets | Per-distribution offset table; if hinting makes Literata unreadable at 1×, a Linux-specific face |
| Resist inflation: CI never writes a higher recorded cold-start number into the repo to make a red gate green | Font subsetting first; resident mode default on that platform second; never a bigger bundle |
| `justif/core` cannot set ragged text, and `tex-linebreak2` shows no visible gain on the corpus | Supersede ADR-0007; the claim rests on grid, measure, hanging punctuation |
| Reviewer fails the palette task at review #2 | Reveal-on-intent tabs (ADR-0011 fallback) |
| A supported distribution stays on WebKitGTK < 2.50 | Baseline exception documented in the theme contract |
| Tauri ships a single cross-platform engine (Verso/Servo) that passes the harness | Re-run the spike; one engine would delete the per-engine testing cost |
| A first-time user's first reaction is about a feature | Stop feature work; the aesthetics tier is not doing its job |
| More than half of the last 10 merges are ops (`planner-trigger.mjs`) | The planner defers ops stories that do not unblock a phase, and says which ones in its delta |

## Numbers worth watching over years

Cold-start median per platform; installed bundle size; tier-1 pass rate per PR; tier-2 win
rate against Typora and Marked 2; count of operations shipped; count of extension requests
declined with an ADR pointer; open theme-on-old-engine issues. Nothing about users: there is
no telemetry to count them with, by design.
