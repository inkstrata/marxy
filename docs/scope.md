# Scope — v1 and what it is not

**Inclusion test:** does someone reading a long technical document notice its absence in the
first ten minutes? **Governing risk:** never shipping (A5). Recorded as ADR-0019.

## v1 ships

**Documents.** Open a file (argument, double-click, drag, `open -a`); watch it and live-reload
on external change with reading position kept, including atomic-replace writes, delete and
move. CommonMark + GFM (tables, task lists, footnotes, strikethrough, autolinks) passing the
spec suite. Byte-faithful save. HTML sanitised always; discoverable per-document opt-in
widens the allow-list.

**Modes.** Rendered (default) and Source. Instant switch preserving position. Markdown opens
Rendered; code opens Source.

**Index and navigation.** Index the enclosing repository respecting ignore rules; palette
over titles, headings and paths with results per keystroke; MRU stack, pinning, back and
forward; reading position remembered across launches.

**Operations.** The mechanism, plus copy section, copy code block clean, toggle task item,
align table pipes. Palette-reachable, single-step undo.

**Rendering.** Highlighting from an allow-list of ~20 grammars with language detection,
soft-wrap with hanging indent, copy clean. Images with reserved dimensions; remote images
blocked with a visible opt-in. KaTeX on first use, on the grid. Knuth–Plass ragged-right,
hanging punctuation, hyphenation, in the default mode.

**Typography and themes.** Bundled Literata and JetBrains Mono with the Linux weight offset.
The default theme on the type scale, light and dark, implemented as a theme. User themes
loadable under the published contract.

**In-document.** Outline summoned and dismissed, tracking scroll. Find landing at the reading
position, working in Rendered mode. Full keyboard navigation. "Open in external editor."

**Platforms.** macOS (signed, notarized DMG) and Linux (AppImage and Flatpak) at parity.

## v1 does not ship

| Cut | Where it goes | Why |
| --- | --- | --- |
| Content search | v1.1 | Expensive; titles + headings hit the stated requirement |
| Operations beyond the four | v1.1, a weekend each | The mechanism is the architecture; the catalogue is content |
| Theme linter, contract negotiation UI | v1.1 | Support tooling, not shipping tooling |
| Mermaid | v1.1 on first substantial request | Heavy, hard to grid |
| Resident mode by default | never, unless a platform misses the budget | Surprising for a reader |
| Export, PDF | v2 | Not reading; a project under Tauri |
| Spines, transclusion | v1.1 read-only spine at the earliest | Carry the source map, build nothing |
| Cross-document operations | v2 | Signature kept open |
| Plugins, scripting | never | ADR-0004, ADR-0008 |
| Windows | after v1 | Nothing assumes two platforms |
| Settings UI | v1.1 | A config file suffices |
| Wikilinks, backlinks, graph | never | A different product |
| Sync, accounts, mobile, publishing | never in this product | — |

## If the schedule still slips, cut in this order

1. Dark variant (ship light; dark is not an inversion and deserves its own pass).
2. Align table pipes (keep three operations).
3. User theme loading (keep the contract and the default theme built as a theme).
4. Flatpak (keep AppImage).
5. Linux at v1 parity → v1.1 — contradicts a stated constraint; only if nothing else suffices.
6. The line breaker — last, and only through a superseding ADR.
