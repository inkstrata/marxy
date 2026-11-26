# grammars-once: Opus review (interim)

Reviewer of record, started 16:55 after the earlier reviews were stopped. Tip reviewed `8e2c26c9`. Saved by the orchestrator from the reviewer's text report.

Verdict: ready on the evidence below, but not yet signed off. It had to hand back before running the source mutations: the verify on `8e2c26c9` was still in its browser step, and editing source then would have corrupted it. It made no edits and no commits; the worktree is untouched.

**Done** (read-only, scratch under `review\`):

- **Diff read in full.** The page now imports names only. `render/highlight.ts` imports `session.ts` as types only, which are dropped from the build. No string or URL references to the moved symbols remain (`highlight`, `grammarTokens`, `MAX_HIGHLIGHT_*`, `GRAMMAR_LOADERS`).
- **Fresh build of the tip** (into `review/dist-tip`): 596 js files, 15,352,076 B. The builder's 591 files and 14.09 MB came from a stale `apps/desktop/dist` that was missing 5 chunks (app, clipboard, ...). 251 chunks define grammars, each grammar once, and the gate finds 0 problems.
  - The reviewer walked the page graph itself: 341 chunks, none with Shiki or a grammar. The worker loads the grammar chunks.
  - The names that appear more than once (index, theme, links, outline, outlook, settings, sheet) are different modules sharing a base name, not copies. No grammars among them.
- **Gate mutations against the fresh build:**
  - Adding `import("./typescript-*.js")` to the app chunk: the gate reports 1 problem ("a page reaches it").
  - Copying a grammar chunk: "source.ts emitted 2 times".
- **Maths under the release CSP:** all 20 KaTeX faces loaded from woff2, with no data: sources.
  - Edge 158 and WebKit on the branch both pass.
  - The Edge picture is pixel-identical to master's.
  - On master, Edge refuses the inlined Size3 woff2 under the CSP. That confirms `8e2c26c9` is needed.
- **Notices and docs:** THIRD_PARTY_NOTICES is still true; `architecture.md`, `file-kinds.md` and `scripts/README.md` are accurate.
- **check:tauri** checks coloured Ruby and Rust keywords (`tauri-check.mjs` 605-640), so a worker that silently fails would be caught at integration.

**Not done (needed before sign-off):** break the fix, see these fail, then restore:

- `highlight-no-worker.test.mjs`, with the base on-page path restored
- `math-fonts.test.mjs`, with the base `math.ts` glob restored
- `math-fonts.test.mjs` again, with the `assetsInlineLimit` line removed (proves `8e2c26c9`)

**File for later:**

1. check:tauri has no maths check.
2. In verify, the highlight bundle gate scans whatever `apps/desktop/dist` exists without building it first, so a stale dist passes without testing anything.
3. `release-csp.test.mjs`'s `cspViolation` ignores data:font, which hid the Size3 problem. Drop the exemption now that fonts are never inlined.
4. If `math.ts`'s stylesheet regex stops matching after a KaTeX upgrade, `math-fonts.test` fails, so the break is caught.

## Final report (after the verify turn ended)

Verdict: ready at `8e2c26c9`. The one red in its verify, `source-looks.test.mjs:123`, is a timing race in the test itself, the same one verify-defaults hit on master's code. Treated as load; everything else in the verify passed.

**The source-looks failure.** The Markdown case checks token colours as soon as Source's lines appear. Markdown's marks come from its Lezer language, which loads by a dynamic import after the lines are drawn, and the worker plays no part in them. Run alone:

| Code | Passed | Failed |
| --- | --- | --- |
| This branch | 2 | 1 |
| Master (main checkout) | 3 | 0 |
| This branch, with a wait for the `inline` and `link` spans | 4 | 0 |

The branch failed one solo run where master failed none, but three runs each cannot show the worker-only path makes it worse. verify-defaults also fails it on master's code.

**The fix taken back off.** The reviewer had committed a fix as `afde1708`. When told not to fix it on this branch, it removed the commit with a soft reset and stopped its queued verify turn before that took a slot. The tip is back to `8e2c26c9` and the tree is clean. The patch is kept at `review\source-looks-wait.patch`.

**Mutations** (each restored with git checkout; tree clean):

- `highlight-no-worker`: making a failed worker colour on the page again fails both cases ("no span carries a token role").
- `math-fonts` with the old font glob: putting back `math.ts`'s woff/ttf glob and dropping the stylesheet cut fails ("every declared source is a woff2 file").
- `math-fonts` with the inline limit removed: removing `assetsInlineLimit` (proves `8e2c26c9`) fails ("every KaTeX face loads").

**File for later:** (1) the source-looks race, with the patch as its fix; (2) check:tauri has no maths check; (3) the highlight bundle gate in verify scans whatever `apps/desktop/dist` exists without building it, so a stale dist passes; (4) `release-csp.test.mjs` ignores data:font violations, which hid the Size3 face failing on master.

## Orchestrator's notes

- The size figure that counts for landing is the fresh build's: 596 files, 15.35 MB of JavaScript. Compare it with a fresh build of master, not with the builder's numbers.
- Resume this reviewer for the three mutations once `grammars-once-verify.log` ends.
