# ADR-0031 — The token contract is names and units; the default theme's values are taste

**Status:** accepted 2026-09-19 (MARXY-133) · **Source:** taste review #0 and #1 (`docs/taste-review/2026-09-review-0/decisions.md`,
`2026-09-review-1/decisions.md`), ADR-0008, ADR-0014, ADR-0024

## Context

`packages/theme/src/tokens.css` is frozen byte-for-byte: `pnpm test:contracts-frozen` pins its blob
hash next to the `packages/*/src/contracts/` files, and `AGENTS.md` says changing anything in it needs
an ADR and a pull request touching only that. The file is also where every value of the default **dark**
variant lives — `--marxy-line-box: 28px`, `--marxy-size-code: 14px`, `--marxy-weight-heading: 600` —
while the light variant's values sit in `packages/theme/default/theme.css`, which is not frozen. Dark is
the primary variant (ADR-0024), so the asymmetry falls the wrong way: the variant that matters most is
the one that cannot be tuned.

Taste review #1's verdict on the first styled page was **"not a book yet"**, and six of the named
faults are one value each: heading vertical space, code-block padding, a weak italic, a too-subtle
quote rule, checkbox alignment, table density. Taste review #0 adds two more on pair A: the mono is
slightly small and the headings shout. Under the rule as written, every one of those tunes is a
contract change needing its own ADR, so the one thing the project competes on is the one thing it is
hardest to change. That is the rule inverting its own purpose: the freeze exists so a *theme author*
can rely on the tokens, and a theme author relies on the names, the units and the meanings — not on
Marxy's choice of 28px.

## Decision

1. The theme contract is **the set of `--marxy-*` token names, each one's unit or kind, and its
   documented meaning**. That is what is frozen, and changing it still needs an ADR and a PR touching
   only that (ADR-0008, `AGENTS.md`).
2. **Values are not contract.** The default theme's values may change in any story whose paths name
   the theme, with a taste-review queue row and a before/after artifact (ADR-0014, ADR-0016) — never
   with an ADR.
3. `pnpm test:contracts-frozen` stops byte-pinning `packages/theme/src/tokens.css` and checks the
   contract instead: `scripts/check-tokens.mjs` compares the declarations in `tokens.css` against a
   committed snapshot of **name → unit kind** (`length`, `number`, `colour`, `family`, `ratio`,
   `keyword`) and fails when a name is added, removed or changes kind. The `packages/*/src/contracts/`
   files keep their byte pins, unchanged.
4. A token's meaning is carried by its comment in `tokens.css`; the snapshot records the comment's
   presence, not its prose, so wording is free and a silent re-definition still has to survive review.

## Consequences

- A taste decision costs a story and a queue row, which is what ADR-0016 already prescribes for
  everything a machine cannot judge. It no longer also costs an ADR.
- A theme author's guarantee is stated where it is true: names and units. `docs/theme-contract.md`
  says so, and the contract version in `theme.toml` is bumped by a name change, not by a tune.
- The aesthetics tier (ADR-0014) is what protects the values: grid, measure, contrast and the
  screenshot baselines are computed from the live tokens, so a bad tune fails a gate rather than
  passing because nobody noticed.
- No pull request has to edit `tokens.css` to make this true: the story that accepts this ADR removes
  the pin, adds the check and the snapshot, and moves no value. The first *tune* then edits the file
  freely, under a queue row.
- Rejected for now: moving dark's values into `packages/theme/default/theme.css` beside light's and
  keeping the byte pin. That is the cleaner end state — ADR-0008 wants the default theme to *be* a
  theme, and half of it already is — but `tokens.css` would then either duplicate every value as a
  fallback or leave a theme that sets nothing unstyled, and the move would land in the same pull
  request as a mechanism change while invalidating the MARXY-20 and MARXY-21 artifacts. It stays open
  as Phase 1 work under ADR-0008, after the tunes land; this ADR does not prejudge it, because under
  it the values are free wherever they live.
- Most of taste review #1's faults are not tokens at all — heading margins, code-block padding,
  checkbox alignment and table padding are rules in the system-owned `packages/theme/src/base.css`,
  which was never frozen. This ADR is what the two *size and weight* tunes from review #0 need.
