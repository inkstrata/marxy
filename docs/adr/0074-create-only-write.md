# ADR-0074 — A create-only write: `writeFileNew` puts bytes at a name only if nothing is there

- **Status:** accepted (author ruling, 2026-10-13, F-85 question 1: "default accepted")
- **Date:** 2026-10-13
- **Amends:** ADR-0026 (`shell-api`'s list of privileged operations gains one). ADR-0045 is applied, not changed: a new
  privileged capability gets an ADR, and this is it. ADR-0004 (a save replaces the file by an atomic rename) is read, not
  changed: `writeFileAtomic` and Save still replace on purpose.
- **Evidence:** the F-85 card in `docs/plan/direction-2026-10/20-cards-wave-11.md`; the adversarial review of W-14 (#701),
  which measured the window below at 10 to 25 ms; `apps/desktop/src/document/fork.ts` ("THE ONE LIMIT").

## Context

Marxy writes beside a reader's files in three places: *Fork this file* (W-14), *Keep mine as a copy* when a file changed
under unsaved edits (V-07), and *Restore to a copy* (V-06). Each wants a name that is free, and each used the same two
steps: look for the name, then call `writeFileAtomic`. That write stages a temporary file and renames it over the
destination, and a rename replaces whatever is there, so there are two holes:

1. **A window.** A file another program puts at the name between the look and the rename is replaced. W-14's review
   measured the window at 10 to 25 ms and W-14 accepted it, in writing, until the shell could do better.
2. **A symlink.** `writeFileAtomic` writes *through* a link (that is how Save keeps a symlinked document a link). A
   conflict copy named `x (mine).md` that is a symlink to another file would replace that file. The look in `writeCopy`
   (`exists`) saw a link only as far as `stat` can, which is not at all.

Both break commitment 3 (Marxy changes only the bytes the reader asked to change) in the one place it matters most: a write
whose whole promise is that it leaves everything else alone. No amount of looking first closes either; only a write that
fails when something is there does.

## Decision

1. **`Shell.writeFileNew(path, bytes): Promise<void>` is added to `shell-api`.** It puts exactly `bytes` at `path` only if
   nothing is at `path`, and otherwise rejects with `code: 'exists'` and writes nothing. "Anything" is a file, a folder, a
   symlink, and a symlink that leads nowhere; a name that differs only in case from an existing one on a case-insensitive
   volume is taken as well. It does not follow a link at `path`, and it never replaces.
2. **The Rust shell does it exclusively, not by looking.** `atomic_write::write_new` stages the bytes in a hidden temporary
   file in the destination's own directory (created `create_new`), flushes them, and then makes the name appear with an
   *exclusive rename*: `renamex_np(RENAME_EXCL)` on macOS and `renameat2(RENAME_NOREPLACE)` on Linux. The kernel decides
   "nothing is there" and "the name now points at the file" in one step, so there is no window, whatever else is creating
   files in that folder. A failed write removes its temporary file.
3. **When the exclusive rename is not supported** (an old kernel, a volume that refuses the flag), the shell falls back to
   `link(tmp, name)` and then `unlink(tmp)`. A hard link also fails if the name is taken and never replaces. If that is
   refused too, the write fails with "this volume cannot create a file without risk of replacing one", and nothing is
   written. There is no third, check-then-write fallback.
4. **`ShellError.code` gains `'exists'`.** A caller that wants the next free name tries the next name on `exists` and fails
   on anything else; it needs no look first.
5. **Callers.** *Fork this file*, *Keep mine as a copy* and *Restore to a copy* write with `writeFileNew` and move to the
   next free name on `exists`. Nothing that replaces on purpose changes: `writeFileAtomic` and Save are untouched, and Save As
   keeps the native dialog's own replace confirmation.
6. **Nothing else is added.** No delete, no rename, no capability file entry: it is one command in the existing
   `invoke_handler`, as `write_file_atomic` is.

## Consequences

- The W-14 window and the symlink hole are closed, and the KNOWN LIMIT test in `fork.test.ts` becomes a race test the fork
  passes. The three callers lose their look, so each tries one write per taken name instead of several reads.
- Q-05 and Q-08, which write and move the reader's files, can use the same capability.
- The memory shell implements the contract, with a hook for a creator that appears at a name just before the write, so every
  caller's race is testable. The no-op shell rejects nothing and writes nothing.
- `pnpm gate:fidelity` compiles `write_new` and drives it over the corpus, as it does `write_atomic`.

## Rejected

- **Keep looking, harder** (a second look after the write, a `stat` with `O_NOFOLLOW`). Every check-then-write is a window;
  the second look can only report the replacement after it has happened.
- **`open(O_CREAT | O_EXCL)` straight onto the name.** Exclusive, but the name is visible and empty while the bytes are
  written, and a crash leaves a truncated file at a name that looked finished. Staging then an exclusive rename publishes the
  whole file or none, as Save does.
- **A flag on `writeFileAtomic`.** One command that both replaces and refuses to replace is one a later edit can mix up.
  Two names, each doing strictly one thing, is what a reviewer can hold.

## How we would know this was wrong

1. A volume Marxy's readers use refuses both the exclusive rename and the link, so *Fork* is unavailable there. Then the
   notice's wording is the first thing to improve, and a plain `O_EXCL` create (with its visible-empty-file cost) is the
   next candidate, written down here before it is built.
2. A caller replaces a file through `writeFileNew`. That is a bug in the shell, not a caller's: the Rust tests and
   `gate:fidelity` exist to make it impossible.
