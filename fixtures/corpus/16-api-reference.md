<!-- Sample of an API reference: nested lists, option tables, inline code. -->

# `shelf` — local document index

A reader-facing index for a folder of markdown. `shelf` watches a root, keeps one
row per file, and answers prefix queries without leaving the machine. Nothing in
this document is fetched; every path is local.

## Install

```sh
pnpm add shelf
```

The package exports three names: `openShelf`, `Shelf`, and `ShelfError`. Types
live next to the implementation in `src/index.ts`.

## `openShelf(root, options?)`

Opens or creates the index under `root/.shelf`. Returns a `Promise<Shelf>`.

### Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `watch` | `boolean` | `true` | Subscribe to the filesystem after the first scan |
| `ignore` | `string[]` | `['node_modules', '.git']` | Directory names skipped at every level |
| `ext` | `string[]` | `['.md', '.markdown']` | Extensions treated as documents |
| `limit` | `number` | `10_000` | Hard cap on indexed files; opening past it throws `ShelfError` |
| `hash` | `'fnv1a64' \| 'none'` | `'fnv1a64'` | Content hash written on each row |

Nested behaviour when `watch` is `true`:

- A create event
  - under a watched directory
    - whose name is not in `ignore`
      - and whose extension is in `ext`
        - inserts a row and emits `change` with `{ op: 'add', path }`
- A delete event
  - for a path that already has a row
    - removes the row and emits `{ op: 'remove', path }`
- A rename is modelled as remove-then-add; `path` on the add is the new name.

`hash: 'none'` is for fixtures. Production code should leave the default: the
row's `hash` is what a later open uses to skip a file whose bytes have not
moved.

## `Shelf`

### `query(prefix, opts?)`

Returns rows whose `path` or `title` starts with `prefix`, case-folded. `opts`:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `max` | `number` | `20` | Rows returned, never more |
| `in` | `'path' \| 'title' \| 'both'` | `'both'` | Which fields the prefix is tested against |
| `order` | `'path' \| 'mtime'` | `'path'` | Sort after the filter |

A query never touches the disk. The in-memory table is the only input; a
caller that needs fresh bytes calls `refresh()` first.

### `get(path)`

Exact lookup. `path` is the POSIX form stored on the row (`docs/brief.md`,
never `docs\\brief.md`). Missing paths return `undefined`, not a throw.

### `refresh()`

Rescans `root` once. Use after a burst of writes the watcher may have
coalesced. Returns `{ added, removed, updated }` counts.

### `close()`

Drops the watcher and the table. A later method call throws `ShelfError`
with `code: 'closed'`.

## Row shape

Each row is a plain object. Fields a reader of the index will see:

- `path` — relative to `root`, `/`-separated, no leading slash
- `title` — first ATX heading, or the file stem if the file has none
- `bytes` — length of the file as opened, not of the decoded text
- `mtime` — `mtimeMs` from `stat`, integer
- `hash` — lowercase hex, or `''` when `hash` was `'none'`

```ts
import { openShelf } from 'shelf';

const shelf = await openShelf('/Users/reader/notes', {
  ignore: ['node_modules', '.git', '.shelf'],
  ext: ['.md'],
});

const hits = shelf.query('docs/ad', { max: 8, in: 'path' });
for (const row of hits) {
  process.stdout.write(`${row.path}  ${row.title}\n`);
}

await shelf.close();
```

## Errors

`ShelfError` is the only throw. `code` is one of:

- `not-a-directory` — `root` exists and is not a directory
- `limit` — the scan would exceed `options.limit`
- `closed` — a method ran after `close()`
- `io` — a `stat` or `read` failed; `cause` holds the original error

There is no network error code. `shelf` does not open URLs.

## See also

- The changelog for this package: [CHANGELOG.md](https://example.invalid/shelf/changelog)
- The type definitions in `src/types.ts` (`Shelf`, `ShelfRow`, `ShelfOptions`)
