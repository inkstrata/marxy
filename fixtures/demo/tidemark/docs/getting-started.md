---
title: Getting started
applies-to: tidemark 0.4.0
sample: constructed for the reader prototype
---

# Getting started

tidemark keeps a small index of a folder of Markdown files, and keeps it inside that folder, in `.tidemark/`. This page takes you from nothing to an index you can read, in about five minutes.

## Install

tidemark is published on crates.io and needs Rust 1.83 or later. If `rustc --version` reports something older, run `rustup update` first.

```console
$ cargo install tidemark
    Updating crates.io index
  Downloaded 31 crates (3.2 MB) in 1.18s
  Installing tidemark v0.4.0
   Compiling ignore v0.4.23
   Compiling tidemark v0.4.0
    Finished `release` profile [optimized] target(s) in 41.07s
  Installing /home/you/.cargo/bin/tidemark
   Installed package `tidemark v0.4.0` (executable `tidemark`)
$ tidemark --version
tidemark 0.4.0
```

<details>
<summary>Building from source</summary>

You need git and the same Rust toolchain. The repository pins its versions in `.tool-versions`, so `asdf install` or `mise install` inside the clone will fetch the right one.

```console
$ git clone https://git.example.org/tidemark/tidemark.git
$ cd tidemark
$ make test
cargo test
test result: ok. 41 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.62s
$ cargo build --release
$ ./target/release/tidemark --version
tidemark 0.4.0
```

Use `cargo build --release` rather than `make release`. The make target also signs the binary with `scripts/sign.sh`, which needs a signing identity on the machine, and a build you only run yourself does not need one.

</details>

## Make your first index

1. Choose a folder. Anything with Markdown files in it will do; the examples here use `~/notes`.
   - tidemark only reads your files. The one thing it writes is the `.tidemark/` folder at the top.
   - If the folder holds code projects, check that their dependency folders are covered by a `.gitignore`. The walk honours it even when the folder is not a repository.
2. Index it:

   ```console
   $ tidemark index ~/notes
   indexed 1,203 Markdown files (1,412 paths) in 148 ms
   ```

3. Look at what was written:

   ```console
   $ ls -a ~/notes/.tidemark
   .  ..  .gitignore  index
   ```

   - `index` is the index itself, about 200 bytes for each file.
   - `.gitignore` contains a single `*`, so git ignores the folder if your notes are a repository.
4. If you will run tidemark from inside the folder, save the setting in `tidemark.toml` at its top, and `tidemark index` with no arguments will do the right thing:

   ```toml
   root = "~/notes"
   ```

To see where the time went, add `--stats`:

```console
$ tidemark index ~/notes --stats
walked   1,412 paths (1,203 Markdown) in 10 ms
parsed   1,203 files in 130 ms
wrote    .tidemark/index (245 KB) in 8 ms
total    148 ms
```

## Read the result

`tidemark list` prints the index newest first: when each file last changed, its path and its title. The title comes from the front matter if there is one, then the first heading, then the file name.

```console
$ cd ~/notes
$ tidemark list --limit 4
2026-10-15 09:12  2026-10-15.md              Wednesday 15 October
2026-10-14 22:31  reading/on-the-measure.md  On the measure
2026-10-14 08:03  2026-10-14.md              Tuesday 14 October
2026-10-13 17:25  meeting-2026-10-13.md      tidemark sync, 13 October
$ tidemark list --headings --limit 1
2026-10-15 09:12  2026-10-15.md              Wednesday 15 October
    # Wednesday 15 October
    ## Numbers from the spec
```

For scripts, `--json` prints one object per line with the same fields, plus the links each file makes to others.

## Keep it fresh

An index is a snapshot. To keep it current while you write, leave `tidemark watch ~/notes` running in a terminal; it re-indexes 200 ms after you stop saving, and stops with Ctrl-C. Setting `watch = true` in `tidemark.toml` makes a plain `tidemark index` do the same after its first run.

> [!CAUTION]
> Do not point tidemark at your home folder. The walk honours `.gitignore`, but most of a home folder is not covered by one, so tidemark will read everything it can reach and leave a `.tidemark/` at the top of your home. Index the folders you write in, one at a time.

## Commands and flags

| Command | Flag | What it does |
| :--- | :--- | :--- |
| `tidemark index [PATH]` | | Builds or refreshes the index for `PATH`, else `root` from `tidemark.toml`, else the current folder |
| | `--stats` | Prints how long the walk, the parse and the write each took |
| | `--quiet` | Prints nothing unless something fails |
| `tidemark list [PATH]` | `--limit N` | Prints only the `N` newest files |
| | `--headings` | Prints each file's headings under it, indented |
| | `--json` | Prints one JSON object per line |
| `tidemark watch [PATH]` | `--debounce MS` | Waits this long after the last change before re-indexing; 200 by default |
| any | `--help`, `--version` | Prints help or the version and exits |

## Where next

[How tidemark works](architecture.md) explains the walk, the parser, the index file and the watcher, and is the page to read before changing any of them. [Configuration](config.md) lists every setting `tidemark.toml` accepts and the errors you can meet, such as `root not found`.
