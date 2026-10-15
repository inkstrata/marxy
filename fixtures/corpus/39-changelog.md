# Changelog

All notable changes to `tideline` are recorded here, newest first. Dates are the day a
tag was cut. Compare links go to `example.invalid` and are not fetched.

## Unreleased

### Added

- `tideline watch --quiet` prints nothing but errors

## [0.9.2] - 2026-10-04

### Fixed

- The watcher no longer re-indexes a file three times when an editor saves through a temporary file
- `index.max_file_mb = 0` now means "no limit" instead of "skip everything"

```text
## [9.9.9] - 2099-01-01
this is a fenced line, not a release
```

## [0.9.0](https://example.invalid/compare/v0.8.4...v0.9.0) - 2026-09-20

### Added

- Highlight cache keyed by content hash. Warm runs are 20 to 30 times faster
- `tideline watch` command

### Changed

- `index.max_file_mb` default raised from 4 to 8

## [0.8.4] - 2026-08-30

### Fixed

- A symlink loop in a watched folder no longer fills the log

[0.9.2]: https://example.invalid/compare/v0.9.0...v0.9.2
[0.8.4]: https://example.invalid/compare/v0.8.3...v0.8.4
