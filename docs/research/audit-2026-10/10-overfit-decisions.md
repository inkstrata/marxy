# 10 — Which decisions are over-fit, and what the restated spirit keeps

**Date:** 2026-10-01 · **Author:** the audit lead · **Inputs:** `09-decision-inventory.md` (the
full table), the forty-three ADRs, `AGENTS.md`, `docs/scope.md`, `docs/design-language.md`, and the
screenshot baselines in `fixtures/baselines/`.

**Abstract.** Marxy's decision records are unusually complete, and most of them are right. The
problem is not that decisions were made; it is that a handful of *mechanisms* chosen to honour a
commitment were themselves promoted to commitments, and then enforced by gates, hashes and
CODEOWNERS until they started deciding what the product could become. This document sorts every
binding decision into four bins against the spirit the author has now restated, names the
mechanisms that have outgrown their commitments, and proposes the smallest amendment for each.
The headline: keep the four commitments and the six design constraints; loosen six mechanisms
(the no-network webview, the byte-frozen contracts, Linux parity at first release, the
screenshot-baseline gate, the per-document consent store, and the fleet-shaped process); and
re-read three ADRs (0004, 0005, 0011) in the light of "reader before writer, adept at both".

## 1. The spirit, as restated, and what it changes

The author's restatement:

> Free, beautiful and minimal software to manage AI output in Markdown and HTML. A reader before a
> writer, but adept at both. The user is a first-class owner of their data and their tools.

Set beside `docs/brief.md`, three things move:

| Brief (2026-09-18) | Restated (2026-10-01) | What it changes |
| --- | --- | --- |
| "A markdown *reader*. None of these [content types] are written in Marxy." | "Reader before writer, but adept at both." | Writing re-enters scope, bounded. ADR-0001 and ADR-0005 need re-reading, not reversing. |
| Content priority: READMEs, AI artifacts, source, prose. | "Manage AI output in MD/HTML." | AI output is first, not second. HTML is named as a first-class input, not only a sanitised island. "Manage" is more than "read": collect, find, compare, extract, move. |
| "Some readers are at risk … nothing phones home by default." | "The user is a first-class owner of their data and tools." | The commitment is ownership and consent, not a mechanism. A user who owns their tools may point them at the network, extend them, and script them. |

Nothing in the restatement touches *free*, *beautiful* or *minimal*, so MIT, no telemetry, byte
fidelity, the typography research and chrome-at-rest-zero all stand unchanged.

## 2. The four bins

Every binding decision falls into one of these. The full row-by-row classification is in
`09-decision-inventory.md`; this section gives the verdicts and the reasoning for the contested ones.

- **Spirit.** Follows directly from free, beautiful, minimal, reader-first, user-owns-data. Keep as is.
- **Contingent.** Right given a measurement or a situation that can change. Keep, but name the
  condition and stop enforcing it beyond the condition.
- **Taste.** The author's preference, legitimately so. Keep, but never let a gate own it.
- **Over-fit.** A mechanism that has outgrown the commitment it served, and now constrains design
  the spirit does not require. Amend.

### 2.1 Spirit — keep unchanged

| Decision | Why it is spirit |
| --- | --- |
| Four commitments 1 and 2 (MIT, free, no accounts; no telemetry, ever) | Free and user-owned. No argument. |
| Commitment 4 (never touch a byte the user did not ask to change); ADR-0003 (one buffer, one AST, byte provenance); ADR-0018 (reading position is a source coordinate); ADR-0023 (provenance in the DOM) | Byte fidelity is what "owner of their data" means for a file. The provenance architecture is what makes every other feature (operations, splits, extraction) cheap. This is the best-made part of the codebase. |
| ADR-0009 §1–2 (always sanitise raw HTML; narrow allow-list widened by opt-in) | Security floor. Cheap, correct, and it is what lets HTML be a first-class input at all. |
| ADR-0006 (no copyleft) | Free means redistributable. |
| ADR-0010 (Tauri), ADR-0021 (mdast/micromark), ADR-0020 (core is shell-free) | Sound engineering choices, measured or argued, with no reason to revisit. ADR-0020 is also what keeps a future browser build possible. |
| ADR-0033, 0035, 0036 (typography and artifact presentation follow the research) | "Beautiful" with evidence instead of vibes. The handbooks are the project's most durable asset. |
| Design constraints 1–5 (measure in characters, one grid, space above, hierarchy from size and weight, monospace is a voice) | The look. Keep. |
| Design constraint 6 (chrome at rest is zero) | Minimal. Keep, with a definition of "at rest" (see §4). |

### 2.2 Contingent — keep, name the condition

| Decision | Condition | What to stop doing |
| --- | --- | --- |
| ADR-0007 (own line breaking) | Stays while the typeset viewport cost is under the 100 ms budget and the kill switch (`--marxy-typeset: none`) stays one line. `05-performance-audit.md` has the number. | Stop treating it as the differentiator in prose. The screenshots show the bundle (grid, measure, hanging punctuation, Literata) carries the look; the breaker is one of four properties. |
| ADR-0012 (index root is the enclosing repository) | Right until a collection model exists. `06-feature-collection-and-search.md` proposes one. | Nothing yet; supersede when collections land. |
| ADR-0013 §2 (single instance) | Right while the app is one window. A split view or a second window reopens it. | Nothing yet. |
| ADR-0024 (dark primary) | Taste the research supports. | Nothing. |
| ADR-0029/0032 (no cold-start ceiling; numbers are recorded, not gates) | Right. The author already ruled this. | Delete the machinery that pretends otherwise: `fixtures/perf-budgets.json`'s "product" tier that nothing checks, and the envelope arithmetic in `scripts/gate-perf.mjs`. |
| ADR-0037 (one document store) | Proposed, unimplemented, and the precondition for a split view and for sane undo. | Accept it and build it first; `12-recommendation-codebase.md` makes it the first refactor. |

### 2.3 Taste — keep, keep gates off it

ADR-0015 (Literata and JetBrains Mono), ADR-0024 (dark primary), ADR-0030 (half-line grid unit),
ADR-0031 (token values are taste), ADR-0038 (window controls hide at rest). All fine. The one
caution: ADR-0014's tier-1 gate measures rag against a stored baseline and refuses to let it get
5 % worse. That is a machine enforcing a taste number nobody chose. Keep the grid, measure and
contrast checks (they are pure and fast); drop the rag-versus-baseline comparison (see §3.4).

### 2.4 Over-fit — amend

Six mechanisms. Each is described in §3 with the evidence, what it forecloses, and the amendment.

## 3. The over-fit mechanisms

### 3.1 "The webview never touches the network" (ADR-0009 §3, ADR-0027, D-A22, D-A34)

**The commitment** is commitment 3: nothing phones home *by default*; remote content loads only
when the reader opts in. **The mechanism** that grew around it:

- A CSP with no `http(s)` source for any document, ever (ADR-0027 §1).
- Remote images fetched by a Rust function behind `shell-api`, served through a custom URI scheme,
  with a per-document, per-host consent store (`trust.json`, D-A24) and a notice naming hosts.
- `scripts/gate-no-network.mjs` (395 lines) plus `gate-assertions.ts`, `gate-observability.ts` and
  `unobservable-classes.test.ts` in `packages/core/scripts/`, which exist to prove the gate proves
  what it claims and to print what it cannot observe.
- A theme `url()` ban, including upper-case and escaped forms (MARXY-246).
- The Flatpak with no network permission (D-A34).

**What it costs today.** Open `fixtures/baselines/webkit-macos/02-readme-real-world-960-dark.png`:
the first content type in the priority order, a README, renders its badges as empty rectangles.
ADR-0009 itself predicted this ("stripping breaks badge-heavy READMEs visibly") and answered it
with a per-host consent flow that is not reachable in the app today: `fetchRemoteImage` is declared in `packages/shell-api/src/index.ts:73` and stubbed in the memory shell, but the Tauri shell (`apps/desktop/src/shell/tauri.ts:56`, a `Pick<Shell, …>`) does not implement it, no Rust command exists for it, and nothing in `apps/desktop/src` calls it. The consent store and its notices (`app.ts` `grantImageHostsForOpenDocument`) exist; the fetch they would unlock does not. So
the mechanism is already deciding what a reader sees, before the feature that softens it exists.

**What it forecloses.** Anything that fetches: link previews, "open this URL as a document",
web fonts in a user theme, Mermaid or KaTeX from a CDN (both are bundled instead, which is fine but
was forced), an opt-in update check, and the roadmap's own Horizon 4 (a browser build of the
pipeline) which cannot share a CSP that forbids the web.

**Why the mechanism is over-fit.** ADR-0027 argues for "two boundaries instead of one" because a
sanitiser bug would otherwise leak a read receipt. That is a real argument for a *hardened mode*
and a weak one for the *default of a reader whose first content type is READMEs*. The spirit
asks for consent and ownership. A reader who sets "load remote images: always" owns that choice,
and a reader who leaves it at "ask" is exactly as protected as before.

**Amendment (ADR-0044, proposed).**

1. Commitment 3 stands verbatim. No request leaves the machine without a reader action.
2. The consent store becomes one setting with three values, `remote-images = "never" | "ask" | "always"`,
   default `ask`, in `config.toml`; one dismissible notice per document in `ask`; no per-host store.
   `trust.json` is deleted when nothing else uses it (the HTML allow-list opt-in moves to the same
   shape: `html = "narrow" | "ask" | "wide"`).
3. The CSP carries `img-src https:` only when the setting is `always` or the reader said yes for this
   document; since Tauri fixes the CSP at load, the shell reloads the webview with the widened policy
   on consent (one extra open, under the 50 ms open budget on a warm index). The Rust fetcher of
   ADR-0027 becomes the implementation of a `hardened = true` config flag, for readers at risk, not
   the default path. The fetcher is not built today (§3.1 above), and it is not
   built until someone asks for the hardened mode.
4. The no-network gate stays, slimmed: it asserts zero requests over the corpus with the setting at
   `never`, and that is all. The observability report and the assertion-set self-check go.
5. Themes may reference `url()` for fonts and images **inside the theme's own directory**; remote
   `url()` stays refused. A theme is a document the reader chose to load; local assets are theirs.

### 3.2 Byte-frozen contracts (`package.json` `test:contracts-frozen`, `AGENTS.md` "Contracts are frozen")

**The commitment** was "changing a contract needs an ADR", a reasonable rule for a fleet of
implementors who cannot be trusted to widen an interface quietly. **The mechanism** pins five files
under `packages/core/src/contracts/` to git blob hashes in a 1,500-character inline script, and
AGENTS.md extends the freeze to "the token names, units and meanings".

**What it costs.** Every feature the author now wants touches a contract: a collection needs fields
on `index-entry.ts`; a split view needs a second position; richer copy needs the operation contract
to return more than a string. Each is an ADR plus a PR "touching only that" plus a hash update,
before the feature's first line. The frozen `shell-api` has already been amended once (ADR-0026,
"amended once for all of v1") and then again (ADR-0038), each with its own record: the freeze is
honoured in form and routed around in practice.

**Amendment.** Delete `test:contracts-frozen`. Replace it with what the freeze was for: the
invariants, as tests. "Every AST node carries `{file, start, end}`" is already a golden-file
property; "an operation never changes bytes outside its range" is the fidelity gate. A contract
change is then an ordinary PR that regenerates goldens and says why in its description. Keep
the ADR habit for *meaning* changes (a new node kind, a new selection granularity), not for
adding a field.

### 3.3 Linux at parity from the first release (brief "Platforms", scope "v1 ships", risk A1/A5)

**The commitment** was "the reader shelf on Linux is empty", which is a market observation.
**The mechanism**: a WebKitGTK weight harness, a version-keyed weight-offset token (D-A9), Linux
screenshot baselines per corpus file that **cannot be produced on the only machine the project
has** (`docs/plan/deltas/2026-09-28-stuck.md`: "The Linux PNGs cannot be produced on the Mac the
fleet runs on"; MARXY-22 deferred for want of a Linux desktop; MARXY-44 blocked on it), a
`gates` matrix on two runners, and AppImage plus Flatpak in the v1 cut.

**Amendment.** Linux builds in CI and ships as a pre-release artifact. Parity is verified when a
Linux desktop exists, by a person, as a release criterion for a *Linux* release, not a gate on
every PR. Linux screenshot baselines are deleted from the PR path (they can live in nightly, where a
missing baseline is a report, not a red PR). The weight-offset token stays; it is one line.

### 3.4 Screenshot baselines as a PR gate (ADR-0014 tier 1, ADR-0016)

**The commitment**: agents cannot see, so a machine must catch visual regressions. True when a
fleet of models that cannot see is landing forty PRs a day. **The mechanism**: 17 MB of PNG under
`fixtures/baselines/` across three engine directories, a rag baseline per corpus file, a rule that
any baseline change needs a taste-review queue row, and `gate-aesthetics.mjs` at 1,124 lines.

**What it costs.** Adding a corpus file is a cross-platform ceremony (`11-corpus-additions.md` §4
lists it). The taste-review queue has 50 dated rows, of which 41 carry no decision (counted with `awk` over rows beginning `| 20` in `docs/taste-review/queue.md`), and review #2's decision form is empty; the human half of the two-tier test has not run since 2026-09-19. The gate
therefore enforces "no change" against a baseline nobody has judged.

**Amendment.** Keep the mechanical, pure checks on every PR: grid conformance, measure, contrast,
zero layout shift, no colour on headings, horizontal overflow. They run in one engine (Playwright
WebKit on macOS) in a couple of minutes. Move screenshot and rag comparison to nightly against
`main`, producing a before/after sheet a person looks at when they choose. Taste review becomes
what the author actually does: open the app. The queue file stays as a place to note what changed
visibly; nothing requires a row.

### 3.5 Per-document trust and consent (D-A24, `trust.json`, "no global switch in v1")

Folded into §3.1. The design chose per-path, per-host consent with no global switch because a
global switch "fights chrome-at-zero and delays the first useful index" (decisions.md, Q10, for a
different setting). A `config.toml` line is not chrome. One setting, three values.

### 3.6 The fleet-shaped process (ADR-0017, 0025, 0028, 0034, 0040; `docs/sdlc.md`; `ci-contract.md`)

**The commitment**: one person cannot be the bottleneck. **The mechanism**: a board CSV with
paths per story, Jira keys in branch names enforced by `check-story --strict`, a PR template with
enforced section order, a changelog line per PR, a task card per story, a taste row per visible
change, CODEOWNERS on the orchestrator's own code, a merge bar of nine clauses, and the fleet that
consumes all of it. `02-orchestrator-audit.md` and `03-fleet-metrics.md` carry the evidence; the
verdict here is only about the *decisions*: they are process-only, they were right for a fleet,
and they bind a person exactly as hard as they bind an agent. When the fleet pauses, they pause
with it. `13-recommendation-orchestrator.md` says how.

## 4. Three ADRs to re-read, not reverse

### ADR-0001 and ADR-0005 — reader, not editor; two modes

"Reader before writer, adept at both" is compatible with both ADRs as written, with one
amendment to ADR-0005: **Source mode may be summoned for one block.** Select a block in Rendered,
press the edit key, and that block's byte range opens in CodeMirror in place; leaving splices it
back through the same transformation path. This is an operation (ADR-0004), not live rendering,
so the risk cluster ADR-0005 dissolved (contenteditable under decoration, caret in typeset lines,
round-trip normalisation) stays dissolved. The tripwire in `docs/roadmap.md` ("authoring re-enters
scope → reopen ADR-0005 first") is satisfied by this paragraph: it was reopened, and this is the
answer. `08-feature-text-operations.md` §5 argues it in full.

### ADR-0004 — no plugin or scripting API

"The user is a first-class owner of their tools" pulls against "no scripting surface, now or in
v1.1". The security argument in ADR-0004 is about *documents* causing execution, and that stays
absolute: nothing in a file runs anything. It is not an argument against the *reader* configuring
an operation. Amendment: a user-defined operation is a line in `config.toml` naming a command
(`sort`, `jq`, a script of their own) that receives the selected bytes on stdin and returns bytes on
stdout, run through the shell with no shell interpolation (D-A31 already has the whitespace-split
rule). It is pure `string → string`, it is tested by the same fidelity property, and it is the
reader's own tool. Not for the next release; recorded now so the contract is not designed to
forbid it.

### ADR-0011 — the palette is the tab manager

A collection with a quick search bar and a split view both put "which documents are open or near"
back on screen. ADR-0011 forbids a *persistent* tab bar, and its reversal criterion has never
been evaluated (review #2's decision form is empty). Re-read it as: **nothing is on screen at
rest; anything may be summoned.** A search field that appears on a keystroke and goes away, a
split whose divider is a hairline, and a collection switcher inside the palette all pass. A
permanent sidebar does not. The split-view study (`07-feature-split-view.md`) and the collection
study (`06-feature-collection-and-search.md`) are both written inside that reading.

## 5. The amendments as a list

For the author to accept or strike, one line each. Each would be one short ADR; numbers start after ADR-0043, the newest on `main`.

1. **ADR-0044 — Remote content is a reader setting.** Supersedes ADR-0027's default path; keeps
   commitment 3; `remote-images` and `html` tri-state settings; `hardened` flag keeps the shell
   fetcher for readers at risk. (§3.1, §3.5)
2. **ADR-0045 — Contracts change by pull request.** Deletes the hash freeze; invariants are tests.
   (§3.2)
3. **ADR-0046 — Linux is a release criterion, not a PR gate.** (§3.3)
4. **ADR-0047 — Visual comparison is nightly; mechanical typography checks stay on PRs.** Amends
   ADR-0014 tier 1 and ADR-0016. (§3.4)
5. **ADR-0048 — Source mode may be summoned for one block.** Amends ADR-0005. (§4)
6. **ADR-0049 — User-defined operations are configuration, not plugins.** Amends ADR-0004; not
   scheduled. (§4)
7. **ADR-0050 — "At rest" defined.** Amends ADR-0011 and design constraint 6: on screen at rest is
   the column of text; summoned surfaces may be any shape. (§4)
8. **ADR-0051 — The fleet is paused; the process it needs is paused with it.** Amends ADR-0017,
   0025, 0034, 0040 by suspension, not repeal. (§3.6, detailed in `13-recommendation-orchestrator.md`)
9. **Accept ADR-0037** (one document store) and build it first. (§2.2)
10. **Delete the product tier of `fixtures/perf-budgets.json`** and the envelope arithmetic;
    ADR-0032 already says the numbers are recorded, not gates. (§2.2)

## 6. What this does not touch

MIT. No telemetry. Byte fidelity. The AST and provenance. Sanitise always. The typography and
artifact research as authority. Dark primary. Literata and JetBrains Mono. Tauri. The parser.
Chrome at rest is zero. The six constraints and the type scale. The spirit was never the problem.

## For the synthesis

1. Keep all four commitments and all six design constraints verbatim; the over-fit is in mechanisms, not commitments.
2. The no-network webview is the clearest over-fit: it already renders the first content type (READMEs) with empty badge boxes, and the consent flow that would fix it is not reachable in the app.
3. Replace per-document, per-host consent with one three-value setting each for remote images and HTML; keep the Rust fetcher only as a hardened mode.
4. Delete the byte-hash contract freeze; keep the invariants as tests; a contract change is an ordinary PR.
5. Make Linux a release criterion, not a PR gate; its screenshot baselines cannot even be produced on the project's only machine.
6. Move screenshot and rag baselines to nightly; keep the pure mechanical typography checks on PRs.
7. Accept and build ADR-0037 (one document store) before any new feature; splits, undo and block editing all depend on it.
8. Re-read ADR-0005 to allow summoning Source for one block, and ADR-0011 as "nothing at rest, anything summoned".
9. Record (not schedule) that user-defined operations are configuration, so "owner of their tools" is not foreclosed by the contract.
10. The process ADRs are suspended with the fleet, not repealed.
