---
key: MARXY-35
design: [07-index-and-palette, 11-config-and-storage]
depends: [MARXY-14]
verify: [pnpm precheck, pnpm done MARXY-35]
---
# MARXY-35 — Index the enclosing repository with ignore rules, deny list and ceiling

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) §Root, §Walking, §Headings, §Persistence; [11-config-and-storage](../../design/11-config-and-storage.md) · **Depends on:** MARXY-14.

## Do this, in order
1. Rust `commands/fs.rs`: `repository_root(path)`. `commands/index.rs`: walker (`ignore`), deny list, extension allow-list, 4 MB heading cut-off, the headings scanner (§07 regexes, fence tracking, setext), `index_build` (background thread, emits `marxy:index-updated`), `index_load`/`index_save` (§07 envelope at `<data>/index/<sha1(root)>.json`), `index_query` (nucleo-matcher over path/title/headings with the ×1.0/1.2/0.9 weights).
2. `packages/core/src/index-model/`: TypeScript types are the contract; add `rank(hits, frecency)` (the §07 formula) as a pure function with tests.
3. `src/shell/tauri.ts`: `repositoryRoot`, `indexBuild`, `indexLoad`, `indexSave`, `indexQuery`, `configPaths`.
4. App: on open, compute root, `indexLoad` then `indexBuild` in idle; keep `recentRoots` (§07) in `history.json` via a small `storage.ts` (§11 rules: version, corruption → `.bad`, atomic write).

## Tests
Rust: temp repo with `.gitignore`, `node_modules`, a nested `.git`; headings scanner vs the parser on `01`, `03`, `09`, `14`; truncation at limit 100; query ranking snapshot for six queries on a fixture index. App: `rank` frecency test; storage corruption test. Perf: a 20k-file tree indexes < 2 s on the reference tier; `index_build` never precedes `first_text` (mark order assertion).
