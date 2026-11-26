# Handoff: tidemark 0.5.0 release check

Picked up from the release agent's run this morning. The tarballs are built and signed; the manifest is the last thing to check before the announcement goes out.

## What the manifest says

The release endpoint returned this for 0.5.0. Four artifacts, one per target, and the checks from the CI run that built them.

```json
{
  "name": "tidemark",
  "version": "0.5.0",
  "released": "2026-10-20",
  "artifacts": [
    { "target": "aarch64-apple-darwin", "file": "tidemark-0.5.0-macos-arm64.tar.gz", "bytes": 3951104 },
    { "target": "x86_64-apple-darwin", "file": "tidemark-0.5.0-macos-x64.tar.gz", "bytes": 4183552 },
    { "target": "x86_64-unknown-linux-gnu", "file": "tidemark-0.5.0-linux-x64.tar.gz", "bytes": 4402176 },
    { "target": "x86_64-pc-windows-msvc", "file": "tidemark-0.5.0-windows-x64.zip", "bytes": 4710400 }
  ],
  "checks": { "tests": 412, "failed": 0, "ignored": 3 },
  "yanked": false
}
```

The Windows zip is the one nobody has opened yet.

## Checked by hand

```
$ shasum -a 256 tidemark-0.5.0-macos-arm64.tar.gz
4be1d0c97a6e2f1b8c35d7e90a4f6b21c8d3e5f7a9b0c1d2e3f405162738495a  tidemark-0.5.0-macos-arm64.tar.gz
$ tar -tzf tidemark-0.5.0-macos-arm64.tar.gz | head -3
tidemark
LICENSE
README.md
```

## Still to do

- [ ] Open the Windows zip on the test VM and run `tidemark --version`
- [ ] Post the announcement once Hannah has read the release notes
