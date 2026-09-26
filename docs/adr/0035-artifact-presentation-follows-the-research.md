# ADR-0035 — Artifact presentation follows the reader-artifacts research; where two handbooks meet, the owner of the property decides

**Status:** proposed (MARXY-211) · **Source:** `docs/research/reader-artifacts/` (the Reader Artifacts
Handbook), `docs/research/reader-typography/` (ADR-0033) · **Extends:** ADR-0033 (which made the
typography handbook the authority for typography) · **Supersedes:** nothing; no value changes here

## Context

ADR-0033 made the Reader Typography Handbook the authority for how Marxy sets text, and it has
been applied: the measure, the size, the code voice, the hyphenation costs. That handbook is about
text as text. Three of Marxy's four content types (READMEs, agent artifacts and source files) are
mostly *not* prose, and the questions they raise are about units rather than lines: what a turn
in a transcript is, how much of a tool's output a reader sees before asking, what a diff looks
like when colour cannot carry it, what happens to an HTML comment in `AGENTS.md` that the agent
reads and the rendered page hides, what copying a selection should yield, and what a reader can do
with byte provenance that no other reader can.

The Reader Artifacts Handbook answers those, with the same evidence grades. The two handbooks meet
on code blocks, the measure, the baseline grid and colour. Without a rule, a story can cite
whichever handbook suits it, and two defaults that each have research behind them can contradict
each other on the same element. The typography handbook's own spec says code "scrolls in its own
container", for example, while ADR-0033 §5 chose to wrap with a hanging, marked continuation
because chrome at rest is zero; the artifacts handbook has its own reasons about continuation
lines in diffs and logs. Somebody has to decide which argument governs, and on what basis.

## Decision

1. **The Reader Artifacts Handbook is the authority for how a non-prose unit is structured,
   shown, marked, folded, trusted and operated on**: transcripts and their turns, tool calls and
   results, plans and checklists, instruction files and prompts, front matter, structured data,
   logs and terminal output, diffs, README conventions (badges, alerts, collapsibles, diagrams,
   hero blocks), invisible and bidirectional characters, links and remote content, line-number
   gutters, copy semantics, and every operation that follows from byte provenance. A change in
   those areas cites the chapter it follows and the grade, or says why it departs.
2. **The Reader Typography Handbook remains the authority for how any text is set** (ADR-0033):
   faces, sizes and x-height matching, weight in each variant, leading, the prose measure, line
   breaking and hyphenation, contrast floors, and the separate design of dark and light.
3. **Where both handbooks speak to the same property, the claim with the higher grade wins.**
   Grades are compared claim against claim, not handbook against handbook. An **[X]** claim never
   wins on grade: a contested question goes to the owner.
4. **On equal grades, the owner of the property decides**, as the table below assigns it. Most
   overlaps are **[D]** against **[D]**, so this clause does most of the work.
5. **Accepted ADRs bind both handbooks.** A handbook changes a decision an ADR records only
   through a new ADR, as ADR-0033 did for ADR-0015. Neither handbook's spec line is itself a
   decision until a story or an ADR applies it.
6. **One grading scheme.** Both handbooks use [A] replicated, [B] one good study, [C] small or
   mixed, [D] convention, [X] contested, with the same meanings. Convergence of shipping tools is
   **[D]**, stated with its count ("converged: 7 of 10"). It shows what readers expect, not what
   helps them, and it never outranks a study.

### The overlap table

| Property | Owner on equal grades | Why that owner |
| --- | --- | --- |
| Code face, size, x-height match, weight on dark and light | Typography | Glyph-level setting; `06-code.md`, `03-fonts.md` |
| Code leading and the code line box as a grid multiple | Typography | A line-level measure (ADR-0030, ADR-0033 §2) |
| Syntax-colour restraint and every token's contrast floor | Typography | `06-code.md`; artifacts colours must meet the same floors |
| Colour roles new to artifacts (diff, alert, marker, notice) | Artifacts | New roles; each must clear typography's floors |
| Code block width: authored width into the margin | Typography | A measure question (ADR-0033 §5) |
| What a continuation line looks like, and whether a kind of content may wrap at all (diffs, logs, JSONL, indentation-sensitive code) | Artifacts | A unit question: a continuation must never read as a new record |
| Break opportunities inside inline code (paths, URLs, identifiers) | Artifacts | What a break means depends on what the string is |
| Break costs and the paragraph those spans sit in | Typography | Knuth–Plass (ADR-0007, `05-line-breaking.md`) |
| The prose measure, including prose inside transcripts and READMEs | Typography | ADR-0033 §1 |
| Where islands (code, tables, folds, notices, gutters) snap on the grid | Typography | ADR-0030; artifacts units must be grid multiples |
| Table typography (figures, alignment, scroll container) | Typography | `07-content-types.md` |
| Which README tables, badges, alerts and collapsibles are shown, and how | Artifacts | `06-readmes.md` |
| Speaker labels and turns in transcripts | Artifacts for structure; typography for the label's type | `02-agent-artifacts.md`; `07-content-types.md` "Letters, diaries and messages" |
| Admonition labels | Artifacts for structure; typography for the label's type | Both say "by label, not colour" |
| Line-number gutters, fold markers, copy semantics | Artifacts | Units and operations |
| Invisible, bidirectional and confusable characters | Artifacts | Trust (ADR-0009) |

## Consequences

- No value changes with this ADR. Where the artifacts handbook recommends something that differs
  from what Marxy does, its spec line is marked open and its story list carries the work.
- Several recommendations need decisions that are not the handbook's to make: the sanitiser's
  treatment of unknown tags and comments in instruction files, front matter in the rendered view,
  new token names for diff and alert colours, operations that need two ranges or a view state.
  Each is drafted as an ADR proposal under `docs/research/reader-artifacts/proposals/`, not as an
  edit, and becomes an ADR only when the author accepts it.
- A reviewer who sees a story cite one handbook where the table assigns the property to the other
  asks for the owner's chapter, or for a higher-graded claim.
- The typography handbook's "Code | … scrolls in its own container" line is read with ADR-0033 §5,
  which decided wrapping; this ADR does not reopen it, and the artifacts handbook's position on
  continuation lines is additive (how a continuation is marked, and which content may never wrap
  silently).

## What would falsify it

A story that cannot be decided by this rule: two claims of equal grade on a property the table does
not list, with owners that disagree. The fix is a new row, added by amendment, not a judgement
made case by case.
