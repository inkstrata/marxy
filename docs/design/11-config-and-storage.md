# 11 — Config and storage

What Marxy writes to disk about itself, where, in what format, and what happens when it is
wrong. Nothing here is ever about a document's content.

## Locations (`shell.configPaths()`)

| | macOS | Linux |
| --- | --- | --- |
| config | `~/Library/Application Support/marxy/config.toml` | `$XDG_CONFIG_HOME/marxy/config.toml` (`~/.config/marxy/`) |
| data | `~/Library/Application Support/marxy/` | `$XDG_DATA_HOME/marxy/` (`~/.local/share/marxy/`) |

## `config.toml` (D-A18), all keys optional

```toml
theme = "~/themes/quiet"        # a directory with theme.toml; absent → the default theme
variant = "dark"                # dark (default, ADR-0024) | light | auto (follows the OS)
size = 20                       # body px, 15–50 (75–250 % of the default, ADR-0033)
measure = 66                    # average characters per line, 45–80 (never ch, ADR-0033)
typeset = true                  # the Knuth–Plass path; false = engine wrapping, grid pass only
line_numbers = false            # Source mode; absent: on for code files, off for prose
external_editor = "code --goto {file}:{line}"   # {file} {line} substituted; absent → the OS default opener
resident = false                # stay running after the last window closes (ADR-0013)

[linux]
weight_offset = 75              # overrides the WebKitGTK-version table (§05)

[[kind]]                        # how a folder's files are read (ADR-0060 item 9); first match wins
glob = "~/.claude/projects/**/*.jsonl"
is = "transcript"               # one of the fourteen kinds
read = true                     # optional: open in Read (true) or Source (false)
```

Parsed with `smol-toml` (MIT) by `packages/theme/src/config.ts` (it is theme-adjacent and
shell-free: the shell hands it the bytes). Unknown keys are ignored with a notice listing them
once. Invalid values fall back to the default for that key, with a notice. The file is read at
startup and watched (§08 mechanism); changes apply live except `resident`.

There is no settings UI in v1. Marxy writes to the config file in exactly four cases:
`Mod+=`/`Mod+-`/`Mod+0` write `size`, "Use light variant" and "Use dark variant" write `variant`,
and "Use this theme" (§05) writes `theme`. All three preserve the rest of the file byte-for-byte by editing the one top-level line for that key (or appending
it before the first `[table]` header, with the file's own line ending), through one function,
`setTopLevelKey(bytes, key, tomlValue): Uint8Array` in `packages/theme/src/config.ts`. The fourth is
"Always open this folder as" (below), which appends one `[[kind]]` table.

### `[[kind]]` (ADR-0060 item 9, K-04)

A reader's rule for how files are read, in file order; the first rule whose `glob` matches a path
decides its kind, and a rule beats detection. `glob` and `is` are required; `read` is optional.

- `glob` is absolute (`/…`, `~/…`, `C:/…`) or opens with `**`; `~` is expanded, `.`, `..` and `//`
  are resolved lexically and the text is composed (NFC), the way a `[[capture]]` path is. A `..` that
  would climb above the root, or that follows a segment holding `*` or `?`, refuses the rule. A UNC
  path is refused. Matching ignores case and Unicode composition on every platform, so `~/Notes/**`
  matches `~/notes/a.md`; `*` stays inside a folder, `**` crosses folders.
- `is` is one of the fourteen kinds (`KINDS`, `packages/core/src/contracts/kinds.ts`). A name outside
  the set drops the rule with a warning naming it. `read = true` opens the file Rendered, `false` in
  Source (ADR-0060 item 7).
- A bad rule is skipped with a warning naming its position (`kind 2 …`); unknown keys are listed once
  as `kind.<key>`; at most 200 rules are read; `kind` that is not a list of tables is ignored with one
  warning. None is fatal.
- "Always open this folder as" appends `[[kind]]` with `glob = '<folder>/**'` (the home folder written
  as `~`) and `is`, through `appendKindRule(bytes, rule, { home })` in `packages/theme/src/config.ts`:
  every input byte stays as the prefix of the output; only a line ending (the file's own), a blank line
  and the table are added; an empty file starts from a one-line comment. A rule already there, in any
  spelling the matcher treats as the same, changes nothing; the same glob with another kind is
  refused (the older rule would win), so the reader edits it by hand. A file that is not TOML, or whose
  `kind` is not a list of tables, is left exactly as it is.

## `kinds.json` (ADR-0060 item 9, K-04), in the data directory beside `positions.json`

*Show as* for one file: the kind a reader chose for it, which beats any rule. Marxy's own record, in
a plain file, never a part of the document.

```json
{ "version": 1, "kinds": { "/users/ian/.claude/projects/a.jsonl": "transcript" } }
```

- It holds a kind and nothing else: a version and path to kind. No front-matter value, no tool name.
  A path is kept in one spelling (`.`, `..` and `//` resolved, composed, lower-cased), so a file has
  one entry however it was opened.
- Unlike `positions.json` it is **never evicted**. At 5,000 files a choice for a new file is refused
  with a notice naming the cap and nothing earlier is dropped; changing or forgetting a file's choice
  still works. A version newer than this Marxy's is read and not written back; a corrupt file (not
  UTF-8, not JSON, no numeric version) is copied to `kinds.json.bad-<ms>` and an empty one started;
  an entry whose value is not a kind is ignored.
- Precedence (item 9): *show as* for the file, then the first matching `[[kind]]` rule, then
  detection. Forgetting the choice restores the rule's kind. `detectFileKind` in
  `packages/core/src/kind/show-as.ts` applies it.

## `collection.toml` (ADR-0053), beside `config.toml`

The folders the palette searches besides the repository of the open file. The reader's file: Marxy
reads it, re-reads it when it changes, and writes to it in exactly one case, the command "Add this
folder", and saving a query (below); each appends one table and preserves every byte before it.

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

[[query]]
name = "Open plans"
q = "kind:report has:tasks in:~/.claude/plans"
description = "Plans with open tasks"   # optional
```

- A `path` is absolute or `~`-prefixed and local; a URL is rejected. Each root is walked by the rules
  of §07 (`.gitignore`, `.ignore`, the built-in deny list, the extension allow-list, no symlinks).
  The built-in deny list cannot be overridden; `[deny]` only adds to it.
- Parsed with `smol-toml`, from bytes the shell hands over (`packages/core/src/index-model/`, shell-free).
  Unknown keys are reported once; an unparseable file falls back to no extra roots and says so, as
  `config.toml` does. Nothing in it is about a document's content.
- A `[[query]]` is a saved query, a Smart collection in the sidebar (ADR-0062). `name` and `q` are
  required, non-empty strings; `description` is optional. `q` is stored as the reader wrote it and
  parsed by the query language, not here. A `name` is at most 80 characters and unique
  (case-insensitive; a later duplicate is dropped with a warning), a `q` at most 1,000, and at most
  200 queries are read. A bad entry is skipped with a warning; `query` that is not a list of tables is
  ignored with one. Built-in smart collections (near-duplicates, broken paths) are code and are never
  written here. Saving a query appends one `[[query]]` table, byte-faithfully like a folder.

### `[[capture]]` (ADR-0063)

A rule is the reader's standing request that Marxy copy files out to a folder they own. Marxy ships
none, and writes none: the reader edits the file by hand. This section is the parse and validation
only; the copying is P-03.

```toml
[[capture]]
from = "~/.claude/projects/**/*.jsonl"   # a glob; its first fixed folder is the base
to   = "~/Notes/sessions"                # a folder
```

| Key | Meaning |
| --- | --- |
| `from` | An absolute or `~`-prefixed glob. `fromBase` is the folder part before its first glob character (`~/.claude/projects`), which P-03 keeps copies relative to. |
| `to` | An absolute or `~`-prefixed folder. |

A rule that fails any check is skipped with one warning that names it (`capture 2 (from "…" to "…") …`);
the others stand. Refused:

- a missing or non-string `from` or `to`;
- a path that is not absolute and local (the rule the roots use), or a `\\host\share` network path;
- a `..` that climbs above the root, or that follows a glob segment in `from`. `.`, `..` and empty
  segments are otherwise resolved lexically before any comparison, and `from`, `to` and `fromBase` are
  stored resolved;
- a `from` with no fixed folder (`/**/*.md`);
- a `to` that is `/` or the home folder itself;
- a `to` inside `fromBase`, or a `fromBase` inside `to`, which would copy in a loop;
- a `to` inside, equal to, or holding (an ancestor of) Marxy's own config or data folder (the host passes
  them as `ownFolders`, as it passes `home`, in `~` form or absolute; the desktop shell takes them from
  `configPaths`, as the C-14 refusal of a root does);
- a `to` matching a `[deny]` glob or the built-in deny list, as written or case-folded.

The loop, root/home and own-folder checks compare on a folded key (Unicode NFC, then lower case) on
every platform, so `~/notes` and `~/Notes` count as the same folder; a case-sensitive volume may
therefore see a false refusal, and the warning says it compared without regard to case.

**What P-03 must do at copy time.** These are string checks and cannot see symlinks, hard links or a
volume's real case sensitivity. P-03 must (a) realpath `fromBase` and `to` and re-run the loop and
own-folder checks on the resolved paths; (b) never follow a symlink out of `fromBase`; (c) check each
destination file's realpath is still under `to`; (d) skip any source whose resolved path is under `to`
or an own folder.

Unknown keys are reported as `capture.<key>`. More than 32 rules warn and the rest are dropped. The
Privacy page's sentence is the constant `CAPTURE_PRIVACY_LINE` (ADR-0063 item 6, verbatim, with a test
that reads the ADR), and `capturePrivacyLines(rules)` fills in each rule's paths.

## Data files

| File | Content | Cap | Owner |
| --- | --- | --- | --- |
| `index/<sha1(root)>.json` | §07 envelope, with an optional `baselineMs` (when Marxy first indexed the root; set once, never moved; `version` stays 1) | 50 000 entries; files older than 90 days unused are deleted at startup | shell |
| `positions.json` | §08 | 5 000 paths, LRU | app |
| `history.json` | opens, pins, recent roots (§07) | 500 opens, 12 roots | app |
| `trust.json` | per-document grants: HTML, image hosts ([§12](13-trust.md)) | 2 000 paths, LRU | app |

Every file starts with `"version": 1`. Reading a file whose `version` is newer than the app
knows → ignore it (do not overwrite; a newer Marxy wrote it). Unparseable → rename to
`<name>.bad-<timestamp>` and start fresh; never crash, never block first paint (these reads are
off the critical path). Writes are atomic through `shell.writeFileAtomic`.

## What is never stored

Document contents, document hashes tied to identities, window geometry keyed by document,
anything network-derived. The index stores paths, titles and headings, which are already on the
reader's disk in the documents themselves.

## Tests

- `config.test.ts`: the defaults; every clamp; unknown keys reported once; a `size` write
  preserves every other byte of a fixture config file.
- `storage.test.ts`: version-newer is left untouched; corrupt file is renamed and a fresh one
  written; LRU caps hold.
