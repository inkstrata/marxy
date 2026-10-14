# Layout audit: 19 defects, 0 already boarded (65 surfaces, 1000 cells, 163416 text nodes, 168 s)

## Defects per surface group

| Group | Defects |
| --- | ---: |
| Popups | 6 |
| Empty window | 4 |
| Settings | 4 |
| Palette | 2 |
| Inspector | 1 |
| Menus | 1 |
| Split | 1 |

## Defects

| Kind | Surface | Selector | Text | Sizes | Variants | Note |
| --- | --- | --- | --- | --- | --- | --- |
| outside | empty-window-resized | `div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set` | ith this, the concept of Spirit is already prese (+13 more) | 1000x600 1000x900 | night+paper | window 1000x600 |
| overlap | empty-window-resized | `div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set` | Hiermit ist schon der Begriff des Geistes für un (+14 more) | 1000x600 1000x900 | night+paper | with div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set > span.marxy-hang |
| spills | empty-window-resized | `div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set` | Hiermit ist schon der Begriff des Geistes für un (+29 more) | 1000x600 1000x900 | night+paper | owner div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set is 446 px wide, its text 558 px |
| spills | empty-window-unfolded | `div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set` | ith this, the concept of Spirit is already prese (+14 more) | 1400x600 1400x900 | night+paper | owner div.marxy-frontispiece-page > div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set is 394 px wide, its text 556 px |
| truncated | inspector-outline | `ul.marxy-outline-list > li.marxy-outline-item > button.marxy-outline-row.marxy-outline-table > span.marxy-outline-text` | Table: Step, Owner, Est. time, Rollback | 1000x600 1000x900 | night+paper | ellipsised: 217 px of text in 201 px |
| truncated | menu-kind-chip | `div.marxy-verb-menu.marxy-surface > div.marxy-verb-menu-item.marxy-menu-row > span.marxy-verb-menu-title` | admonitions or Parameters, Returns, Errors, Exam (+1 more) | 8 sizes | night+paper | ellipsised: 374 px of text in 137 px |
| truncated | palette-files-folded | `li#marxy-palette-opt-9.marxy-palette-row.marxy-menu-row > span.marxy-palette-text > span.marxy-palette-title` | 2026-10-01-quarterly-database-migration-readines | 800x900 1000x900 1400x900 1920x900 | night+paper | ellipsised: 437 px of text in 354 px |
| truncated | palette-files-query | `li#marxy-palette-opt-1.marxy-palette-row.marxy-menu-row > span.marxy-palette-text > span.marxy-palette-title` | Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | 8 sizes | night+paper | ellipsised: 825 px of text in 333 px |
| covered | popup-find | `article#doc.marxy-article > dl > dd` | Postgres 14 → 16 upgrade plan | 1000x600 1000x900 | night+paper | section.marxy-pane[data-marxy-pane="0"] > div.marxy-find-slot > div.marxy-find > input.marxy-find-input |
| clipped | popup-library | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-path > span.marxy-library-row-rel` | plans/plans/pg16-upgrade-plan.md (+17 more) | 1000x600 1000x900 | night+paper | x cut by div#marxy-library-row-0.marxy-library-row |
| truncated | popup-library | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-name > span.marxy-library-row-name` | Postgres 14 → 16 upgrade plan (+18 more) | 8 sizes | night+paper | ellipsised: 195 px of text in 108 px |
| clipped | popup-library-filter | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-path > span.marxy-library-row-rel` | plans/plans/pg16-upgrade-plan.md (+17 more) | 1000x600 1000x900 | night+paper | x cut by div#marxy-library-row-0.marxy-library-row |
| truncated | popup-library-filter | `div#marxy-library-row-0.marxy-library-row > div.marxy-library-cell.marxy-library-cell-name > span.marxy-library-row-name` | Postgres 14 → 16 upgrade plan (+18 more) | 8 sizes | night+paper | ellipsised: 195 px of text in 108 px |
| covered | popup-outline | `li#marxy-outline-row-0.marxy-outline-row` | Postgres 14 → 16 upgrade plan (+4 more) | 8 sizes | night+paper | div > div.marxy-toolbar |
| overlap | settings-advanced | `section.marxy-settings-group > div.marxy-setting > div.marxy-setting-text > label.marxy-setting-label` | Linux font weight offset / Not set | 1000x600 1000x900 | night+paper | with span#marxy-setting-linux.marxy-settings-table-summary |
| clipped | settings-appearance | `div#marxy-setting-variant.marxy-settings-segmented > label.marxy-settings-segment > span.marxy-settings-segment-label` | Follow the system | 1000x900 | night+paper | x cut by div#marxy-setting-variant.marxy-settings-segmented |
| covered | settings-types | `section.marxy-settings-group > div.marxy-setting > div.marxy-setting-text > label.marxy-setting-label` | How folders are read (+1 more) | 1000x600 1000x900 | night+paper | section.marxy-settings-group > div.marxy-setting > div.marxy-setting-control > div.marxy-settings-table-control |
| overlap | settings-types | `section.marxy-settings-group > div.marxy-setting > div.marxy-setting-text > label.marxy-setting-label` | How folders are read / 0 rules | 1000x600 1000x900 | night+paper | with span#marxy-setting-kind.marxy-settings-table-summary |
| truncated | unfolded-split-resized | `div#marxy-source-2.marxy-source-mount > div.marxy-source-frame > div.marxy-source-top > span.marxy-source-facts` | UTF-8LF2 spaces3,116 bytes89 lines | 800x600 800x900 | night+paper | ellipsised: 273 px of text in 213 px |

## Pruned by the allowlist

- 691 x The document scrolls under the fixed toolbar, strip and status row.
- 119 x A notice pill floats over the page by design (U-02).
- 250 x An open menu covers what is under it by design.
- 7017 x A modal dialog (palette, transform sheet, settings sheet) covers the page under it by design.

## Not reachable at some widths

- folded-split: the app refuses a split at this width
- settings-collections: the collections category is not drawn (it has no setting yet)
- unfolded-split: the app refuses a split at this width
