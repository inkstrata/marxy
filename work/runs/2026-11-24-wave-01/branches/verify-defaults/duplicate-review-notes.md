# Partial notes from a duplicate review (stopped 16:40, not the review of record)

- The builder's green verify turn (15:32) predates the tip `fd9d6bf0` (16:03): the tip has no verify turn of its own.
- pnpm inside the tree is 11.18.0 and `pnpm config get shellEmulator` is true; the 12.6.0 in the builder's report is the pnpm outside the tree.
- Node-only desktop unit files side by side: no fixed ports found, temp folders all from mkdtemp, globals per process.
- The guard keeping browser-starting files out of the side-by-side step reads only each test file, not its imports: a browser started through an imported helper would slip past. File for later.
- Support smoke set: all 31 files exist; `prng.mjs` and `tauri-core-stub.mjs` in `test/support/` are used by none of them (check unfinished).
