# Configuration

`tidemark` reads `tidemark.toml` from the folder it indexes.

## `root`

**Parameters:** a path. **Returns:** nothing; sets the folder to index.

Example:

```toml
root = "~/notes"
```

## `watch`

**Parameters:** `true` or `false`. **Default:** `false`.

Re-index when a file changes.

## Errors

- `root not found` — the path does not exist.
- `permission denied` — the folder cannot be read.
