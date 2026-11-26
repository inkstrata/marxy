# warm-store: review (Opus)

**Verdict: ready after my fixes.** Branch ends at `2e3ded34` (three commits on the builder's two); tree clean.

## Fixes

- `c8ff2d78`: a staleness hole. A store stayed warm even when its folder's watch had failed (`watch_failed`): it never learns of a change, so its return showed old text indefinitely (master re-reads). Separately, a change whose event had not arrived yet was shown stale on return (events come within about 2 s from the notify thread or the safety poll; the poll is all a network or OneDrive folder may get).
  - On keep, open.ts records size, mtime and ctime; on return it stats again, and anything changed or unknown goes through the existing `revalidate`.
  - pane/index.ts no longer keeps a store whose watch failed, and marks it for checking if already warm.
  - The `pageOf` memo matches the policy object, not its name (hardening; two policies today).
  - Two new tests in `warm-store.test.mjs`: a change with no event is read on return; a folder that cannot be watched is not kept. Each fails alone with its fix removed.
- `77600426`: `architecture.md` updated to match.
- `2e3ded34`: the stat at keep time broke the scratch test that allows no file-system calls; it now admits exactly one stat, of the document the scratch replaced.

## Checks

1. Rename over, delete and re-create, rename away: every relevant event marks the store; the return reads the path itself, never follows a rename. A reload clears undo history, so undo cannot apply to bytes that changed on disk.
2. Dirty stores never kept, checked at release and claim; conflicts excluded too.
3. One store per path: `acquire`, Save As or a rename onto a warm path closes the warm store quietly; the encoding refcount keeps the new store's encoding.
4. The four changed tests are true new rules. In pane-set, mutating the registry to rebuild stores and leak the old ones drove watch counts to 12: the leak guard still works.
5. Memory: an evicted store closes (watch, encoding, read record, listeners released); `retain` drops warm stores of closed tabs.

## Verify

typecheck, lint, check pass. Full turn on `77600426`: browser 780 pass, 3 fail: `split-narrow` and `frame-settings` pass alone (load); `scratch-document` was the stat issue, 13/13 after `2e3ded34`. `check:tauri` not run.

## For later

- Back loses the warm store when a link opens in the same tab (the 'here' setting, or a glance tab being replaced): `retain` keeps only tabs' current paths. It could also retain each pane's back and forward history paths.
- A replace across files throws away a warm store's undo history: `storeToStage` does not see warm stores and builds a new one, closing the warm one.

## Integration reds, settled (same reviewer)

On master `b0d9cb52` compare and single-instance pass 17/17; on warm-store before the fix, 3 fail. Fixed in `33a45cac`:

- single-instance (both): a real regression from `c8ff2d78`. That test's stand-in shell has no `stat`, so `shell.stat(...)` on keep threw before `.catch`, failing the next open. Now `Promise.resolve().then(...).catch(() => null)`; with no stat result the return re-reads (the safe side).
- compare: an assertion pinning old behaviour (A's store has no previous version once B opens). A clean A is now kept warm, and its previous version belongs to it like its undo history. Nothing carries to B. Test now: B offers no previous version and lists nothing; A's store is warm; after A's tab goes (`stores.retain`) the closed store holds nothing.

Counts on the tip: compare + single-instance 17/0; `warm-store.test.mjs` 9/0; typecheck, lint, check 10/10. Full verify not rerun.
