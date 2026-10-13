# ADR-0072 — Local versions: copies of the reader's documents, kept as plain files in Marxy's data folder

- **Status:** accepted (author, 2026-10-12, V-06 questions 1 to 4: "recommended approved"); amended by V-06 (2026-10-13,
  below): the files sit flat in the data folder, a manifest notes when Marxy last saved, and *Changed since you read* is said
  exactly
- **Date:** 2026-10-12
- **Amends:** `docs/design/11-config-and-storage.md` §What is never stored ("Document contents" are no longer never
  stored: versions are the one exception, under the rules below); the reader-artifacts spec line *Changed since last
  read* (`docs/research/reader-artifacts/10-spec.md`, "Local snapshot only, never written": the snapshot is now written,
  locally, as one of these versions). ADR-0018, ADR-0026 and ADR-0045 are read, not changed.
- **Reads:** commitment 2 (private by default) and commitment 3 (faithful to the bytes) in `AGENTS.md` and ADR-0052.
- **Evidence:** the V-06 card in `docs/plan/direction-2026-10/19-cards-wave-10.md`;
  `docs/research/reader-artifacts/05-diffs-provenance.md` §Changed since last read (the regenerated agent file is the
  defining case).

## Context

V-06 gives the inspector a **Versions** tab: *Changed since you read*, and the file's earlier versions, each a diff away
and restorable to a copy. That needs the old bytes after a quit, so Marxy must keep copies of the reader's documents.
Commitment 3 lets Marxy keep "its own state in plain files in the platform's config and data directories, apart from the
reader's documents". Copies of the documents are a new kind of that state, and two documents said the opposite:
design/11 lists "Document contents" first under what is never stored, and the research spec line says the last-read
snapshot is "Local snapshot only, never written". Keeping versions only in memory needs no record, but nothing survives a
quit, which defeats *earlier versions*.

## The rulings (2026-10-12)

The author approved V-06's recommended answers to all four questions:

1. **Versions are plain files under `<data>/versions/`** (option b), written as this record.
2. **Limits:** 20 versions per file, 30 days, 200 MB in all, the oldest dropped first. Files under a deny rule or over the
   large-file limit are never copied. `versions = false` in `config.toml` turns it off.
3. **No new `shell-api` capability:** pruning works by overwriting fixed slots, not by deleting files.
4. **"Changed since you read" compares with the copy made at the last read**, recorded when a document is opened or
   reloaded while in front of the reader, as ADR-0018's last-read time is.

## Decision

1. **Where.** Versions live in the platform's data directory (`shell.configPaths().data`), in `versions/`, one folder per
   file: `versions/<hash>/`, where `<hash>` is a hash of the file's absolute path (the same family as `index/<sha1(root)>`).
   Each folder holds the version slots and a readable `manifest.json`, starting with `"version": 1` as every Marxy data
   file does, which names the file's path and, for each version, its slot, the time it was kept, its size and its reason.
   Nothing is ever written beside the reader's files, and nothing under `versions/` is written outside the data
   directory.

2. **What is kept, and when.** A version is the exact bytes of the file at one of three moments, and the reason says
   which:
   - **read**: the bytes the reader read, when a document is opened, or reloaded while in front of them;
   - **before save**: what was on disk before Marxy saved over it;
   - **before reload**: what was on disk before an outside change replaced it.

   Identical bytes are kept once. Nothing is kept on a keystroke or on a timer. *Changed since you read* compares the
   current bytes with the latest **read** version (ruling 4).

3. **Limits (ruling 2).** At most **20 versions per file**, none older than **30 days**, and **200 MB in all** across
   `versions/`; when a limit is reached the **oldest version is dropped first**. A file that matches a deny rule (the
   built-in deny list or `[deny]` in `collection.toml`), or is larger than the large-file limit (`LARGE_FILE_BYTES`), is
   **never copied**, and the tab says why. These numbers are the defaults; a later story may make them configurable
   without a new record.

4. **The switch.** `versions = false` in `config.toml` turns versioning off: nothing new is kept, and the tab says it is
   off. `true` or absent keeps it on. It joins design/11's `config.toml` table as an ordinary key.

5. **Pruning without a delete (ruling 3).** `shell-api` has no delete, and this record adds none. Each file's versions
   are a **ring of fixed slots** (at most 20) that are overwritten in turn; dropping a version rewrites the manifest
   without it and overwrites its slot with zero bytes. *Clear versions of this file* and *Clear all versions* do the same
   for every slot they cover, so no cleared version's bytes stay readable through the store. All writes go through
   `shell.writeFileAtomic`. If the ring proves wrong (for example, empty slot files that pile up for files never opened
   again matter to a reader), a delete confined to the data directory is a new privileged capability under ADR-0045 and
   gets its own record; the shell's own startup pruning of `index/` files is the precedent.

6. **Private (commitment 2).** Nothing leaves the machine: versions are never sent, synced, uploaded or shared, and no
   reader action sends them. They are read only to draw the Versions tab, a diff, or a restored copy. The Privacy page
   (W-12) will say what is kept (copies of files you read and save, where, to what limits) and how to clear it (the two
   Clear commands, `versions = false`, or deleting the `versions/` folder).

7. **Faithful (commitment 3), still.** Versioning **never writes the reader's documents**: it reads a file's bytes and
   writes only under `<data>/versions/`. **Restore writes a copy beside the original, never over it**: `name (version
   HH.MM).md` at the first free name (`(version HH.MM 2)` and on), and never calls `writeFileAtomic` on a path that
   exists. A diff from a version is a scratch document, as E-17's is, and writes nothing. Source still shows the file
   exactly, and Marxy's own state stays in plain files apart from the reader's documents; a version is a byte-exact copy,
   so it is as faithful as the file it was taken from.

## Consequences

- V-06 builds it: `apps/desktop/src/versions/store.ts` (slots, manifest, limits; pure over an injected read and write),
  `versions/recorder.ts`, the Versions tab, the Clear commands and Restore to a copy, with the tests its card names
  (every path written is under `configPaths().data`; restore never writes an existing path).
- `docs/design/11-config-and-storage.md` gains the `versions/` row under §Data files and the exception under §What is
  never stored (this pull request); V-06 adds `versions` to the `config.toml` block when it reads the key.
- The research spec line *Changed since last read* carries a note pointing here (this pull request).
- W-12's Privacy page gains the line in item 6.

## Amendment (V-06, 2026-10-13): what the build found

The build kept every ruling and changed three details, and the adversarial review added three rules (items 4 to 6); each is held by a test in V-06's pull request.

1. **Flat in the data folder, not a `versions/` folder.** `writeFileAtomic` stages beside its destination and creates no
   folders, and `shell-api` has no way to make one; a folder would be a new privileged capability. The index snapshot met the
   same wall and sits flat (`index-<sha1(root)>.json`, `apps/desktop/src/index/service.ts`). So a file's versions are
   `<data>/versions-<sha1(path)>.json` (the manifest) and `<data>/versions-<sha1(path)>-01` to `-20` (the slots), in the data
   folder itself. Everything else in item 1 stands: plain files, a readable manifest that starts with `"version": 1` and names
   the path, and for each version its slot, time, size and reason; nothing beside the reader's files. Deleting every
   `versions-*` file in the data folder clears them by hand (item 6's "deleting the `versions/` folder").
2. **The manifest notes when Marxy last saved over the file** (`"saved"`: a time, never bytes). Identical bytes are kept once
   (item 2), so a save over bytes that are already the newest version keeps nothing, and without the time the next open could
   not tell that the reader wrote what it finds. With it, *Changed since you read* says "you saved it since" rather than passing
   the reader's own edits off as someone else's.
3. **"The copy made at the last read" (ruling 4), said exactly.** At an open, it is the newest `read` version kept *before*
   that open (so a file regenerated while Marxy was closed, the defining case, shows what changed); after an outside change
   while the file is open, it is what the file held just before (the `before reload` version), and the new bytes are kept as
   `read`, as ruling 4 says. A save of the reader's own clears it: the file then holds what they wrote. Read literally,
   "compare with the latest read" would hide every change at the moment it arrived, since the arrival is itself recorded as a
   read.
4. **A version is the bytes its hash names.** Each manifest entry carries a SHA-256 of the version's bytes (`"hash"`), and a slot
   is read as that version only while it hashes to it. A slot edited by hand, at the same size or another, or a manifest edited to
   name a sibling's slot, is listed as changed outside Marxy and is never read, diffed or restored; the tab says so. A manifest
   without a hash is damaged (no version has been released without one).
5. **A save keeps what it replaces, before it writes.** The *before save* copy is made by the document store's own save, awaited
   just before the write (`StoreIo.beforeOverwrite`), not queued after it: a quit or a close right after the save cannot lose it.
   If the copy cannot be made the save still goes through (a full data folder must not stop the reader saving) and Marxy says,
   as it happened, that the save replaced those bytes and the copy was not kept. Closing waits (a moment at most) for the copies
   still queued, and stopping the recorder lets them finish.
6. **Save As onto a file that is there keeps that file's bytes first.** The same hook reads the one file the reader named as the
   target (nothing else is read) and keeps its current bytes as that file's *before save* version, then writes. A name that is
   free keeps nothing: there is nothing to replace. The operating system's replace prompt remains the reader's own check;
   this is the way back from it.

Also recorded: dedupe compares with the newest version (the same bytes again add nothing) and, failing that, with every
version kept (the same bytes as an older one share its slot: one copy on disk, two entries). A manifest Marxy cannot read is
reported in the tab and never written over by keeping; that file's versions stop until the reader clears them. A failed keep
(a full disk, an unwritable folder) is said once a session as a notice and in the tab, in words that say what the file went through (item 5).

## Rejected

- **In memory for the session only.** No record needed, but *earlier versions* would be empty after every quit, and the
  regenerated agent file, the defining case, is usually reread in a later session.
- **Beside the reader's files** (a `.marxy/` folder or sidecar copies). Writes into the reader's folders, shows up in
  their version control and their search, and breaks "apart from the reader's documents".
- **A delete capability now.** A new privileged write path for a limit the ring already holds; argued only if the ring
  fails.

## How we would know this was wrong

1. **A write lands outside `<data>/versions/`** while versioning, or a restore writes over an existing file. A bug against
   items 1 and 7; V-06's write-log tests should have caught it.
2. **A cleared version can still be read** through the store. A bug against item 5.
3. **Readers turn it off to feel safe.** Without telemetry the evidence is taste review and the author's use: if keeping
   copies reads as surveillance rather than a safety net, the default or the Privacy page's wording is wrong.
