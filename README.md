# Marxy

A desktop reader for the files on your machine. Marxy opens Markdown, plain text, source code, data
(JSON, YAML, TOML, XML, JSON Lines, CSV), logs, diffs and terminal sessions, notebooks, mail, HTML,
archives, PDFs, images, audio and video, fonts, spreadsheets, Word documents and decks, certificates,
programs and SQLite databases, and shows each the way that suits it: a typeset page, a data tree, a
table, a coloured listing, a card of facts, a viewer, or the bytes.

- **Read and Source.** Read shows the file set as a page; Source is a CodeMirror editor over the exact
  bytes. One key switches between them, and the place is kept.
- **Exact bytes.** Marxy changes only the bytes you change: line endings, byte order marks and
  encodings are kept, every edit is a splice over a byte range, and a save is an atomic replace.
- **Work on what you read.** A cursor moves over a document's parts (sections, blocks, rows, entries);
  single keys copy, collect, fold and transform them; edits are staged and saved as one patch, with
  earlier copies kept as versions.
- **Many files.** Tabs, two panes side by side, places (folders you add), search and replace across
  them, an outline and links per file, comparison of any two files or versions, and export to a web
  page, PDF, Markdown or a bundle.
- **Looks.** Bundled dark and light themes, a Studio to make your own, per-language code colours, a
  typesetter with ragged-right line breaking, hyphenation and hanging punctuation, and contrast held to
  fixed floors.
- **Local.** Settings are a `config.toml`; state is plain JSON in the app's data folder. Nothing is sent
  anywhere; remote images in a document load only when you allow them.

## Install a release

Releases are on the [releases page](https://github.com/inkstrata/marxy/releases), for macOS 13 or
later on Apple silicon. The build is not notarised, so macOS refuses it the first time: open System
Settings, Privacy and Security, and choose Open Anyway, or run
`xattr -dr com.apple.quarantine /Applications/Marxy.app`. Each release's notes are in
[docs/releases](docs/releases/). There is no Windows or Linux download yet.

## Quick start

Building from source requires Node 24.2 or later, pnpm 11, Rust (stable) and, on Windows, the Visual Studio C++
build tools.

```bash
pnpm install
pnpm --filter @marxy/desktop exec vite --port 1420 --strictPort   # the app in a browser, over the demo files
pnpm --filter @marxy/desktop dev                                   # the desktop app
pnpm --filter @marxy/desktop bundle                                # the installer
```

## Repository

| Path | What it is | Its README |
| --- | --- | --- |
| `packages/core` | parsing, file types and detection, readings, operations, sanitising, highlighting, search | [core](packages/core/README.md) |
| `packages/typeset` | line breaking, hyphenation, hanging punctuation, baseline grid | [typeset](packages/typeset/README.md) |
| `packages/theme` | tokens, base CSS, themes, the look engine, `config.toml` | [theme](packages/theme/README.md) |
| `packages/shell-api` | the interface to privileged operations | [shell-api](packages/shell-api/README.md) |
| `apps/desktop` | the app (`src`), its Rust shell (`src-tauri`) and its tests | [desktop](apps/desktop/README.md) |
| `scripts` | checks, gates, runners, measurements and the work-cycle tools | [tools](scripts/README.md) |
| `fixtures` | the test corpus and the demo workspace | |
| `fonts` | bundled typefaces (SIL OFL 1.1) | [fonts](fonts/README.md) |
| `docs` | what the software does, how it is built and how it is worked on | [index](docs/README.md) |
| `work` | the tracker, where `main` stands, and the records of each run of work | [schema](work/README.md) |

## Documentation

| Doc | Covers |
| --- | --- |
| [Using Marxy](docs/using-marxy.md) | the window, reading, the cursor, panels, editing and saving, settings |
| [Keys](docs/keys.md) | every key and chord |
| [File types, kinds and readings](docs/file-kinds.md) | how a file is recognised and shown |
| [Architecture](docs/architecture.md) | how the code fits together |
| [Design principles](docs/principles.md) | the rules every change follows, and the shapes to copy |
| [The desktop shell](docs/desktop-shell.md) | the Rust side: commands, files, watching, archives |
| [Themes, looks and type](docs/themes-and-type.md) | themes, the look engine, tokens, typesetting, fonts |
| [What Marxy keeps on disk](docs/data-on-disk.md) | settings and state files |
| [Big files](docs/big-files.md) | what a 1 to 5 MB file goes through, the rules every feature follows, the checks |
| [Development](docs/development.md) | setup, running, building, signing, installing a build |
| [Testing and checks](docs/testing.md) | test layers, checks, fixtures, measurement |
| [Working on Marxy](docs/working.md) | the workspace, the tracker, the cycle a change goes through, `pnpm work` |

## Working on it

```bash
pnpm work                          # where things stand: open branches, worktrees to clear, the tracker
pnpm work start <name>             # a branch and a worktree for a piece of work
pnpm verify --tier changed         # the checks that cover what changed
```

The method is in [docs/working.md](docs/working.md); open work is in [work/todo.md](work/todo.md) and where
`main` stands is in [work/STATE.md](work/STATE.md). Agents working in this repository start with
[AGENTS.md](AGENTS.md).

## Licence

MIT, except the fonts in `fonts/` (SIL Open Font License 1.1). Third-party notices are in
`THIRD_PARTY_NOTICES.md`.
