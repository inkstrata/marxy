Made with `python -I` (stdlib `tarfile`, `bz2` and `lzma`): `sample.tar.bz2` and `sample.tar.xz` hold `docs/`, `docs/a.md` and `b.txt` with mtime 1700000000; `note.txt.bz2` and `note.txt.xz` hold one line of text. Zip, tar and gzip fixtures are built inside the tests.

`shared.zip`, `shared.tar.gz` and `expected.json` are written by `node make-shared.mjs`: the table the Rust reader and the TypeScript twin (`packages/core/src/viewer/archive-read.test.ts`) both check, entry by entry (offset, CRC, system, mode, flags, comment, the directory, and each entry's first 64 bytes or its refusal).
