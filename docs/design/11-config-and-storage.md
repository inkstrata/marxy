# 11 — Config and storage

What marxy writes to disk about itself, where, in what format, and what happens when it is
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
size = 17                       # body px, 13–24
measure = 68                    # ch, 45–90
typeset = true                  # the Knuth–Plass path; false = engine wrapping, grid pass only
line_numbers = false            # Source mode
external_editor = "code --goto {file}:{line}"   # {file} {line} substituted; absent → the OS default opener
resident = false                # stay running after the last window closes (ADR-0013)

[linux]
weight_offset = 75              # overrides the WebKitGTK-version table (§05)
```

Parsed with `smol-toml` (MIT) by `packages/theme/src/config.ts` (it is theme-adjacent and
shell-free: the shell hands it the bytes). Unknown keys are ignored with a notice listing them
once. Invalid values fall back to the default for that key, with a notice. The file is read at
startup and watched (§08 mechanism); changes apply live except `resident`.

There is no settings UI in v1; `Mod+=`/`Mod+-` write `size` back to the file (the only write
marxy makes to config), preserving the rest of the file byte-for-byte by editing the one line
(or appending it).

## Data files

| File | Content | Cap | Owner |
| --- | --- | --- | --- |
| `index/<sha1(root)>.json` | §07 envelope | 50 000 entries; files older than 90 days unused are deleted at startup | shell |
| `positions.json` | §08 | 5 000 paths, LRU | app |
| `history.json` | opens, pins, recent roots (§07) | 500 opens, 12 roots | app |

Every file starts with `"version": 1`. Reading a file whose `version` is newer than the app
knows → ignore it (do not overwrite; a newer marxy wrote it). Unparseable → rename to
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
