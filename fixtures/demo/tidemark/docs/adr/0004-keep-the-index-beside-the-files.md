---
title: "ADR 0004: Keep the index beside the files"
status: accepted
date: 2026-08-02
deciders:
  - Hannah Reyes
  - Joel Marsh
sample: constructed for the reader prototype
---

# ADR 0004: Keep the index beside the files

## Context

tidemark has to keep its index somewhere. Up to 0.2 it wrote it to the platform's cache directory, `~/.cache/tidemark/` on Linux and `~/Library/Caches/tidemark/` on macOS, under a name derived from a hash of the root's absolute path. That worked until people did ordinary things with their folders:

- Renaming or moving a notes folder changed its path, so tidemark silently started a new index and left the old one behind.
- A folder synced between two machines was indexed from scratch on each, because the two paths differed.
- A folder on an external drive had a different path on every machine it was plugged into.
- Deleting a notes folder left its index in the cache indefinitely.
- An editor plugin that wanted to read the index had to reimplement the path hashing, including its handling of symbolic links, to find the file.

Each of these was a bug report between May and July. They share a cause: the index was identified by where the folder was, not by the folder itself.

## Decision

The index lives in a folder named `.tidemark/` at the top of the root it describes. tidemark writes nothing anywhere else: no cache directory, no settings in the home folder, no registry of known roots. To find a root's index, look in the root.

`.tidemark/` holds the index file and a `.gitignore` containing `*`. Anything tidemark needs to keep in future goes in the same folder. This takes effect in 0.3.0, which will rebuild each index in its new place on first run and leave the old cache directory for the user to delete.

## Consequences

Good:

- The index moves with the folder. Renaming it, moving it to another disk or syncing it to another machine keeps the index with it.
- Deleting a folder deletes its index. There is nothing to clean up and nothing to orphan.
- Other tools find an index by looking inside the folder. There are no lookup rules to copy.
- Roots never share state, so indexing one cannot disturb another.
- The README can make a simple promise: tidemark writes nothing outside the folder you give it.

Bad:

- Sync services and backups carry the index. Dropbox, iCloud Drive and Syncthing will upload it every time it changes, which for a large folder is real traffic, and two machines writing the same index at once can produce a conflicted copy. The documentation should suggest excluding `.tidemark/` from sync.
- A folder you can read but not write cannot be indexed at all. tidemark reports `permission denied`, where the old design would have worked.
- Every indexed root gains one more hidden folder, which some people notice and dislike.

## Alternatives

**The platform cache directory, keyed by path.** The 0.2 behaviour, rejected for the reasons above.

**One database in the user's data directory, holding every root.** One file to back up, but it brings back the question of how to identify a folder, and it couples folders that have nothing to do with each other.

**A sidecar beside each note**, such as `2026-07-30.md.tidemark`. This survives moving a single file, but it doubles the number of files in every folder and puts tidemark's name in every file listing the user ever sees.

**A configurable location.** Rejected for now, because it would make the README's promise conditional. We will revisit it if indexing read-only folders turns out to matter to more than one person.
