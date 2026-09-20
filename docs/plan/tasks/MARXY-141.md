---
key: MARXY-141
design: [05-theme]
depends: []
verify: [pnpm precheck, pnpm done MARXY-141]
---
# MARXY-141 — amend ADR-0030: a table is an island the grid pass pads

**Design:** [05-theme](../../design/05-theme.md) · **Depends on:** nothing · **ADRs:** ADR-0030 (accepted; amended here), ADR-0014.

**Outcome.** The accepted decision record and the shipping stylesheet say the same thing about tables, so
PR #94 (MARXY-128) can merge as it stands. **No code changes in this story.** It is an ADR amendment and
the one design-document sentence that has to match it.

## The conflict
ADR-0030 decision 3: *"Tables sit on the grid by construction (one line box per row, rules drawn as inset
shadows that take no height)."* Decision 4 enumerates what `snapToGrid` pads — code on its own line box,
images, math, inline content in a raw-HTML island — and tables are deliberately not in that list.

MARXY-128's `base.css` sets `table { line-height: var(--marxy-line-box-code) }` and half-unit cell
padding, so a row is 22 + 28 = 50 px and a table is no longer a whole number of 14 px units. The PR is
honest about it ("Tables are now islands like code") and updates `docs/design/05-theme.md`, but
`docs/adr/` is outside its paths, so the ADR still says the opposite. AGENTS.md is explicit that the ADRs
win and that a PR whose decision changed updates the ADR; the implementor could not, and reverting the
table rule is not available either because MARXY-128's criterion 7 requires it. Hence a planner story.

**The measurement, from the MARXY-128 review — quote it in the amendment.** Re-adding
`01-long-technical.md` to `grid.test.mjs`'s `TEXT_ONLY` set (the set the stylesheet alone must hold,
*without* `snapToGrid`) fails at PR #94's head: ten blocks land 8 px off the 14 px unit, starting at the
first block after the weighted-passes table — `<p s=3308>` top 2122.00, `<h3 s=3354>` top 2178.00, …
`<h2 s=4709>` top 2850.00. Every corpus file still passes *after* the grid pass, so the page is correct
in the app. What moved is the "CSS alone" guarantee, and `TEXT_ONLY` narrows to one fixture
(`14-marxy-plan.md`). That narrowing is a real cost and the amendment records it rather than letting it
happen quietly.

## Files
- `docs/adr/0030-grid-unit-is-half-a-line.md` — an **Amendment** section; the original decisions stay
  readable. Follow ADR-0022's amendment shape.
- `docs/adr/README.md` — the ADR-0030 row names the amendment and its date.
- `docs/design/05-theme.md` — the table sentence, in the same words as the amendment.

## Do this, in order
1. Read ADR-0030 in full, then ADR-0022's amendment for the shape.
2. Write the amendment: tables move from decision 3's by-construction list into decision 4's
   `snapToGrid` set; decision 3's heading construction is restated as `half` margin plus a
   `padding-bottom` remainder, with a sentence saying decision 2's numbers survive (22 px total at 17 px)
   so a reader does not think the type scale moved.
3. Record the consequence and the evidence: the CSS-alone guarantee no longer covers a document with a
   table; `TEXT_ONLY` narrows to `14-marxy-plan.md`; the ten offsets above.
4. Write the falsifier: if a table can be made a whole number of grid units by construction at any cell
   padding the design wants, this amendment is wrong and decision 3 stands.
5. Mirror the one sentence into `docs/design/05-theme.md`; update `docs/adr/README.md`.

## Tests → expected
There is no test file in these paths, so the checks are the ADR body and the boundary — the MARXY-58
precedent.

| Check | Expect |
| --- | --- |
| ADR-0030 | an Amendment section dated 2026-09-19 naming this story; tables in the `snapToGrid` set; the heading construction restated; decision 2 stated as unchanged |
| ADR-0030 | the narrowing of `TEXT_ONLY` and the ten measured offsets are in the text |
| ADR-0030 | a falsifier sentence; no decision text deleted or rewritten in place |
| `docs/adr/README.md` | the ADR-0030 row names the amendment and the date |
| `docs/design/05-theme.md` | says the same thing in the same words |
| the diff | three files plus `CHANGELOG.md`; nothing under `packages/` or `apps/` |

## Acceptance → check
The row's eight criteria in order, each against the ADR body, the index row, the design sentence or the
story boundary.

## Do not
Edit any file under `packages/` or `apps/` — in particular not `packages/theme/test/grid.test.mjs`, which
MARXY-128 owns and whose PR is open. Change a token or a value. Delete or rewrite decision 3 or 4 in place
— amend. Restate decision 2's numbers. Merge or rebase PR #94 yourself. Open a second ADR: this is an
amendment, not a superseding record, because only two of four decisions move.
