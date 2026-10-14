# Layout audit: 6 defects, 0 already boarded (65 surfaces, 126 cells, 19660 text nodes, 32 s)

## Defects per surface group

| Group | Defects |
| --- | ---: |
| Popups | 3 |
| Menus | 1 |
| Palette | 1 |
| Split | 1 |

## Defects

| Kind | Surface | Selector | Text | Sizes | Variants | Note |
| --- | --- | --- | --- | --- | --- | --- |
| truncated | menu-kind-chip | `div.marxy-verb-menu.marxy-surface > div.marxy-verb-menu-item.marxy-menu-row > span.marxy-verb-menu-title` | admonitions or Parameters, Returns, Errors, Exam (+1 more) | 800x600 1920x600 | night | ellipsised: 374 px of text in 137 px |
| truncated | palette-files-query | `li#marxy-palette-opt-1.marxy-palette-row.marxy-menu-row > span.marxy-palette-text > span.marxy-palette-title` | Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | 800x600 1920x600 | night | ellipsised: 825 px of text in 333 px |
| truncated | popup-library | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-name > span.marxy-library-row-name` | Postgres 14 → 16 upgrade plan (+8 more) | 800x600 1920x600 | night | ellipsised: 195 px of text in 108 px |
| truncated | popup-library-filter | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-name > span.marxy-library-row-name` | Postgres 14 → 16 upgrade plan (+8 more) | 800x600 1920x600 | night | ellipsised: 195 px of text in 108 px |
| covered | popup-outline | `li#marxy-outline-row-0.marxy-outline-row` | Postgres 14 → 16 upgrade plan (+4 more) | 800x600 1920x600 | night | div > div.marxy-toolbar |
| truncated | unfolded-split-resized | `div#marxy-source-2.marxy-source-mount > div.marxy-source-frame > div.marxy-source-top > span.marxy-source-facts` | UTF-8LF2 spaces3,116 bytes89 lines | 800x600 | night | ellipsised: 273 px of text in 213 px |

## Pruned by the allowlist

- 153 x The document scrolls under the fixed toolbar, strip and status row.
- 22 x A notice pill floats over the page by design (U-02).
- 26 x An open menu covers what is under it by design.
- 763 x A modal dialog (palette, transform sheet, settings sheet) covers the page under it by design.

## Not reachable at some widths

- folded-split: the app refuses a split at this width
- settings-collections: the collections category is not drawn (it has no setting yet)
- unfolded-split: the app refuses a split at this width
