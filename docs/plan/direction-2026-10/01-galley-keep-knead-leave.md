# Galley: keep, knead, leave

Galley's design is the target. This page lists what is changed. **Keep** means as Galley designed it,
inside the unfolded workspace. **Knead** means the idea stays and the shape changes. **Leave** means it
is not built: it tracks agents, tags files, calls a model, or reaches outside the reader. **Later**
means it is a good idea that waits until after v1.

Three rules decide nearly every row:

1. **Everything folds.** Any surface Galley shows is fine in the unfolded workspace; none of it is
   on screen while folded ([02](02-fold-up-workspace.md)).
2. **Source first.** Agent output is a kind of text, not the centre of the app. A feature that only
   makes sense if Marxy knows who wrote a file is left out; one that works for any file stays.
3. **No tagging metadata, no model calls.** See the strip list at the end.

## Workspace (Galley 01)

| Galley | Verdict |
| --- | --- |
| Sidebar, tabs, toolbar, tool strip, panes, inspector, status bar | **Keep**, unfolded only; trimmed as in [02](02-fold-up-workspace.md) |
| Read / Split / Source on `⌘1` to `⌘3` | **Keep**; Split is Phase D's two panes |
| Content-type chip with reasons, show-as, folder rule | **Keep**, without the confidence percentage |
| Block handles on hover, selection toolbar | **Knead**: shown when unfolded; folded, the verb menu (C-13) does the same job on Enter or right-click |
| Code block menu: copy variants | **Keep** (C-07, C-09 built most); paste-to-Terminal **leave** |
| Tasks write `[x]` to source | **Keep** (built), with less emphasis: no progress bars, counts or task views |
| *Open tasks* library view, Tasks tool | **Leave** |
| New and fork | **Add**: *New file*, *New file here*, *Fork this file* beside the original ([02](02-fold-up-workspace.md#new-and-fork)) |
| Path chips checked against disk | **Knead**: checked for any file, listed in the Links tab; no underline on the text |
| Footnote pop-ups and margin notes | **Keep** |
| Find with the CSS Custom Highlight API | **Keep** (D-03, D-13) |
| Result sheet: before, after, apply, chain | **Keep** |
| Version diff | **Keep** (E-16, E-17, then Phase V) |
| Live banner, Follow, live dots, "agent finished" toast | **Leave**; appended files follow their tail and regenerated files mark what changed ([04](04-capture.md)) |
| Provenance line | **Leave** |
| Summarise, TL;DR, Ask, Explain | **Leave** |
| Clean copy of AI scaffolding, prose lint of AI tells | **Leave** |

## Source editor (Galley 02)

Source becomes an enclosed editor around the raw bytes, with thin bars and rulers that show only
byte-derived facts ([02](02-fold-up-workspace.md#split-and-source)).

| Galley | Verdict |
| --- | --- |
| Structure panel, section moves, promote and demote | **Keep**, as the inspector's Outline tab, not inside Source |
| Structural selection, line operations, multiple cursors | **Keep** |
| Formatting buttons and slash inserts | **Knead**: commands in the palette and on keys; no toolbar in Source |
| Table tools, find and replace with diff preview | **Keep** |
| Problems, unsaved changes, edit history, selection panel | **Knead**: notes as quiet right-edge marks only (never underlines or gutter icons), selection facts in the bottom bar, history in the inspector's Versions tab; no bottom panel |
| Minimap | **Leave**; the right-edge strip marks exact places instead |
| Agent write-lock with three-way merge | **Knead**: *keep mine as a copy* or *take theirs* for any change on disk |
| AI rewrite | **Leave** |

## Content modes (Galley 03)

| Galley | Verdict |
| --- | --- |
| Detection with reasons and overrides | **Keep**; authorship fields in front matter are not a signal |
| Ten types and their typography | **Keep**, with `log`, `diff` and `html` added and `book` paging later ([03](03-kinds-and-the-look.md)) |
| Per-type layouts: rails, report panel, README header, three-column docs | **Keep**, unfolded; folded, the column alone |
| Tool strip per type | **Keep**, without AI tools |
| Typography panel with coupling rules and measured colophon | **Keep**, as the inspector's Look tab |
| Generated recap, read aloud | **Leave**, **later** |

## Palette (Galley 04)

| Galley | Verdict |
| --- | --- |
| One field, prefix modes, preview pane, ranking | **Keep**; `/` stays content search, transforms move under `>` |
| `?` Ask | **Leave** |
| `!` Clipboard | **Later**, with the studio design (J-D1) |
| Filters | **Keep** `kind:` and `in:`; **leave** `model:` and `tag:` |

## Library (Galley 05)

| Galley | Verdict |
| --- | --- |
| Library window: scopes, query, rows, preview, bulk actions | **Keep**, minus the facets below |
| Add a source with a dry run; index health | **Keep** |
| Query language, smart collections | **Keep**, without `model:`, `session:`, `tag:`, `is:ai`, `is:live` |
| Path base, broken paths, near-duplicates | **Keep** |
| Inbox, archive, merge, compare | **Keep** |
| Tag action, context packs, group by model or session | **Leave** |

## Clipboard (Galley 06)

Clipboard-facing features are **core** (the author's ruling, 2026-10-10;
[ADR-0065](../../adr/0065-the-clipboard.md), Phase J): Copy as with every target, multi-format
writes, paste as Markdown and as scratch, Transform on a selection or the clipboard, Extract and
Export. The **studio** (history, workbench, compare, snippets, the ring, the collect stack) is
**not designed far enough to build**; J-D1 designs it first.

## Themes (Galley 07)

| Galley | Verdict |
| --- | --- |
| Eight audited themes, role tokens, type sets, per-type themes | **Keep** |
| Theme picker with live previews in every kind, Compare | **Knead**: one full-size page preview in every kind; no gallery or compare mode; the list chooses the theme in use for Dark and for Light |
| Explanatory prose on theme rows | **Leave**; a name and the preview are enough |
| Controls split between the picker and the inspector | **Knead**: one detail panel for the selected theme, every control in exactly one place |
| Theme editor with the blocking audit | **Keep**, writing a theme directory the reader owns ([03](03-kinds-and-the-look.md#themes-are-a-playground)) |
| Adjustments: accent, weight, warmth | **Keep** |
| VS Code and Base16 import | **Keep** |
| Contrast badges on every theme row | **Leave**; the audit speaks when a pair fails |
| Schedules | **Leave**; `variant = "auto"` follows the system |

## Settings (Galley 08)

**Keep**, as a view of `config.toml` with Galley's search, changed dots and coupling rules
([02](02-fold-up-workspace.md#settings)). The Copy category arrives with Phase J; the AI and macOS categories wait for their
features.

## macOS (Galley 09)

| Galley | Verdict |
| --- | --- |
| Native menu bar with conflict-checked shortcuts | **Keep** |
| Open With, file associations | **Keep** (built) |
| Quick Look with Marxy's typography | **Later**, first of the OS surfaces |
| Services, Shortcuts, Share, Spotlight, global palette, menu bar extra | **Later** |
| Dock badge and bounce for live files | **Leave** |

## Strip list

Removed from every surface, from the index and from search:

| Item | Instead |
| --- | --- |
| Model names, session ids, lifted out as badges or facets | Nothing at rest. Whatever the file's front matter says is in the metadata preview and the Metadata tab, on request, as authored |
| Tag chips in rows, a Tag bulk action | Tags in front matter and Finder tags are viewable and editable in the Metadata tab, for one file at a time |
| `model:`, `session:`, `tag:`, `is:ai`, `has:model`, `is:live` | Search names, headings and contents; `kind:`, `in:`, `is:changed` remain |
| Confidence percentages on the kind chip | The kind's name; reasons in the chip menu and the Info tab |
| Live dots and pulses, "Live now", "agent finished" notifications, Dock badge | One quiet *changed since you read* mark in the tree |
| Token counts as fixed decoration | Tokens return as one of the reader's chosen **measures** ([02](02-fold-up-workspace.md#measures)), estimated locally |
| Contrast badges on theme rows | The audit, when something fails |
| Snapshot author ("you or an agent") | Versions by time |
| Generated TL;DRs and their labels | No generated text |
