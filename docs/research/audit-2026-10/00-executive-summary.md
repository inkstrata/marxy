# 00 — Executive summary

**Date:** 2026-10-01 · **For:** the author · **Scope:** the Marxy codebase, the agent fleet that
built it, the decisions that bind it, its speed, and the three feature directions raised.

**The one-paragraph version.** Marxy's product core is good and its machinery is in the way.
The parse-to-page path with byte provenance is sound, the page is typeset to the research, and
start-up is 292 ms on this machine. Around that core sits a fleet orchestrator, a gate suite and
a process that together are larger than the product, that landed 278 pull requests in fourteen
days of which 170 were about themselves, and that ran with the cheapest models in the two seats
the design assumes are strong. The author's intuition is right: pause the fleet, prune the
process to what protects readers, loosen six mechanisms that have outgrown the commitments they
served (the no-network webview first), refactor the app shell once, and then build collections,
copy operations and the split view in that order. None of the four commitments and none of the
six design constraints need to change. Five new corpus texts come with this audit.

## 1. Where the project is

| | Measured | Where |
| --- | --- | --- |
| Product source | 22,474 lines | `01` [C1] |
| Tests, gates and orchestrator around it | 18,714 + 8,504 + 14,797 + 15,406 lines | `01` [C1] |
| Share of changes on `main` that touched product source | 17 % | `01` [C12] |
| `docs/scope.md` v1 items reachable / built-but-unwired / partial / missing | 17 / 4 / 5 / 5 of 31 | `01` §1.4 |
| Tagged releases | none | `04` §1.3 |
| Start-up to a laid-out 20 KB document | 292 ms median | `05` §4 |
| First text for a 1 MB document | 4.2–5.2 s, 766 MB | `05` §9 |
| Merged PRs in 14 days, and the share about process | 278, 61 % | `03` |
| Reviews done by the cheapest model | 76 of 80 | `13` §5 |
| Build health | typecheck, lint, 1,191 tests, `cargo check` green | `01` §5 |

The repository's own admission ("the machinery is further along than the product") is exact.
The product is a sixth of the change and about half of v1, and the half that exists looks right:
the screenshots under `fixtures/baselines/webkit-macos/` show a page that already clears the
"ordinary markdown viewer" bar. Two things a reader hits at once are broken: launching from the
Dock leaves document search empty for the session, and opening a file in a second repository
searches the first (`01` §1.3, reproduced). Both come from the index being idle-time start-up
work with no owner.

## 2. The orchestrator

**Verdict: pause, freeze in place, resume as a pilot when five conditions hold; extract to its
own repository only after that.** The engine (an append-only event log with fencing, a
level-triggered reconciler, bounded workers, head-pinned signed approvals) is sound and worth
keeping. The rest grew one stall at a time: five waves, 15,404 net lines, and in the last 59
recorded hours 139 conflict-resolution runs against 86 implementation runs, 19 stories parked as
unresolvable, and a human queue that rose from 9 to 30. Most of the contention was over the
process's own files (`CHANGELOG.md` in 239 of 286 commits, the plan CSV in 116), not the product.

The author's reason ("good for a stable codebase, premature for a prototype") is right and the
record sharpens it: the fleet needs **stable seams, a plan written by a person, a process pruned
to the product's needs, and a reviewer stronger than the implementor**. It had none of the four.
The last point is a cost decision the author made, and it mattered more than the codebase's youth:
with Composer reviewing and Grok planning, the process became the only reliable check and grew to
compensate. For a resumed pilot, pay for the reviewer, not the implementor. `13` has the five
resume conditions, each a command, and the pilot's stop rules.

**Separate repositories?** Yes, later. The couplings are known (`02` §6) and the engine is about
2,700 lines; extracting now turns a pause into a project on a tool that has not yet run smoothly
for three days anywhere.

## 3. The codebase

**Verdict: one refactor before any feature, then features in dependency order; manage as one
person plus ad-hoc agents on trunk with a pruned PR path.** The sequence (`12` §3):

1. Give the index an owner (fixes both reproduced defects; the foundation for collections).
2. Build ADR-0037's document store **for N documents** with a per-article view, and make
   `app.ts` (1,399 lines, 33 module-level variables) a composition root under 300 lines. This is
   the precondition for the split view and the cure for three undo and save defects.
3. Wire what is already built: a palette that lists every command, the light variant, text size,
   the outline, open in external editor, drag to open. Six scope items close in days.
4. Delete about 1,700 dead or parallel lines, including a 573-line Rust indexer that is not
   compiled in and a second render pipeline that the aesthetics gate measures instead of the app.
5. Unfreeze the contracts and make `Shell` the real interface (9 of 29 members are unimplemented).
6. The two large-document levers: the quadratic grid pass and a first paint from the first two
   screens. Agent transcripts and logs routinely exceed 1 MB; Marxy falls over between 256 KB and 1 MB.

Then collections and quick search, the copy and extract operations with one themed verb menu,
the split view, transforms and edit-one-block-in-Source, and on-demand content search. The
three feature studies agree on that order and on what not to build (a persistent search bar, a
`tantivy` index, a hover copy glyph, a diff disguised as a split, OS windows as the split).

**The PR path** shrinks from 16 artefacts to 4 (a conventional subject, a changelog fragment,
green product gates, a review) and from 22.7 to about 8 runner-minutes per product PR (`04` §6).
What stays on every PR is what an agent cannot see: byte fidelity, the sanitiser vectors, goldens,
no-network, boundaries, the mechanical typography checks. What leaves is what cannot fail for the
diff in front of it.

## 4. The decisions

**Verdict: keep the four commitments and six constraints verbatim; amend six mechanisms; re-read
three ADRs.** The over-fit is in mechanisms promoted to commitments and then enforced by gates,
hashes and CODEOWNERS (`10`):

| Mechanism | What it costs today | Amendment |
| --- | --- | --- |
| The webview has no network (ADR-0027, D-A22) | READMEs, the first content type, render badges as empty boxes; the consent flow that would fix it is declared in the contract and not implemented in the shell | One three-value setting each for remote images and HTML; the Rust fetcher kept only as a hardened mode |
| Byte-frozen contracts | Every wanted feature needs an ADR before its first line; the freeze is routed around (`Shell` amended twice) | Contracts change by PR; invariants stay as tests |
| Linux parity at first release | Baselines that cannot be produced on the project's only machine; a story blocked on it | Linux is a release criterion when hardware exists |
| Screenshot baselines on every PR | 17 MB of PNG, a cross-platform ceremony per corpus file, 41 of 50 taste rows undecided | Visual comparison nightly; mechanical checks stay |
| Per-document per-host consent | A store that persists a choice nothing acts on | Folded into the setting above |
| The fleet-shaped process | Ten of sixteen PR artefacts serve the process | Suspended with the fleet |

Three ADRs are re-read, not reversed: ADR-0005 allows Source to be summoned for one block (the
"adept at both" clause, an operation, not live rendering); ADR-0011 is read as "nothing at rest,
anything summoned", which a hairline split and a palette-scoped collection both pass; ADR-0004
records, without scheduling, that a user-defined operation is configuration, not a plugin, so
"owner of their tools" is not foreclosed. Eight short ADRs (0044 to 0051) would record all of it.

## 5. Speed

Start-up for normal documents is already near the original 300 ms target (292 ms to a laid-out
page, 80 % of it Tauri and WebKit), the typesetter is not a cost (0–27 ms, after first text, and
the kill switch changes nothing), and the bundle, fonts and parser are not levers. The real
problem is scale: a forced whole-document layout plus a quadratic grid pass before first text.
The perf apparatus (about 1,570 lines, 97 self-tests) measures two numbers that cannot fail and
never sees typeset, reload, open, find or the palette; a nightly run of the existing app harness
would observe six of seven budgets for a fraction of the code. The official start-up
measurement produced no sample at all on a locked screen, which is how this audit found it (`05`).

## 6. Five new corpus texts

`11` describes them and the gate ceremony they trigger. They fill the gaps the content priority
order names: a pasted assistant answer with every quirk a chat produces, a GitHub issue and review
thread, a notebook export, an original long essay for the typesetter, and a deterministic 230 KB
reference as the scale fixture the performance findings call for.

## 7. What to do this week

1. Read `10` and strike or accept each of the ten amendments in its §5; they decide everything else.
2. Add `orchestration/PAUSED.md`; take `check-story --strict`, `check-pr` and the orchestrator
   tests off the product PR path (`13` §3.1, `04` §6).
3. Start step 1 of `12` (the index owner); it is a bug fix a reader feels.
4. Tag v0.1.0, unsigned, so the release workflow is real; it has never completed a run.
5. Decide the one question only the author can: whether a searchable list of folders, never browsed,
   is consistent with the brief's "library browsing" exclusion (`06`). The collection design
   assumes yes.

## The documents

| | | |
| --- | --- | --- |
| `01` codebase audit | `02` orchestrator audit | `03` fleet metrics |
| `04` tests and gates | `05` performance audit | `06` collections and search |
| `07` split view | `08` text operations | `09` decision inventory |
| `10` over-fit decisions | `11` corpus additions | `12` codebase recommendation |
| `13` orchestrator recommendation | `14` roadmap proposal | `README.md` index |
