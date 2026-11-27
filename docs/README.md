# Marxy documentation

What the software does, how it is built and how it is worked on. Each document describes the code as
it is; file paths are relative to the repository root.

## Using it

| Document | Covers |
| --- | --- |
| [Using Marxy](using-marxy.md) | opening files, Read and Source, the cursor and its verbs, the Line, the window, panels, editing and saving, notes, versions, export, settings |
| [Keys](keys.md) | every key and chord, by where it applies |
| [File types, kinds and readings](file-kinds.md) | how a file is recognised, the readings and viewers, size limits, adding a file type |

## How it works

| Document | Covers |
| --- | --- |
| [Architecture](architecture.md) | the packages, the path from bytes to page, editing and saving, the shell boundary, the front end's modules |
| [The desktop shell](desktop-shell.md) | the Rust side: startup, commands, file access, watching, archives and decoders, OS integration |
| [Themes, looks and type](themes-and-type.md) | theme sheets, the look engine, tokens, the Studio, colour per language, typesetting, fonts |
| [What Marxy keeps on disk](data-on-disk.md) | the config and data folders and every file in them |

## Working on it

| Document | Covers |
| --- | --- |
| [Development](development.md) | toolchain, running in a browser and as the app, building, signing, an installed build, common changes |
| [Testing and checks](testing.md) | test layers, `pnpm verify`, the real-window check, `pnpm check`, gates, fixtures, measurement tools |
| [Working on Marxy](working.md) | the workspace around the checkout, the tracker, the cycle from picking work to clearing its worktree, pictures of a change, `pnpm work` |

## Research behind the design

| Folder | Holds |
| --- | --- |
| [research/reader-typography](research/reader-typography/) | the Reader Typography Handbook: how a reading page is set, with sources and lab pages |
| [research/reader-artifacts](research/reader-artifacts/) | the Reader Artifacts Handbook: reading tasks and the artifacts agents produce (transcripts, structured output, code, diffs): how a reader should present them |
| [research/audit-2026-10](research/audit-2026-10/) | an audit of the earlier architecture (October 2026); kept as history, not a description of this code |

The tracker and the records of how the work was carried out are in [work/](../work/README.md), not here.

## Each level's own README

A README sits beside the code it describes and lists that level's layout, commands and tools.

| README | Level |
| --- | --- |
| [scripts](../scripts/README.md) | every tool run from the root, and the rule for where a tool goes |
| [apps/desktop](../apps/desktop/README.md) | the app, its package scripts and its tools |
| [packages/core](../packages/core/README.md) | parsing, kinds, readings, operations |
| [packages/theme](../packages/theme/README.md) | tokens, themes, looks, settings |
| [packages/typeset](../packages/typeset/README.md) | the typesetter |
| [packages/shell-api](../packages/shell-api/README.md) | the `Shell` interface |

Coding agents start with [AGENTS.md](../AGENTS.md).
