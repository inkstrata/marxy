# scope-keys: review (Opus)

**Verdict: ready after my fix.** One test-only fix committed, `508bd276`; tree clean.

## Code: correct, no verdict differs from master

- Ancestor walk: the early stop is sound. `above_files` only grows, always through `add_ancestors`. `above_read` is cleared and rebuilt from scratch on every place change, `drop_root` included. Each set always holds every ancestor of everything in it.
- Path forms: keys come from `spelling` (folds case on Windows; rejects verbatim, relative and drive-relative paths), so `starts_with` equals looking up each ancestor. Drive roots and UNC share roots match with or without a trailing separator (Rust compares and hashes them the same).
- Nothing changes `files`, `file_spellings`, `roots`, `picked`, `app` or `folders` except through the indexed methods. `keep_root` touches only `roots_kept` (not a key).
- `starts()` is a pure read under the same read lock: building it only for `Probe` cannot change the outcome.
- Locks: indexes live inside `OpenedSet` under its one RwLock; no lock added.

## Reference

The test's `old_judge` and both `old_*_keys` match `git show 84a815dd:…/scope.rs` word for word.

## Gap fixed

The differential never really exercised `drop_root`: it dropped random paths that almost never matched a root, and `place` fails for paths not on disk. Two mutations survived: removing `above_read.clear()` (a stale ancestor would have been an escape) and removing `drop_root`'s reindex. The test now drops roots it actually added, by either of their names, asserts more than 20 drops, and uses bare `C:\` and `\\srv\share`, upper-case `\\SRV\Share`, and `\\?\C:\` / `\\?\UNC\…` spellings.

## Mutations of the new lookups (15 of 15 caught)

Ancestors without the key itself, or only the key; `under` looking only at the path, skipping the path, or skipping the drive root; `has_parent` reading `files`; `above` without `above_read`; no `file_parents`; the two missing reindexes (`drop_root`, picked folder); `above_read` built from the write keys; Create without `beside`; a dropped spelling insert; no canonical file key; no clear on rebuild.

## Gates on `508bd276`

Verify turn 9/9 (cargo 628/0/5). `lint:rust` clean. No `check:tauri`.

## To file

The counted-work tests have no before-and-after proof against master (`PROBES`, `REBUILDS` exist only in the new code).
