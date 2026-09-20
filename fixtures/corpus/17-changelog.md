<!-- Sample of a changelog: version headings, dense short bullets, links, dates. -->

# Changelog

All notable changes to `shelf` are recorded here. Dates are the day the
tag was cut. Compare links go to `example.invalid` and are not fetched.

## [1.4.0] — 2026-09-12

### Added

- `query` accepts `order: 'mtime'` so a palette can show recent files first
- `refresh()` return value now includes `updated`, not only `added` and `removed`

### Changed

- Default `ignore` now lists `.shelf` next to `node_modules` and `.git`
- `get` documents that Windows separators are not stored; callers normalise first

### Fixed

- A rename inside an ignored directory no longer leaked a `change` event
- Empty files kept a stale `title` from the previous hash; they now use the stem

## [1.3.2] — 2026-08-28

### Fixed

- `close()` after a failed `watch` no longer threw `closed` twice
- Prefix match on a title that starts with a digit (`12-notes.md`) was skipped

## [1.3.1] — 2026-08-19

### Fixed

- `hash: 'none'` still wrote a placeholder hex; the field is now `''`

## [1.3.0] — 2026-08-04

### Added

- `options.ext` so a tree that also holds `.txt` notes can opt them in
- `ShelfError.code` values listed in the API reference

### Changed

- `limit` default raised from `2_000` to `10_000`

### Removed

- The undocumented `shelf.raw()` dump; use `query('', { max: limit })` instead

## [1.2.0] — 2026-07-15

### Added

- Watcher coalesces bursts of writes into one `change` with `{ op: 'update' }`
- `ShelfRow.bytes` so a caller can skip a file it already has in memory

### Fixed

- First open on a cold cache blocked the event loop for the whole scan

## [1.1.0] — 2026-06-30

### Added

- `in: 'path' | 'title' | 'both'` on `query`
- MIT licence file in the published tarball

### Changed

- Titles come from the first ATX heading, not the first line of the file

## [1.0.0] — 2026-06-11

### Added

- `openShelf`, `query`, `get`, `close`
- FNV-1a 64 hash on every row

[1.4.0]: https://example.invalid/shelf/compare/v1.3.2...v1.4.0
[1.3.2]: https://example.invalid/shelf/compare/v1.3.1...v1.3.2
[1.3.1]: https://example.invalid/shelf/compare/v1.3.0...v1.3.1
[1.3.0]: https://example.invalid/shelf/compare/v1.2.0...v1.3.0
[1.2.0]: https://example.invalid/shelf/compare/v1.1.0...v1.2.0
[1.1.0]: https://example.invalid/shelf/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.invalid/shelf/releases/tag/v1.0.0
