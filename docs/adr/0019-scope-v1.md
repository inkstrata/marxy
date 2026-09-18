# ADR-0019 — The v1 cut

**Status:** accepted · **Source:** `docs/scope.md`; brainstorm docs/13, A5

## Decision
v1 is the smallest thing that is categorically better than the incumbents at reading, on
macOS and Linux: open/watch/live-reload with position kept; Rendered and Source; CommonMark +
GFM with the sanitiser; index of the enclosing repository with a palette over titles,
headings and paths; MRU and back/forward; four operations proving the mechanism (copy
section, copy code block clean, toggle task item, align table pipes); highlighting from an
allow-list of ~20 grammars; images with reserved dimensions and remote blocked; KaTeX on first
use; Knuth–Plass ragged-right with hanging punctuation on a baseline grid; bundled Literata
and JetBrains Mono; one default theme in light and dark implemented as a theme, and user
theme loading under the published contract; outline; find; keyboard-complete.

**Not in v1:** content search, the rest of the operations catalogue, encoding utilities,
Mermaid, export/PDF, plugins, scripting, spines and transclusion, cross-document operations,
wikilinks, Windows, a settings UI (a config file suffices), the theme linter, a resident mode
by default.

## Why
The most likely failure is never shipping. Surface quality substitutes for feature breadth in
this category to an unusual degree (Typora's retention with no sync, library or mobile).
Every cut above is a weekend once the mechanism exists; none of them is what a reader notices
in the first ten minutes.
