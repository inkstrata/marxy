# A tracked collection of files, and a quick way to jump between them

**Date:** 2026-10-01 · **Part of:** the October 2026 audit (document 06) · **Branch:** `docs/MARXY-346-project-audit-codebase-orchestrator-prod`

**Abstract.** The author's first feature idea is "a tracked collection of files we preside over, with a quick search bar to jump between them." Marxy already has most of the idea on paper: a palette (`⌘P`) that lists recent documents and fuzzy-searches the titles, headings and paths of the enclosing git repository. This study checks what actually runs, surveys how other tools define a "collection", and proposes a small design. The main findings: (1) the palette's search works, but the index behind it is rebuilt on every launch, is never told when files change, is limited to one repository, and several fields the ranking relies on are never filled in; (2) the Rust index module the design documents describe is not compiled into the app and the matcher is hand-written TypeScript, not `nucleo`; (3) the TypeScript matcher is at the 16 ms budget at 50,000 entries on this machine, so a multi-root collection needs a plan; (4) the feature needs no change to a frozen contract if the matcher stays in TypeScript. The recommendation is a **user-owned `collection.toml` listing folders**, searched through the **existing palette** (no persistent bar), with an empty state built around "what changed since you last read it", which is the actual job when AI tools keep writing files.

---

## 1. What Marxy already has

Read this section as an inventory of what exists and runs today, not what the documents say. Where code and documents disagree, both are cited.

### 1.1 The rules as decided

| Topic | Rule | Source |
| --- | --- | --- |
| Root | Nearest ancestor with `.git`, else the opened file's directory. Twelve recent roots remembered; current root searched first, then recent roots. "No settings surface for roots in v1." | `docs/adr/0012-index-root-and-search-scope.md:6-8` |
| Indexed | Files passing `.gitignore`, `.ignore` and a built-in deny list, with an extension allow-list (markdown, text, then source). | `docs/adr/0012-index-root-and-search-scope.md:9-11` |
| Per entry | path, title (first `h1` or filename), headings, mtime, size, last-read, position. "Not contents." | `docs/adr/0012-index-root-and-search-scope.md:12-13` |
| Ceiling | 50,000 entries per root; beyond it keep newest by mtime and show a notice. | `docs/adr/0012-index-root-and-search-scope.md:14-15` |
| Search | Fuzzy over path, title and headings, ranked by match then frecency. Content search deferred to v1.1. | `docs/adr/0012-index-root-and-search-scope.md:16-17`; `docs/scope.md:42`; `docs/roadmap.md:18` (names `tantivy`) |
| Tabs | None. Empty query shows MRU, pinned on top. Switch must paint in under 50 ms. | `docs/adr/0011-palette-not-tabs.md:5-8` |
| Reversal | At taste review 2, reaching "the document from three switches ago" in five seconds, or reveal-on-intent tabs return. | `docs/adr/0011-palette-not-tabs.md:15-19` |
| Chrome | "No toolbar, no tab bar, no sidebar." Out of scope includes "library browsing". | `docs/brief.md:57-59`, `docs/brief.md:72` |
| Budget | Keystroke to results under 16 ms. | `docs/navigation.md:5-9`; `docs/design/07-index-and-palette.md:75-77` |
| Storage | `history.json` (500 opens, pins, 12 roots), `positions.json` (5,000 paths), `index/<sha1(root)>.json`; `config.toml` has no roots key. | `docs/design/11-config-and-storage.md:13-47` |

### 1.2 What the code does

I traced the path from "app opens a file" to "row painted in the palette".

**The index is built in the webview, in TypeScript, once per launch, after first paint.** `runDeferredStartup` calls `loadIndex` on the idle queue (`apps/desktop/src/startup/idle-work.ts:106-116`). `loadIndex` (`idle-work.ts:145-188`) finds the root by probing `.git/HEAD` through `readFile` (`idle-work.ts:190-215`), lists every directory over IPC one level at a time (`prefetchDirectoryReader`, `idle-work.ts:225-270`), then reads **every markdown file in full** and keeps the first 256 KB to scan for headings (`idle-work.ts:142`, `163-185`). `buildIndex` and `entryFromCandidate` (`packages/core/src/index-model/build.ts:20-30`, `entry.ts:24-38`) turn that into `IndexEntry` values. Only markdown gets headings; source files get a title of the filename and no headings.

**The delivery to the palette is a one-shot callback.** `bootApplication` captures the entries from `onIndexLoaded` and calls `palette.setIndexEntries` (`apps/desktop/src/main.ts:11-14`). Nothing calls it again. `setIndexEntries` rebuilds the whole prepared index (`apps/desktop/src/palette/view.ts:494-498`, in the returned controller).

**Nothing keeps the index fresh.** The only file watcher in the app watches the folder of the open document (`apps/desktop/src/app.ts:892-904`), and it is non-recursive (`apps/desktop/src-tauri/src/watch/spawn_notify.rs:51`, `RecursiveMode::NonRecursive`). The shell-api comment calls the contract "Recursive directory watch" (`packages/shell-api/src/index.ts:26`) and `docs/navigation.md:18-22` says "Watch the root directory tree". The implementation does not match either. A file an agent writes after launch is not in the palette until the next launch.

**Persistence of the index exists as a library and is not used.** `serializeSnapshot`, `parseSnapshot` and `invalidateByMtime` (`packages/core/src/index-model/persist.ts:31-66`) are referenced only by their tests. The story that wired the index said so: "Persist the index snapshot: it is rebuilt each launch after first text, and persistence is a later story" (`docs/plan/tasks/MARXY-196.md:58-59`).

**The Rust index module is not part of the app.** `apps/desktop/src-tauri/src/index/mod.rs` (573 lines: walker, ignore rules, cache, a test suite) is not declared as a module. `main.rs` declares only `atomic_write`, `commands`, `error`, `watch` (`apps/desktop/src-tauri/src/main.rs:3-8`), and no other file contains `mod index`. It has no headings scanner and no query function. `nucleo` is not in `Cargo.toml` (`apps/desktop/src-tauri/Cargo.toml:11-19`). `docs/design/07-index-and-palette.md:13-77` and `docs/design/06-shell.md:37` still describe a Rust `index_query` over `nucleo-matcher`; ADR-0026 records that this was never built (`docs/adr/0026-shell-api-v1-surface.md:17-20`, `listRoot` and `fuzzy` "deprecated in place"). Per AGENTS.md, the ADR wins and the design document should be corrected.

**The matcher is a hand-written TypeScript scorer.** `fuzzyScore` (`apps/desktop/src/palette/search.ts:205-238`) is an exact-substring fast path plus a greedy subsequence scan. Weights are title 4, heading 3, path 2 (`search.ts:9-11`). It is applied to every prepared row on every keystroke, keeping a top-k buffer (`search.ts:69-129`). Rows are pre-normalised (NFC, lowercase) once per index load (`search.ts:29-42`). The design's ranking formula (`docs/design/07-index-and-palette.md:63-73`, nucleo, ×1.2/×0.9 weights, half-life frecency) is not what runs.

**Frecency is mostly absent.** The ranking reads `entry.lastReadMs` (`search.ts:176-187`), but nothing ever sets it: the only occurrences in non-test code are the two reads in `search.ts`. The MRU bonus (up to 80 points for the most recent) does work (`search.ts:182`). On disk, `history.json` stores an `at` timestamp per open, but `historyFromSession` rewrites it as `now - n` milliseconds for every entry (`apps/desktop/src/palette/history.ts:111-129`, line 117), so after the first restart the real times are lost.

**Roots are not what the documents say.** The design says `root = repositoryRoot(path) ?? dirname(path)` (`docs/design/07-index-and-palette.md:8`). The history code records `dirname(path)` as the root of every open (`history.ts:160-164`, `222-227`), and the palette session starts at `emptySession('/')` (`view.ts:331`) before hydration. The index itself holds only the **current** root's entries, so "then recent roots" can return nothing. Results still show up, because `searchPrepared` treats every non-current-root hit as a later hit and includes it when the current root has fewer than the limit (`search.ts:92-108`). It works by accident. I did not run the app to confirm what the palette shows after a restart, so treat this paragraph as read from code only.

**The palette's reach.** One `<dialog>`, summoned by `⌘P` (`view.ts:470-474`) and by the native menu item "Open Quickly…" (`apps/desktop/src-tauri/src/main.rs:645`). Twelve rows (`view.ts:23`). `Tab` toggles documents and headings (`view.ts:422-427`). `⌘.` pins (`view.ts:475-486`). `>` shows operations. Back and forward run on `⌘[` and `⌘]`. The design also specifies `⌘Enter` to open in Source, `⌘1..9` hints and `⌘P` cycling to operations (`docs/design/07-index-and-palette.md:87`). I found no handler for any of the three in `view.ts`. There is no way to add a folder to anything: with no argument, the app shows a passage from the Commonplace (`apps/desktop/src/frontispiece/index.ts:1`), and `Open File…` is the only way to reach a file that is not on the command line.

**Pins and MRU persist only at quit.** `history.json` is written by `flushPaletteHistoryFromApp` on close (`history.ts:209-220`; `app.ts:1002-1011`). A crash loses the session's opens and pins.

### 1.3 Measured

All commands run from `apps/desktop` on this machine (macOS, Apple Silicon). The scratch copies only change the constant `TREE` in `src/palette/search-perf.test.ts` and absolute-ise two imports; no tracked file was edited.

```
node --test --experimental-strip-types src/palette/search-perf.test.ts
  searchPrepared p95 on 20000 entries: 6.94 ms     (machine 1.38x the test's reference)

# scratch copies with TREE = 20_000 / 50_000 / 100_000
  searchPrepared p95 on 20000 entries:  6.58 ms
  searchPrepared p95 on 50000 entries: 15.16 ms
  searchPrepared p95 on 100000 entries: 25.14 ms
```

```
# prepareIndex (the per-load rebuild that setIndexEntries performs), scratch test
  prepareIndex 20000  11.5 ms
  prepareIndex 50000  19.5 ms
```

```
cd packages/core && node --test --experimental-strip-types src/index-model/build-perf.test.ts
  index: 20000 files in 141.5 ms      # synchronous Node fs walk, empty files, no IPC, no file reads
```

How to read these. The scorer is under budget at 20,000 entries and **on the budget line at 50,000** (15.16 ms of 16), and over it at 100,000. This is the query only; painting rows is extra. The synthetic entries have short titles and two headings each, so a real corpus with long headings is likely slower; I did not measure one. The 141 ms figure is not the app's cost. It excludes per-directory IPC, `.gitignore` reads and the full-file read of every markdown file, which is what the app does. **The real index build time in the app is unmeasured** (a startup mark `index_loaded` exists, `idle-work.ts:115`, but no budget or baseline records it: `fixtures/perf-budgets.json` has none). The multi-root design below needs that number before anything else is promised.

Real-world sizes on this machine, for scale (markdown only, excluding `node_modules`, `.git`, `target`, `.venv`):

```
find ~/.claude ~/Downloads ~/Dev/marxy ~/Dev/marxy-wt ~/Dev/command-center \
  \( -name node_modules -o -name .git -o -name target -o -name .venv \) -prune -o \
  -type f \( -name '*.md' -o -name '*.mdx' -o -name '*.markdown' \) -print | wc -l   # per directory
  ~/.claude 16 · ~/Downloads 4 · ~/Dev/marxy 524 · ~/Dev/marxy-wt 993 · ~/Dev/command-center 16
```

The author's own AI-output surface is a few thousand files, not fifty thousand. The ceiling and the matcher matter for strangers' machines more than for this one. But note `~/Dev/marxy-wt` holds 993 markdown files because each worktree is a full copy of the repository (section 3.3).

---

## 2. Prior art

I fetched current documentation for Obsidian, VS Code, Zed, `nucleo` and `tantivy` (sources at the end). The other rows are from general knowledge of those products and are marked as such; none of them changes the design in a way that depends on a detail I could have misremembered.

| Tool | Model of a "collection" | Search surface | Indexed | Latency claim | Borrow / avoid |
| --- | --- | --- | --- | --- | --- |
| **Obsidian** | A *vault*: one folder you open. | Quick Switcher (note name or alias; empty field shows recent notes; Enter on no match creates a note); separate search pane; Omnisearch is a community plugin for content. | Names and aliases for the switcher. Docs say that in vaults over 10,000 items the autocomplete "simplifies". | None quantified. | Borrow: empty field means recents, `down` + `Enter` toggles between two files. Avoid: create-on-miss (Marxy is a reader); degrading search quality at scale silently. |
| **VS Code** | A *workspace* (folder or `.code-workspace` file listing folders). | `⌘P` Quick Open (fuzzy file names, recent first, `@`/`#` for symbols); `⌘⇧F` content search in a panel. | Names via the file watcher; content by ripgrep on demand, no persistent index. | None quantified in docs. | Borrow: **one box, prefixes for modes**; content search by scanning on demand rather than indexing; a multi-root workspace is just a list of folders in a plain file. Avoid: the sidebar explorer. |
| **Zed** | A *project*: open folders. | `⌘P` file finder; `⌘⇧F` project search into a multibuffer; outline panel (`⌘⇧B`). | Paths; project search scans. | None. | Borrow: file finder as the primary hop; results that open as a reading surface. Avoid: persistent panels. |
| **Marked 2, Typora** | A single file; "recent files" menu. (General knowledge.) | None across files. | Nothing. | n/a | The gap Marxy fills; neither tracks a set. |
| **Notational Velocity / nvALT / The Archive** | One folder (or one database) of notes. (General knowledge.) | **One field that is both search and create**; the list filters as you type; selecting opens in place. | Titles and full text, in memory. | Famous for feeling instant at thousands of notes. | Borrow: the *single box* with the list beneath, no modes. Avoid: create-on-miss, again. |
| **Bear, Apple Notes** | A *library* with tags/folders; the app owns the store. (General knowledge.) | Search field in a sidebar chrome. | Full text in their own database. | n/a | Avoid: owning the data; the user's "files they preside over" stay files. |
| **Dash, Kiwix** | A set of *docsets / ZIM files* the user installs. (General knowledge.) | A global search across docsets, with a docset filter by keyword prefix. | Per-docset indexes built offline. | Fast because indexes are prebuilt. | Borrow: a **keyword scope** (type a short prefix to limit to one source). Avoid: download management; Marxy has nothing to download. |
| **Raycast, Alfred, Spotlight** | The whole machine; Alfred's file buffer and "recent documents" are cross-app. (General knowledge.) | A global launcher. | Spotlight: system metadata index. | Spotlight is near-instant because the OS maintains the index. | Borrow: a **learned ranking** (what you picked for this query before). Avoid: competing with the OS launcher; Marxy should not try to find *everything*. |
| **mdBook, Docusaurus** | A *spine*: `SUMMARY.md` or a sidebar config defines order. | Built-in static search over built pages. | Generated at build time. | n/a | Marxy's v1.1 "read-only spine" (`docs/roadmap.md:19-21`) is this; it is an *ordered* collection, a different thing from a searched one. Do not conflate. |
| **Zotero** | A *library* with user-made collections and saved searches; files are attachments Zotero tracks. | Quick search bar at the top of a persistent three-pane window. (General knowledge.) | Metadata plus full-text of attachments. | n/a | Borrow: collections and saved searches are separate concepts (a list you curate vs a query). Avoid: the three-pane window. |
| **Logseq** | A *graph*: one folder of pages and journals. (General knowledge.) | `⌘K` search over pages and blocks. | Pages and blocks in a local database. | n/a | Avoid: a database as the source of truth; Marxy must never touch a byte (AGENTS.md commitment 4). |
| **Finder tags, Alfred file buffer** | A *tag* the user applies; a *buffer* of selected files. | Tag as a saved filter. | Filesystem metadata. | n/a | Borrow only the idea: "recent" and "marked" are two short lists, not a database. |

What the survey says, in four points:

1. **Every fast tool has one box, not two.** The switcher and the search are the same field with prefixes (VS Code) or one list (Notational Velocity). Marxy already has the one box.
2. **A collection is almost always "a list of folders in a plain file".** VS Code's workspace file and Obsidian's vault are both that. Nobody who stays light builds a database of documents.
3. **Content search is done by scanning on demand, or by an index someone else maintains.** VS Code and Zed scan; Spotlight indexes at OS level. The only tools with their own full-text index own their data (Bear, Logseq). That is a reason for Marxy to prefer the scan.
4. **Nobody in the table is built around "the file was rewritten ten seconds ago by an agent".** That is Marxy's gap, and it affects the empty state more than the matcher.

---

## 3. The design question

### 3.1 The five meanings, and the argument

| | Meaning | What it costs | What it gives for AI output |
| --- | --- | --- | --- |
| (a) | The enclosing repo (today) | Nothing; exists. | Covers "docs in the project I'm in". Misses everything else. |
| (b) | A set of roots the reader adds | A plain file, a reader for it, multi-root indexing. | Covers `~/.claude/plans`, a notes folder, a second project. |
| (c) | A watched set of drop directories (`~/.claude`, `~/Downloads`, project `docs/`, worktrees) | (b) plus recursive watching and freshness UI. | This *is* the job: files appear without being asked for. |
| (d) | Curated list: pins plus recents | Exists (`session.ts:10`, `97-103`). | Good for "my three working documents". |
| (e) | Saved search | A query store and a place to surface it. | Useful later ("everything under `plans/` changed this week"). Not first. |

**Recommendation: (b) as the mechanism, (c) as the use of it, (d) as the front door, (a) as the default, and not (e) yet.**

- (a) stays as the implicit member: opening a file still adds its repository for the session, so a reader who never configures anything sees today's behaviour.
- (b) and (c) are the same data. A "watched drop directory" is a root with `watch = true`. They differ only in what the reader expects: a root they open files from, versus a folder where files appear. One list serves both.
- (d) is what the empty palette shows. This is already how ADR-0011 replaces tabs.
- (e) is deferred: the palette can already approximate it by typing, and a saved-search store is exactly the kind of "ledger" the author has asked to avoid.

Why not simply (a)? Because the author's use is not repository-shaped. An agent writes its plan to `~/.claude/plans/…`, a report to a worktree, a draft to `~/Downloads`. The enclosing-repo rule can only find files near the one already open.

### 3.2 The rule that comes from the brief

`docs/brief.md:72` lists "library browsing" as out of scope, and ADR-0012 says "No settings surface for roots in v1". The proposal departs from both on purpose and in a narrow way: **a list of folders, searched; never browsed.** There is no tree, no sidebar, no library window. This should be an ADR that amends ADR-0012 (roots are configurable) and clarifies the brief ("library browsing" means a browsable surface; a searchable set of folders is not that). The author should say whether they agree with that reading; I am not able to settle it.

### 3.3 Where the search bar lives: the palette, not beside it

The question had three options: same surface, a mode of it, or a replacement. The answer is **same surface; the collection is the palette's default scope.**

- **A persistent search bar would be a deliberate departure** from "chrome at rest is zero" (`docs/brief.md:57-59`), and the survey gives no reason for it. Zotero has one because its window is a library; Marxy's window is a document. The palette is summoned in one keystroke and dismissed in one, so "quick" is already met. I recommend against a persistent bar.
- **It is not a second surface.** Two search boxes with different scopes is the thing the survey says to avoid. The palette gains breadth, not a sibling.
- **A scope prefix stays minimal.** Today `>` means operations. Add nothing else on day one. If scopes are needed later, take Dash's idea: a short keyword prefix naming a root (for example `plans `), typed, not clicked.
- **The empty state is where the feature lives** (section 5.2). The thing the reader wants the second a new file lands is not a search; it is a list.

ADR-0011's reversal criterion still holds and becomes more important: the five-second test should be run with a collection of several roots, since a larger corpus makes "the document from three switches ago" harder to hit.

One real problem to decide: **duplicate worktrees.** `~/Dev/marxy-wt` holds 993 markdown files because it has two worktrees of one repository, plus the main checkout's 524 (`find` counts above). A collection containing all of them returns five copies of `AGENTS.md`. Proposed rule: roots that share a git common directory are one *group*; the current root's copy wins, and others fold under it ("+3 worktrees") unless their size or mtime differs. This is a ranking detail, but without it the collection is noisier than the single repo it replaces.

### 3.4 Headings only, or content too

- **Now:** titles, headings and paths. This is what ADR-0012 decided, and for long agent artifacts it is the right unit ("that section of that document").
- **Later: scan on demand, do not build an index.** I measured ripgrep over the author's three repository trees: 10.6 MB of markdown in 1,450 files (git-ignored files excluded; 1,533 with ignore rules off) searched in 20 ms warm and 100 ms on first run:

  ```
  rg -l --glob '*.md' -i 'baseline grid' marxy marxy-wt command-center    # 0.10 s, then 0.02 s, 0.02 s
  find marxy-wt marxy command-center ... -name '*.md' -print0 | xargs -0 cat | wc -c   # 10,637,132 bytes
  ```

  That is ripgrep, not Marxy's code, and a native scan inside the shell would sit in the same range for corpora this size. At that scale a persistent full-text index buys nothing but staleness, and the "a stale index is worse than none" rule is already written into `docs/navigation.md:15-16`. `tantivy` (named at `docs/roadmap.md:18`) advertises "tiny startup time (<10ms)" and sub-three-minute indexing of English Wikipedia, which is evidence that it can scale; it is not evidence that Marxy needs it. A scan, run only when the reader asks (a prefix such as `/`), is smaller, never stale, and needs no new on-disk file. Revisit `tantivy` only if a real collection passes a few hundred megabytes. Ripgrep's `grep-searcher` and `grep-regex` crates are the natural building blocks; they share the `ignore` crate already named in the design.

### 3.5 Freshness: the AI-artifact problem

Agent output differs from notes in three ways: it is rewritten rather than edited, the reader did not open it first, and the same name keeps reappearing. The palette should answer "what changed since I last looked", not just "what did I last open".

What the code can already say:

- **mtime** is on every `IndexEntry` (`packages/core/src/contracts/index-entry.ts:7`).
- **"Last read"** can come from `positions.json`, which already records a position per path (`packages/core/src/position/persistence.ts:59`) and from the real open timestamps in `history.json`, once they stop being synthesised (section 1.2).
- So **"changed since read" = mtime greater than last-read** is computable with no new field and no contract change. `IndexEntry.lastReadMs` is declared in the frozen contract and merely never filled.

What it should look like in results:

1. A row shows a short relative time ("2m", "3d") in dim type on the right, always, for rows from a watched root.
2. A row whose mtime is newer than last-read carries one small mark. It is a mark on the row, not a badge count anywhere.
3. In the empty state, "changed since you read it" is its own short section above recents (section 5.2).
4. In ranked results, recency is a **tie-breaker with a small bonus**, not a rank: a stale exact match must not lose to a fresh vague one. Today ties go to `lastReadMs` then path (`search.ts:193-199`); add mtime before path. The weights in `search.ts:176-187` should be tuned against a fixture, which is a taste-adjacent change (see `docs/adr/0031-token-values-are-taste.md` for how this project treats such values).
5. While an open document is regenerated, the existing live-reload and position rules apply (ADR-0018). That is already the defining interaction in the brief. The collection simply extends it from "the file you are reading" to "the files you track".

---

## 4. Data model and storage

### 4.1 One principle: declared versus observed

| | Who writes it | Where | Why |
| --- | --- | --- | --- |
| **What the reader declared**: which folders are in the collection, what to deny | The reader, in a text editor (or Marxy, on an explicit "add this folder" command) | `collection.toml` beside `config.toml` | A plain, commented, hand-editable file; the reader owns it. |
| **What Marxy observed**: opens, pins, positions, the index | Marxy | `history.json`, `positions.json`, `index/<sha1(root)>.json` (all already designed) | Disposable; deleting any of them costs only convenience. |

This follows `docs/design/11-config-and-storage.md:54-58` ("nothing here is ever about a document's content") and the author's "the user is a first-class owner of their data" frame. It also avoids putting a list into `config.toml`, whose writer only edits top-level keys byte-for-byte (`docs/design/11-config-and-storage.md:34-38`). Appending a table to a different file is simpler and has a smaller blast radius.

### 4.2 `collection.toml`

```toml
# Folders Marxy searches. Edit freely; Marxy re-reads this file when it changes.

[[root]]
path  = "~/.claude/plans"
name  = "Claude plans"      # optional; shown dim beside results
watch = true                # default true; false = rescan on launch only

[[root]]
path = "~/Dev/marxy/docs"

[deny]
globs = ["**/drafts/**", "**/*.generated.md"]    # added to the built-in deny list
```

- **Roots.** Absolute or `~`-prefixed. Each root is walked with the same rules as today (`.gitignore`, `.ignore`, built-in deny list from `packages/core/src/index-model/deny.ts`, extension allow-list, never follow symlinks).
- **The implicit root.** The repository of the file you opened is always searched too (rule (a)), and is *not* written to the file unless the reader runs "add this folder".
- **Inclusion by extension** stays on the existing allow-list. HTML is already indexed as `source` (`packages/core/src/index-model/kinds.ts:40`), which fits "Markdown/HTML" in the author's frame; whether HTML should be a first-class kind with its own title extraction is a separate question for the artifact work.
- **Deny.** The built-in list cannot be overridden by a root (as today, `deny.ts`); the file only adds to it. Nothing under a root's deny list is ever read.
- **Ceiling.** The existing 50,000-per-root rule holds, but see 4.4: the matcher, not the walker, hits the wall first.
- **Parsing.** `smol-toml`, already chosen for `config.toml` (`docs/design/11-config-and-storage.md:29`). Unknown keys are reported once; a bad file falls back to "no extra roots" and says so. This is the same failure handling as `config.toml`.
- **No network.** Local paths only. A root cannot be a URL; there is no sync. Commitment 3 in AGENTS.md is untouched.

### 4.3 Invalidation on watch events

The design intent (`docs/navigation.md:18-22`) is: on change elsewhere, update the entry. Not built. The honest plan:

1. **Recursive watch per watched root**, through the existing ref-counted table in `main.rs` (`watch_root`/`unwatch_root`, `main.rs:305-340`), which already shares one `notify` thread per canonical root. Making it recursive is a one-line change in `spawn_notify.rs:51` plus the scan/diff in `watch/mod.rs`, which today is non-recursive by design (its header, `watch/mod.rs:1-2`). macOS FSEvents handles trees cheaply. On Linux, inotify needs a watch per directory and has a system limit; a root whose watch fails must degrade to "rescan on summon" with a one-line notice, never an error (the existing code already treats a failed watch as non-fatal, `app.ts:898-904`).
2. **Debounce and coalesce** per root (the shell already batches events; `app.ts:896`).
3. **Per-event update, not rebuild.** A created or modified file: stat it, re-read it, re-scan headings, replace one entry. A removed file: drop it. A rename: drop plus add. This needs `prepareIndex` to become incremental: today `setIndexEntries` rebuilds all rows (measured 19.5 ms at 50,000 entries, section 1.3), which is itself more than one keystroke budget if done on the UI thread for every event. One changed file must cost one row.
4. **Snapshots validate by stat, not trust.** On launch, serve the persisted snapshot immediately, walk in the background, diff by `(path, mtime, size)` (this is exactly `invalidateByMtime`, `persist.ts:52-66`), and patch. Any disagreement means the disk wins.
5. **Atomic writes and renames** (what agent tooling does) already have tests for the open document (ADR-0018); the same event kinds drive the entry update.

### 4.4 What happens with 50,000 files

- **Walk and read.** The current approach reads every markdown file in full over IPC and slices after the transfer (`idle-work.ts:163-185`). For 50,000 files that is 50,000 reads. The cost is unmeasured (section 1.3). First step: measure `index_loaded` on a synthetic 50,000-file root in the real app, record it, then decide. Cheap mitigations if needed: snapshot first (4.3 point 4), re-read only changed files, and read only the head of each file from Rust.
- **Match.** At 50,000 entries the TypeScript scorer is at the 16 ms line (section 1.3). Three options in order of cost:
  1. Narrow before scoring: score only the **current group first** and stop when it fills 12 rows with strong hits; the code already ranks current-root hits first (`search.ts:82-92`).
  2. Cheaper rows: pre-split a path into segments and match titles and headings only when the path misses.
  3. Move the scorer to Rust `nucleo-matcher` and send `indexQuery` over IPC. The design document's own estimate is 2 to 4 ms for 50k (`docs/design/07-index-and-palette.md:75-77`), and the `nucleo` project reports about 3 million items in about 1/30 s in its demonstration (README). Neither number is measured on Marxy's data. This option is the only one that needs a new shell-api member (`indexQuery`, listed as planned in `docs/design/06-shell.md:37`) and therefore an ADR (section 6.3). **Do it only if options 1 and 2 are not enough.**
- **Ceiling policy.** Per root, 50,000, newest first, with the existing notice. For a collection, add a total (suggest 100,000) so many roots cannot defeat the per-root rule. These numbers are placeholders: they are in `INDEX_LIMITS` (`index-entry.ts:14`), which is frozen, so a collection-wide cap lives in app code, not the contract.

---

## 5. UX proposal

Minimal, in the author's sense: no new surface, one new file, one new section.

### 5.1 Keys

| Key | Action | Status |
| --- | --- | --- |
| `⌘P` | Summon or dismiss the palette | exists |
| type | Fuzzy over the whole collection, current group first | exists for one root; extend |
| `↑` `↓` `Enter` | Move, open | exists |
| `Tab` | Documents / headings | exists |
| `⌘.` | Pin or unpin | exists |
| `>` | Operations | exists |
| `/` then text | Content scan (later, section 3.4) | new, later |
| `⌘Enter` | Open in the split (hand-off, 5.4) | new; design 07 gives this key to "open in Source", which has no handler, so it can be reassigned by one decision |
| *Edit collection* | A palette command that opens `collection.toml` in Marxy | new |
| *Add this folder* | A palette command that appends the current document's root to `collection.toml` | new |

Two commands, no dialog, no settings pane. Opening the file in Marxy follows "Settings as a document" in `docs/roadmap.md:25`, so a reader's collection is a document they can read and edit in the tool that presides over it. This also avoids needing a folder-picker: the webview never calls the dialog plugin (`apps/desktop/src-tauri/src/main.rs:798`), and `openDialog` in the stub throws (`apps/desktop/src/render/stub.ts:20`, `55`).

### 5.2 Results and the empty state

**Empty query** (three short sections, each hidden when empty, twelve rows total):

1. **Pinned.** As today.
2. **Changed since you read.** Files in watched roots whose mtime is newer than last-read, newest first, capped (suggest 5). Each row shows the relative age.
3. **Recent.** MRU as today.

This is the whole freshness feature. It answers the question the survey found nobody answering. It is zero chrome because it only exists while the palette does.

**Typed query:** one list, ranked by match, then pinned/MRU bonus, then mtime tie-break. Each row: title, dim relative path or root name, dim age. Heading hits read `Title › Heading` as today (`labelForHit`, `view.ts:240-246`). No grouping headers in a typed list; ranking is the grouping. The root name appears only when more than one group is in the results.

**Preview.** None. Hover preview is chrome and a latency cost, and opening a document is already under 50 ms (ADR-0011). Revisit only if the five-second test fails.

**Notice line.** The existing one-line notice area (`view.ts`, `.marxy-palette-notice`) carries "indexing…", the ceiling message, and "watch unavailable for `<root>`; rescan on open".

### 5.3 Hand-off to the split-view study

The collection and the split study meet at one function. The palette's `activateHit` today opens one document in the one view (`view.ts:391-399`, via `openDocument`). The hand-off is:

```
openHit(hit, { target: 'here' | 'split' })    // 'here' = today
```

This study defines everything up to `openHit` (index, ranking, rows, keys) and nothing after it. The split study defines what `'split'` does and which key is bound to it. The palette does not decide where a document appears.

---

## 6. Implementation sketch against the real code

### 6.1 Files that change

| File | Change |
| --- | --- |
| `apps/desktop/src/startup/idle-work.ts` | `loadIndex` becomes multi-root: `loadIndexes(shell, roots)`. Keep the "after first paint, on idle" rule (`packages/core/src/index-model/schedule.ts`). Serve a snapshot first. |
| `packages/core/src/index-model/` | New `collection.ts`: parse `collection.toml` (shell-free, takes bytes), expand `~`, merge deny globs. Use `persist.ts` as already written. Add incremental `applyEvents(entries, events)`. |
| `apps/desktop/src/palette/search.ts` | Incremental `PreparedIndex` (add, replace, remove a row). Mtime tie-break. Fill `lastReadMs`. Group-aware ordering. Keep `fuzzyScore`. |
| `apps/desktop/src/palette/session.ts`, `history.ts` | Persist real `at` timestamps (stop synthesising them, `history.ts:111-129`). Record the repository root, not `dirname` (`history.ts:160-164`). Write `history.json` on each open, not only at quit. |
| `apps/desktop/src/palette/view.ts` | Empty-state sections; row age and "changed" mark; the two commands; `openHit(hit, {target})`. |
| `apps/desktop/src-tauri/src/watch/spawn_notify.rs`, `watch/mod.rs` | Recursive watch for roots flagged `watch`, with graceful failure. |
| `apps/desktop/src/app.ts` | Subscribe to collection-root watches and feed `applyEvents`. The open-document watch stays as is. |
| `apps/desktop/src-tauri/src/index/mod.rs` | **Decide**: delete it (it is dead code with 573 lines and a test suite that runs nowhere) or finish it. Under this proposal it is deleted, or kept only if option 3 of 4.4 is chosen. Also fix `docs/design/07-index-and-palette.md` and `06-shell.md` to say what runs. |
| `docs/adr/` | New ADR: collection roots (amends ADR-0012; clarifies `docs/brief.md:72`). |

### 6.2 The matcher

Today: hand-written TypeScript (`search.ts:205-238`), 6.6 ms p95 at 20,000 entries and 15.2 ms at 50,000. `nucleo` is **not used** anywhere; it appears only in design documents. Keep the TypeScript scorer for the first cut: it is shell-free (ADR-0020), testable in Node, and the contract is untouched. Measure at 50,000 with real data before moving it. If the move is needed, `nucleo-matcher` is the right crate (its README recommends it over the full `nucleo` when only a matcher is wanted).

### 6.3 Contracts

- `packages/core/src/contracts/index-entry.ts` is byte-pinned (`package.json` `test:contracts-frozen`, hash for `index-entry.ts` is in the script). **The proposal needs no change to it:** `root`, `mtimeMs`, `lastReadMs`, `kind`, `headings` already express everything, and the collection-wide cap and group logic live in app code.
- `packages/shell-api/src/index.ts` is *not* under the hash-pinned `contracts/` directory (the guard matches `^packages/[^/]+/src/contracts/`), but ADR-0026 froze it by convention and by AGENTS.md. The proposal needs no new member while the matcher stays in TypeScript: it uses `readDir`, `readFile`, `watch`, `configPaths`, `stat`, all present. The one exception is a Rust-side `indexQuery` (option 3, section 4.4), which would need an ADR and its own PR.
- The implementation of `watch` must be brought up to what the interface already promises ("Recursive", `shell-api/src/index.ts:26`). That is a bug fix, not a contract change.

### 6.4 Stories

Each is one PR, in this order. Names are placeholders; the project's own process assigns keys.

1. **ADR: collection roots.** Amends ADR-0012, clarifies the brief, records `collection.toml`, the declared-versus-observed split, and the "no persistent bar" decision. *Accept: ADR merged; `docs/design/07` and `06` corrected to say the index and matcher are TypeScript; the dead Rust module is removed or justified.*
2. **Make the existing palette honest.** Persist real open times; record the repository root; fill `lastReadMs` from `history.json`; write history on open. *Accept: a restart preserves relative recency (a test with two opens an hour apart); a palette test shows frecency changing order; no behaviour change for a single root.*
3. **Persist and validate the index snapshot.** Wire `persist.ts`; serve the snapshot at once; diff in the background. *Accept: second launch shows entries before the walk finishes; a stale entry (changed mtime) is corrected; `index_loaded` mark is recorded with a count and a duration.*
4. **Measure the real index build at 20k and 50k files.** A synthetic root in the real app, marks recorded under `fixtures/perf-budgets.json`'s existing pattern (recorded, not gated, ADR-0032). *Accept: numbers in the repo; decision on read strategy made from them.* This story can run in parallel with 2 and 3.
5. **Multi-root index from `collection.toml`.** Parser, `~` expansion, deny globs, per-root and total caps, group rule for worktrees. *Accept: fixture with two roots returns hits from both with root names; a denied glob never appears; a malformed file falls back with one notice.*
6. **Recursive watch and incremental update.** Recursive `notify` for watched roots, graceful failure on Linux limits, `applyEvents`, incremental `prepareIndex`. *Accept: a file created by write-temp-then-rename appears in the palette within 100 ms of the debounce; deleting removes it; one changed file does not rebuild the prepared index (a test counts rows touched).*
7. **Palette: empty-state sections and row age.** Pinned, changed-since-read, recent; relative age; one mark; mtime tie-break. *Accept: snapshot of the empty-state model for a fixture; typed ranking unchanged for existing fixtures; palette still has no tab bar (the existing `TAB_BAR_DOM_MUTATION` check, `view.ts:26`).*
8. **Commands: Edit collection, Add this folder.** *Accept: "Add this folder" appends a table and preserves every other byte of the file (same property test shape as `setTopLevelKey`); "Edit collection" opens the file in Source mode.*
9. **Open-in-split hand-off.** `openHit(hit, {target})` plus the key. *Accept: `'here'` is byte-for-byte today's behaviour; `'split'` is stubbed until the split study lands.*
10. **(Later) Content scan.** `/` prefix, `grep-searcher` on demand over the collection, no persistent index, cap on results. *Accept: first match under 50 ms on the author's three trees (the find-first-match budget in AGENTS.md); no new file on disk.*

Stories 2, 3, 4 are independent of the product decision and are worth doing even if the collection idea is dropped, because they repair the existing palette. That is the parallelism the author's memory notes ask for.

### 6.5 Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **Matcher at the budget line** | 15.16 ms at 50k, over at 100k; one collection of several roots can pass 50k. | Narrow-first, cheaper rows, then Rust `nucleo-matcher` only if measured. Measure with real data, not the synthetic test. |
| **Index build time unknown** | Reads every markdown file in full over IPC. | Story 4 before any promise; snapshot-first. |
| **Contract freeze** | `index-entry.ts` is byte-pinned; `shell-api` is frozen by ADR. | Design stays inside both. The one escape hatch (Rust `indexQuery`) is named and gated by an ADR. |
| **Recursive watch limits** | inotify per-directory watches on Linux; large trees on any OS. | Graceful degrade with a notice; rescan on summon. |
| **Duplicate worktrees** | Five copies of every doc. | Group by git common directory; fold. |

---

## 7. What I could not establish

- The real, in-app index build time (section 1.3). Nothing in the repository records it.
- Real-corpus matcher time. The measured test is synthetic.
- How the palette behaves across a restart with a real `history.json`. I read the code but did not launch the app.
- Linux inotify behaviour on a large root (not testable here).

## 8. Sources

Fetched 2026-10-01: Obsidian Quick Switcher help (obsidian.md/help/plugins/quick-switcher), VS Code editing documentation (code.visualstudio.com/docs/editing/editingevolved), Zed finding and navigating (zed.dev/docs/finding-navigating), `helix-editor/nucleo` README, `quickwit-oss/tantivy` README. Rows marked "general knowledge" in section 2 were not fetched.

---

## For the synthesis

- The palette's search works for one repository, but the index behind it is rebuilt on every launch, delivered once, never updated by file changes (the only watcher is non-recursive on the open document's folder), and is single-root, so "files an agent writes after launch" are invisible until restart.
- The design documents describe a Rust index with `nucleo`; the running app uses a hand-written TypeScript scorer and a TypeScript walker, and `apps/desktop/src-tauri/src/index/mod.rs` (573 lines) is not compiled in. ADR-0026 records this; the design docs and the Rust module should be corrected or deleted.
- Several fields the ranking relies on are dead: `lastReadMs` is never set, `history.json` timestamps are rewritten as `now - n` on every save, and recent-roots use `dirname` rather than the repository root. Fixing these (independent of any new feature) is cheap and should come first.
- The TypeScript matcher measures 6.6 ms p95 at 20,000 entries, 15.2 ms at 50,000 and 25.1 ms at 100,000 against a 16 ms budget (synthetic data, query only); a multi-root collection can cross the line, and the real in-app index build time has never been measured.
- Recommended design: a user-owned, hand-editable `collection.toml` listing folders (watched or not), searched through the existing palette as its default scope, with no persistent search bar, no sidebar and no preview; "declared" (collection.toml) stays separate from "observed" (history, positions, index snapshot).
- The feature that actually serves "manage AI output" is the empty state: Pinned, then "Changed since you read" (mtime newer than last-read), then Recent, with a relative age on each row; no surveyed tool answers this question.
- Content search should be an on-demand scan (ripgrep-style, `/` prefix) rather than a `tantivy` index: ripgrep scans 10.6 MB in 1,450 markdown files in 0.02 s warm, and a persistent index only adds staleness.
- No frozen contract needs to change if the matcher stays in TypeScript: `IndexEntry` already has root, mtime, lastRead and kind, and the shell-api already has the needed members; only a Rust-side `indexQuery` would need an ADR.
- A new ADR is needed because the proposal amends ADR-0012 ("no settings surface for roots") and touches the brief's "library browsing" exclusion; the author should rule on whether "a searchable list of folders, never browsed" is consistent with that exclusion.
- Hand-off to the split-view study is one seam, `openHit(hit, { target: 'here' | 'split' })`; this study owns everything before it and none of what happens after.
