# scope-keys: builder report (Sonnet)

Commit `346279c3` `perf(scope): keep the opened set's keys as hash sets`, on `agent/scope-keys`. Verify turn 9/9 (`work\wave3\scope-keys-verify.log`): `cargo test` 628 pass, 0 fail, 5 skip; `pnpm lint:rust` clean. No `check:tauri`.

## What changed

- Nothing for the reader. Files: `scope.rs`, `file_scheme.rs`, new `scope_keys_tests.rs`.
- `OpenedSet` keeps two `KeyIndex` values (spelled, canonical), each a set of hash sets, updated when the set changes: a file add adds one key plus its ancestors; folder, root, picked and app adds and `drop_root` rebuild only the place keys.
- `spelled_keys`, `canonical_keys` and the per-call `Keys` are gone; `judge` does lookups. `check` also called `starts()` every call (a per-call list of every file's folder) though only a repository probe needs it; now built only when the verdict is `Probe`, under the same lock.
- No removal added; the checks themselves unchanged.

## Why the hash sets answer the same as the linear scan

- Keys come from `spelling` (normalised, case-folded), so `starts_with` equals "some ancestor of the path, itself included, is a key": one lookup per ancestor.
- "Above" (a held key starts with this folder) equals "the folder is an ancestor of some key": those ancestors are stored, stopping at the first already present.
- A file's folder is listable and a new name beside a file is creatable: both are lookups in a set of each file key's parent.
- No prefix or case matching at judge time.

## Proof

- Differential test `the_kept_keys_judge_every_path_as_the_per_call_lists_did`: keeps the old key lists and old linear `judge` as reference; 20 seeded random histories of every mutator including `drop_root`; every need compared on both key sets; probes over keys, ancestors, children, `.git` / `.git/HEAD`; about 150,000 comparisons, `Probe` verdicts included.
- A test for a bare-root place key.
- Counted work: one judgement costs the same lookups with 10 files as with 3,000 (at most 40); 1,000 checks on 3,000 files average at most 12 lookups, zero key rebuilds; 1,000 file opens rebuild no place keys.
- Mutation: removing the first `reindex_places` call (in `add_root`) fails the differential test.
- Not done: no revert-to-master proof for the counted tests (their hooks `PROBES`, `REBUILDS` exist only in the new code).

## For the integrator

- `search-handle` will not conflict if it only calls `scope::handle_is` (untouched).
- `OpenedSet` gained two fields; direct field writes elsewhere would bypass the index; none found outside `scope.rs` and `file_scheme.rs`.
- No doc mentions the removed functions.

## Orchestrator notes

- Checked: one commit, tree clean, verify 9/9 exit 0 (15:12).
- For the reviewer: the ancestor walk stopping "at the first already present" is correct only if every ancestor of a present key is present too; check it survives `drop_root` rebuilds. Check that the differential's random histories include roots nested in each other and UNC / drive-root paths.
