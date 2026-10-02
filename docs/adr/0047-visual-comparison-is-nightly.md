# ADR-0047 — Visual comparison is nightly; the mechanical typography checks stay on pull requests

- **Status:** proposed (audit 2026-10)
- **Date:** 2026-10-02
- **Amends:** ADR-0014 tier 1 (the "rag not worse than baseline" clause and the per-PR screenshot
  diff) and ADR-0016 ("screenshot diffs per shipped engine" fail a build; every visible PR attaches
  screenshots and appends a queue entry). ADR-0014 tier 2 and ADR-0033 stand.
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §2.3 and §3.4.

## Context

ADR-0014's first tier is mechanical because an agent cannot see. Most of it is pure and cheap:
grid conformance, measure, contrast, zero layout shift, no colour on headings, no horizontal
overflow. Two parts are not. Rag metrics are compared with a stored baseline and refused at 5 %
worse (`checkRag` in `scripts/gate-aesthetics.mjs`, baselines in `fixtures/baselines/rag/`), and
screenshots are compared per engine against 17 MB of PNG under `fixtures/baselines/`. Both enforce
"no change" against a baseline nobody judged: `docs/taste-review/queue.md` has 50 dated rows, 41
without a decision, and the human tier has not run since 2026-09-19. Adding a corpus file is a
ceremony, and a deliberate typographic change must first move the baselines it is about.

## Decision

1. **On every pull request, in one engine (Playwright WebKit on macOS), `gate:aesthetics` runs the
   checks that cannot be argued with:** baseline-grid conformance, measure, body contrast, zero
   layout shift after fonts and images resolve, no colour on headings, and horizontal overflow.
   `pnpm gate:aesthetics` and the `pnpm precheck` mapping for typography paths keep them.
2. **Screenshot and rag comparison move to `.github/workflows/nightly.yml`**, against `main`. A
   difference does not fail anything. The job writes a before/after sheet, the corpus rendered now
   beside the last accepted render, and uploads it as an artifact.
3. **A person looks at the sheet when they choose.** Accepting a change is regenerating the
   baselines in a pull request, with `node scripts/gate-aesthetics.mjs --update`, whenever the
   author likes. No clause of any gate waits on it.
4. **No gate requires a taste-queue row.** `scripts/check-pr.mjs` already treats a queue fragment as
   optional (MARXY-324); this ADR makes that the rule everywhere. The `ci` step named "baselines
   have a queue entry" in `.github/workflows/ci.yml` is renamed. `docs/taste-review/queue.md` stays as
   a place to note what changed visibly, and nothing requires a row.
5. **Where the research gives a default, it is the default** (ADR-0033). A typographic change cites
   the chapter of `docs/research/reader-typography/` it follows; the check is the mechanical tier,
   not a stored picture.
6. **`docs/aesthetics-acceptance.md` and `docs/design/10-gates-and-testing.md`** are updated to say
   so, and `fixtures/perf-budgets.json` is untouched here (a separate story owns it).

## Consequences

- The browser job on a pull request does one render pass over the corpus for the pure checks and
  none for comparison. Adding a corpus file regenerates one engine's baselines (ADR-0046).
- A visual regression that passes every mechanical check reaches `main` and shows up on the next
  nightly sheet. For a project with one author who opens the app daily, that is the cheaper trade.
- Rag stays measured, never enforced. The numbers are still printed.
- `--update` and the baseline directories survive; only their enforcement point moves.

## Rejected

- **Delete the screenshot baselines.** The nightly sheet needs a "before".
- **Keep the screenshot diff, drop only the taste row.** The diff, not the row, is what blocks an
  honest typographic change.
- **A visual-diff service.** A paid dependency for a judgement the author makes by looking.

## How we would know this was wrong

1. Two nightly sheets in a row show a regression the author only sees days later and wishes had
   been caught on its pull request: put that one check back on the PR path, as a pure check.
2. The sheet is never opened: stop generating it and delete the baselines.
