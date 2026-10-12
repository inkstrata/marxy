# ADR-0068 — Generous highlighting: a hue per code role, one role table for both modes

- **Status:** proposed (V-13; the ruling is the author's, K-R2, 2026-10-08)
- **Date:** 2026-10-12
- **Amends:** ADR-0033 section 5's minimal palette (it keeps the rest of 0033). **Reads:** ADR-0059 (token contract v2),
  ADR-0045 (contracts change by pull request), ADR-0070 (the pair).
- **Evidence:** `docs/plan/direction-2026-10/13-code-view.md` section 4; X-21 gap 11
  (`docs/plan/direction-2026-10/17-design-pass-chrome.md`); `docs/research/reader-typography/06-code.md`.

## Context

ADR-0033 followed the "Alabaster" school: colour strings, constants, comments and definitions, and leave keywords,
types, calls and variables in the text colour. Seven of the twelve roles fell back to the code text, which left four
hues. The author, reading code in the installed app, found highlighting weak, and X-21 measured the gap against the
mock: the app coloured calls and strings only, where the mock gives keywords, types, constants and comments their own
hues, with comments in italic.

The evidence under highlighting is thin and graded **[D]** either way: the largest study (390 students) found no gain
in comprehension from colour. So the breadth of the palette is a matter of taste, and the author ruled for generous.

The two modes had also drifted. Rendered (Shiki) and Source (Lezer) coloured the same Python differently: decorators,
builtins left uncalled, escapes, f-string placeholders, Rust macros and attribute values. Four Lezer tags matched no
rule at all (`escape`, `macroName`, `labelName`, `attributeValue`).

## Decision

1. **Every role has its own hue in the default theme, in Night and Paper.** Variables and punctuation stay the code
   text; operators take a quiet tint. Comments are italic and stay readable, not dimmed.
2. **Six token names are added to contract 2:** `--marxy-tok-builtin`, `-property`, `-decorator`, `-self`, `-escape` and
   `-mark`. (`-heading` and `-marker` and `-link` are already contract 2's.) Each is a colour. A theme that sets none
   of them gets the v1-derived fallback in `tokens.css` (for example `-escape` is `-string`), so Ink and any user theme
   load unchanged and read as before.
3. **One role table** (`packages/core/src/highlight/roles.ts`) names, for each role, the Lezer tags that cover it in
   Source and the TextMate scopes that cover it in Rendered. Source's `HighlightStyle` and Rendered's internal Shiki
   theme are both built from it, so a token gets the same role in both. Rendered resolves a scope by its longest
   matching prefix, as a TextMate theme does. `heading`, `marker`, `link` and `mark` are Source-only: Rendered sets
   headings as type and draws no marks.
4. **The palette is built in OKLCH and tested.** Every role is at least 4.5:1 on the code ground and the page ground in
   both variants; the pairs that sit side by side in code (keyword and function, type and variable, string and escape)
   differ in OKLab lightness by 0.05 or more; comments are at least 5:1. `palettes.test.mjs` holds all three.
5. **Definitions take weight as well as colour** in Source (600), as the handbook's sample does. JetBrains Mono keeps its
   advance at every weight. Rendered does not yet: Shiki does not tell a definition from a use without a second set of
   scopes, which is a later story.
6. **Status never takes a token hue.** Diff and log severity keep their own tints (`04-code-typography.md`, "Colour
   budget"): generous applies to syntax.
7. **Markdown in Source is generous too:** headings, their `#` marks and the setext underline take `-heading`, with ATX
   levels kept by weight (never size, so every row stays one line); link text takes `-link`, destinations and inline
   code take the string hue; quote marks, list bullets and numbers and the rule take `-mark`.

## Consequences

- The aesthetics baselines move and are regenerated in the PR.
- Where Lezer cannot tell what Shiki can (Python `self` and builtins have no Lezer tag; the Rust grammar leaves a field
  access and a string escape untagged), the parity test lists the construct as a named gap with its reason. A gap that
  closes fails the test until it is removed.
- A Lezer grammar for Go and shell is V-14; until then Rendered's roles for those are tested alone.
- Frontmatter delimiters as `decorator` with a YAML body is not done here: `@lezer/markdown` parses a leading `---`
  block as a rule and a setext heading, so it needs a block parser of its own.
