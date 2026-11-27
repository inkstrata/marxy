# watch-ignore: review (Opus)

**Verdict: ready after my fix** (tests only, no product code). Tip `50a6b478`.

## Verify

`verify-turn --from browser` on `a2878e12`: browser 254/0, cargo 642/6 skip (the other 11 steps passed in the builder's run). On `50a6b478`: `cargo test` 643, `lint:rust`, typecheck, lint, check 10/10 clean. Whole verify not rerun after the tests-only commit.

## Checked

- Reach outside the root: no. A list only narrows a watch the front end already holds; `watch_ignore` needs the matching id. Entries compared by prefix against the canonical root (`\\?\` stripped); anything not strictly inside is dropped: `..`, `.`, empty segment, `\\?\` spelling, UNC, a sibling sharing a prefix, a relative path. Fails closed. A junction spelling inside the root is accepted but has no effect (the scan never follows junctions).
- Running scan vs `set_ignored`: the new list goes into a slot and wakes the loop, which takes it before applying the batch; the first scan finishes before the handle exists.
- A folder that stops being ignored triggers a whole rescan; files return as created. Writes inside an ignored folder no longer count toward rescan debt or the cap.
- Files opened directly in an ignored folder: document watches stay separate, non-recursive.
- Both shell implementations take the list and `setIgnore`; docs accurate.

## Mutations

Rust: 8 of 8 caught (the `..` filter, the prefix's trailing slash, lower-casing, narrowing, widening, the count, the scan skip, the event skip). TypeScript veto: "a root holding a folder must have left it out" and "a root strictly inside a folder blocks it" were untested; tests added, each fails without its rule. Added a Rust test for other spellings (upper case, trailing separator, `\\?\`, UNC). Untested: an unwalked root blocking a folder (window too short to stage).

## For later

1. A held but unwatched root above the tree is not counted in the veto: if an anchored deny glob hides a folder only from the inner root, the outer root's entries there can go stale until it is walked again.
2. The list changes only when a walk runs: a build folder created after the walk stays watched for the session.
3. A root opened through a junction, or spelled differently from its canonical path, leaves nothing out (safe, no gain).
4. The first scan still covers the whole tree.
