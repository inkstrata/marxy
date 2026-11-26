# Marxy as a web page: the File System Access spike

Spike on branch `agent/web-shell` (worktree `worktrees\web-shell`), 2026-11-23, cut from master
`3d71ec38`. It follows the reach report (`marxy-reach-beyond-desktop.html` beside this file) and tests its
first step: a browser shell over real files, booted by a web build, in Chrome.

## What was built

| File | What it is |
| --- | --- |
| `apps/desktop/src/shell/fs-access.ts` | a `Shell` over File System Access handles, 545 lines; the memory shell underneath for Marxy's own files and the pure readers |
| `apps/desktop/src/web/boot.ts` | boots the app over that shell, on the empty page |
| `apps/desktop/src/main.ts` | mode `web` boots it; the shipped build has none of it (checked: no web-host code in `dist/`) |
| `apps/desktop/src/shell/memory.ts` | head detection and image facts pulled out as `signalsFromHead` and `imageFactsInBrowser`, shared by both shells |
| `package.json`, `docs/development.md`, `apps/desktop/README.md` | `build:site` and `preview:site`; what the web page does and what it does not |
| `scripts/lib/repo.mjs` | the checks skip `demo-dist/` and `site-dist/`, as they skip `dist/` (a demo build tripped `check-registry` before this too) |
| `docs/architecture.md`, `AGENTS.md` | a third shell; a method `fs-access.ts` does not override takes the memory shell's answer |
| `test/shell-boundary.test.mjs`, `scripts/verify-map.json` | the new shell's exports allowed, `site-dist/` skipped, `src/web` mapped |

How it works:

- **Mounts.** A picked or dropped folder is mounted at `/<its name>`, a lone file under `/opened/`. Paths
  stay POSIX strings, so nothing above the shell changed.
- **Reads.** `readFile`, `readHead`, `readRange` read `File` slices, so the big-file line view reads
  only what it shows.
- **Saves.** `writeFileAtomic` and `writeFileNew` write through `createWritable`, which puts the bytes in
  place only on close.
- **Watch.** Polling every 1.5 s, up to 5,000 files.
- **Kept between visits.** Handles go to IndexedDB, Marxy's own files (config, layout, positions, history,
  versions, the index) to the origin's private file system.
- **Archives and images** are read in the page by the same functions the demo build uses. Databases,
  workbooks, Outlook, Word 97-2003, font and media facts are refused or answer only for the demo.
- **Clipboard:** plain text, HTML and PNG through `navigator.clipboard`.
- **Title:** `document.title`.
- **Leaving with unsaved work:** the browser asks.

## What was tried, in Chrome (the app's browser pane)

A folder in the origin's private file system stood in for a picked folder: it is the same
`FileSystemDirectoryHandle` API. The pickers themselves were not driven, since they are native dialogs.

| Tried | Result |
| --- | --- |
| Boot with nothing open | the empty page; no console errors |
| Open a note in the mounted folder | reads and renders; Places indexes the folder |
| A relative image `../images/tide-chart.png` | drawn, once a `.git` marks the folder as one repository; without one the image root is the note's folder, as on the desktop |
| Type, save | saved; the file on disk has the edit and keeps its CRLF line endings |
| Another program changes the file, no unsaved edits | the page shows the change in about 0.6 s |
| Another program changes the file while edits are unsaved, then save | refused, nothing written, edits kept; the same two notices as the desktop (could not save; the file changed on disk) |
| A 32 MB log | opens in about 0.3 s, as Lines |
| A zip | listed (35 entries) |
| Reload | layout, positions and history come back from the private file system; with handles in IndexedDB the folder and the open note come back too |
| `pnpm build:site` | 10 s, 32 MB (the desktop front end is 30 MB) |

Checks on commit `33e6bc09`:
- `pnpm typecheck`, `pnpm lint` (three warnings elsewhere, already on master) and `pnpm check` 10/10 pass.
- `pnpm verify --tier changed` (686 s) passed install, typecheck, lint, check, golden, fidelity,
  licences and unit-desktop (1314 pass, 1 skip). Three tests failed:
  - `scripts/verify.test.mjs`: the new `src/web` folder had no key in `verify-map.json`.
  - `test/shell-boundary.test.mjs`, two tests: it scanned `site-dist/`, and the shell folder's exports
    are an allow-list.
- All three are fixed (map key, skip, allow-list entries with the reason). Both files were re-run and
  pass (17/0, 18/0). The other 191 browser tests passed in that run; the whole verify was not re-run.

In the browser pane, a restored layout waited for its first paint while the pane was hidden (no
animation frames reach a hidden pane), so `window.marxy` appeared only once a screenshot made the pane
paint. Not a shell fault, but a web page left in a background tab would start the same way.

## What was found

1. **The interface held.** No module above the shell changed to read and save real files in a browser.
   The rule that only `shell/` talks to the host, and the memory shell's virtual paths, did the work.
2. **Two synchronous methods do not fit handles.** `hasGitMarker` (the index's repository test) was
   answered by the memory shell's store, so the repository root was never found and relative images
   outside the note's folder broke. The web shell leaves it out and the index falls back to reading
   `.git/HEAD`. `fileUrl` and `assetUrl` are synchronous too. They work from the last `File` read at that
   path, which the app always reads first (`imageSize`, the head read), but nothing guarantees that.
   Making them async in `Shell` would remove the trap.
3. **Saving is weaker, and now said so.** The compare happens before `createWritable`, with a gap; the
   desktop's compare is inside the open. The swap on close still means no half-written file. Written in
   `docs/development.md`.
4. **Permission after a reload is the real unknown.** The private file system never asks, so this spike
   could not see the prompt a picked folder gets on a later visit. The shell reports a kept handle that is
   not yet allowed as a `permission` error naming the folder. There is no button yet that asks again, and
   `requestPermission` needs a click.
5. **`calls` no longer records reads of mounted files.** The memory shell's call log covers only its own
   files, which matters if browser tests are ever written against this shell.
6. **Weight.** The memory shell brings `harness/tables-demo.json` (1.1 MB) and the stand-ins into the web
   build. A web shell that does not need the demo tables should not import them.

## Next steps

- **A real pick in Chrome**, by hand: open a folder, reload the next day, see the browser's question. This
  is the one thing the spike could not do from here.
- **An "Allow again" path:** a notice with a button that calls `requestPermission` for the folder, and
  `FileSystemObserver` in place of polling where Chrome has it.
- **`Shell` hygiene:** async `fileUrl` and `assetUrl`, `hasGitMarker` dropped from the interface, and the
  demo tables moved out of the memory shell's import graph.
- **A contract test,** run against the memory shell and this one, then the Tauri shell.
- **The readers crate** (archives, tables, encodings, Outlook, Office, facts), compiled to wasm for this
  shell. That is where most of what the browser still refuses comes back.
