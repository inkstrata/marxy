# ADR-0036 — Artifact units: what the renderer keeps, reports, marks and copies

**Status:** accepted 2026-09-26 (the author, on MARXY-228) · **Source:** the Reader Artifacts Handbook,
`docs/research/reader-artifacts/` (drafts P01–P17 in `proposals/`) · **Depends on:** ADR-0035
(proposed; this ADR applies it) · **Amends:** ADR-0009 §1 (comments and unknown tags), ADR-0023
(reserved identifiers), design 13-trust (what the per-document grant widens) · **Supersedes:** nothing

## Context

The handbook drafted seventeen decisions. Taken one at a time they would be seventeen requests
for the author's attention, and most of them are either already implied by an accepted ADR or are
plain work that needs no decision. This record takes every one of them and gives each one of
three outcomes, so the author has **one** thing to accept or send back, clause by clause. Every
clause cites the draft that argues for it. The grades are the handbook's, and almost all of them
are **[D]**: reasoned defaults, not findings.

## Decision

### Adopted

1. **Removals are reported (P01 §1, §3).** Every element, comment and unreferenced
   `[label]: …` definition the sanitiser drops is recorded with its kind and byte range, and
   reaches the reader through the existing notices region, counted by kind. `console.info` is no
   longer the only witness. Amends ADR-0009 §1: a comment is still never *content*, but its removal
   is never silent (handbook coupling rule 5).
2. **Instruction files keep their tagged content (P01 §2).** For instruction-class files
   (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md`, `.github/copilot-instructions.md`,
   `*.instructions.md`, `*.prompt.md`, and any markdown file under `.claude/` or `.cursor/rules/`;
   the list is owned by handbook chapter 02 and lives in one core constant), an unknown non-void element
   keeps its children and shows its tag name as an inline label. `script`, `style`, `iframe`,
   `object`, `embed`, `form` and everything that fetches are still removed with their contents.
   Other files are unchanged.
3. **Reserved and clobbering identifiers are refused (P02).** A document may not set an `id` or
   `name` beginning `marxy-`, a class beginning `marxy-`, or an `id`/`name` equal to a property of
   `window` or `document`, whatever other attributes the element carries. This is what ADR-0023
   already intended; the public provenance attribute no longer exempts a tag.
4. **Inert layout HTML is in the default policy (P03).** `align` on `div`, `p` and `h1`–`h6`;
   `width` and `height` on `img`; `details` and `summary` with `open` as a boolean. `<picture>` and
   GitHub's `#gh-dark-mode-only` / `#gh-light-mode-only` fragments resolve to **one** image for the
   active variant, and only that one is ever requested (under ADR-0027's grant). The per-document
   grant of design 13-trust narrows to remote images.
5. **Copy is exact where the text is code (P06 §1, §2, §4).** The smart-typography pass never
   runs inside `code`, `kbd`, `samp` or a fence, including elements opened by raw HTML. A block copy
   ends in a newline only if the source bytes did. A drag selection in prose still copies rendered
   text (design 03 unchanged).
6. **Diffs get four colour tokens (P07, tokens only).** `--marxy-color-diff-add`,
   `--marxy-color-diff-del`, `--marxy-color-diff-add-word`, `--marxy-color-diff-del-word`, kind
   `colour`, with the measured defaults of handbook chapter 9 (dark `#1b2f28`, `#2d140b`,
   `#1f4438`, `#4a1e0e`; light `#cce3c6`, `#ffe7e6`, `#c0e2b8`, `#ffdcdb`). The `+`, `-` and space
   marker stays text and is the primary cue; the tint is a second channel. A log level is carried by
   weight, through a registered class, never by a token hue.
7. **Front matter is a document head (P08), with no new token.** YAML and TOML front matter
   render as a quiet key and value head at `--marxy-size-caption`. The 14ch key column and the
   12-line cap are the default theme's CSS and a core constant, not contract.
8. **Lenses are not operations (P05).** A lens (reveal hidden, fold a data fence, changed since
   last read, jump to source) is a palette-invoked view command, pure over its inputs, feeding no
   splice and no clipboard, and outside `contracts/operation.ts`. A new pure operation is an
   additive registration listed in `docs/operations.md`, not a contract change. (It does not move
   any operation into v1; `docs/scope.md` still decides that.)
9. **A token joins the contract only with a reader and a check (P14).** A stylesheet must read it
   and a gate must be able to fail on it.

### Declined, with the reason recorded

10. **No scroller for diffs and logs (P11).** ADR-0033 §5 stands: code wraps with a 2ch hang and a
    rule. No study favours scrolling, and it costs a scrollbar and a focus stop per block. A diff
    continuation must hang past the marker column, so it never reads as a new `+` or `-` line.
11. **No rendered diagrams in v1 (P16).** A diagram fence shows its source and one muted caption.
    Mermaid's `elkjs` dependency is EPL-2.0, and ADR-0006 is not reopened for it.

### Deferred to v1.1, not decided here

12. **P04** (`OperationInput.source`), **P09** (an anchor on the reading position; amends
    ADR-0018) and **P10** (a derived JSONL transcript view; the AST contract) each change a frozen
    contract for work `docs/scope.md` puts after v1. Each is re-proposed with the story that needs it.

### No decision needed

**P12** (register names), **P13** (grammar allow-list), **P15** (links and heading ids) and
**P17** (a gate on the shipped CSP and commands) are work under rules that already exist: the
registry, the licence gate, the shell API as frozen, and ADR-0009. They are stories, not records.

## Consequences

- One acceptance unblocks the stories that change the sanitiser policy, the theme contract and the
  rendered head. The contract half (clause 6) lands in its own PR, touching only `tokens.css`,
  `tokens.contract.json`, `docs/theme-contract.md` and this ADR's status, as AGENTS.md requires.
- `packages/core/src/sanitize/` stays CODEOWNERS-gated (ADR-0028). The stories group every policy
  change into as few pull requests as the paths allow, so the author reviews that path twice, not seven times.
- Every default value here is the handbook's measured or judged starting point. The taste review
  confirms or tunes it after it ships; it is never a blocker before.

## What would falsify it

Per clause, the handbook's `limits.md` lists the result that would reverse it. The two most
likely are: evidence that target agents strip HTML comments (clause 1 becomes noise for them), and
a theme that cannot hold 4.5:1 for every token on all four tints (clause 6 needs other values, not
another design).
