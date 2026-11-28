# Hunt coverage

Where each bug hunt has looked, with what lens, and what it confirmed, so the next hunt does not sweep the same
empty ground again. One row per axis run. `bug-triage` appends a hunt's rows when it lands; the planner reads the
table first (`bug-catch`, "Plan the axes"). Paths are relative to the repository root; `apps/desktop/src` is
written `src`. Commit is the `main` commit the hunt ran on (hunts 02 and 03: the commit its pull request landed on
top of). Source is `planner` or `proposed:<run-id>`, so the table shows whether proposed axes pay off. Confirmed is the number of confirmed findings the axis found, duplicates of known rows included.

| Date | Hunt | Axis | Lens | Area (paths) | Commit | Confirmed | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-27 | 01 | EXP | domain: export, print, copy out, the tray | `src/left/panels/export.ts`, `src/export/`, `src/tray/`, `src/commands/copy-*.ts` | 14aefa0a | 3 | planner |
| 2026-11-27 | 01 | EDT | domain: editing and saving | `src/source/`, `src/paste/`, `src/save.ts`, `packages/core/src/buffer/` | 14aefa0a | 1 | planner |
| 2026-11-27 | 01 | VWR | domain: viewers and file kinds | `src/viewers/`, `src/kinds/`, `packages/core/src/kind/` | 14aefa0a | 4 | planner |
| 2026-11-27 | 01 | NAV | domain: navigation and panes | `src/pane/`, `src/left/`, `src/find/`, `src/position/` | 14aefa0a | 2 | planner |
| 2026-11-27 | 01 | RDR | domain: reading and rendering | `src/render/`, `src/view/`, `packages/typeset/`, `packages/core/src/parse/` | 14aefa0a | 2 | planner |
| 2026-11-27 | 01 | SHL | domain: the Rust shell | `src-tauri/src/`, `src/shell/` | 14aefa0a | 2 | planner |
| 2026-11-27 | 02 | NAV | freezes: the rail and the first four drawer panels over a big file | `src/left/`, `src/rail/` | 1b433a4b | 1 | planner |
| 2026-11-27 | 02 | RDR | freezes: what a page-width change costs (drawer docking, rail, split, resize) | `src/view/`, `src/layout/`, `packages/typeset/` | 1b433a4b | 2 | planner |
| 2026-11-27 | 02 | CMD | freezes: menus, then the last four drawer panels and their keys | `src/left/panels/`, `src/commands/`, `src/menu/` | 1b433a4b | 3 | planner |
| 2026-11-27 | 03 | MEA | shape: big files, every shape at 0.5 to 5.1 MB, where work outgrows the file | whole app, by measurement (`scripts/measure-scale.mjs`) | 03ece1cd | 9 | planner |
| 2026-11-27 | 03 | RDR | shape: big files, the read path for 1 to 5 MB Markdown | `packages/core/src/parse/`, `src/render/`, `packages/typeset/` | 03ece1cd | 3 | planner |
| 2026-11-27 | 03 | EDT | shape: big files, edit, copy and save | `src/source/`, `src/save.ts`, `packages/core/src/buffer/` | 03ece1cd | 8 | planner |
| 2026-11-27 | 03 | NAV | shape: big files, find and place | `src/find/`, `src/line/`, `src/left/`, `src/position/` | 03ece1cd | 6 | planner |
| 2026-11-27 | 03 | VWR | shape: big files, readings and viewers | `src/viewers/`, `packages/core/src/reading/` | 03ece1cd | 2 | planner |
| 2026-11-27 | 03 | SHL | shape: big files, reading, decoding and writing in Rust and across IPC | `src-tauri/src/`, `src/shell/` | 03ece1cd | 5 | planner |
| 2026-11-28 | 04 | WRK | invariant: a Markdown file parsed in the worker equals the page's parse | `src/document/parse-worker.ts`, `src/document/open.ts`, `packages/core/src/parse/` | 93977776 | 1 | planner |
| 2026-11-28 | 04 | ENC | invariant: the compact byte map names the wrong bytes in non-UTF-8 files | `packages/core/src/encoding/`, `packages/core/src/buffer/`, `src-tauri/src/encoding/` | 93977776 | 2 | planner |
| 2026-11-28 | 04 | DIF | diff: the latest merges broke something they did not touch | `src/left/panels/links.ts`, `src/view/reading-rows.ts`, `scripts/verify.mjs` | 93977776 | 2 | planner |
| 2026-11-28 | 04 | AUTO | spec: the merge gate, governor and weekly clean against the written policy | `scripts/auto/`, `scripts/lib/stale*.mjs` | 93977776 | 5 | planner |
| 2026-11-28 | 04 | FND | spec: find, select all and copy on a long page still mounting | `src/find/`, `src/selection/copy-text.ts`, `src/render/progressive.ts` | 93977776 | 4 | planner |
| 2026-11-28 | 04 | CAP | invariant: a size cap drops content silently or fails at its limit | `packages/core/src/office/`, `packages/core/src/reading/`, `packages/core/src/mail/`, `src/source/paste.ts` | 93977776 | 4 | planner |
