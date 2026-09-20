<!-- Sample of an AI/agent artifact: interleaved prose, tool output, mixed-language fences, long paths. -->

# Session — stale title after a zero-byte write

The reader opened `/Users/reader/notes/docs/brief.md`, then an external editor
saved the file as zero bytes. The palette still showed the old title. This
transcript is the pass that found why.

## What I was asked

`refresh()` reported `{ added: 0, removed: 0, updated: 1 }` but `query('brief')`
kept returning `title: "The product, distilled"`. The file on disk is empty.

## What I opened

The row is built in `buildRow`. Title comes from `firstAtx`, which walks the
decoded text and returns the first heading, or the stem when the walk finds
none.

```ts
export function firstAtx(text: string, stem: string): string {
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(\S.*)$/.exec(line);
    if (m) return m[1]!.trim();
  }
  return stem;
}
```

That function is fine on `''`: it returns `stem`. The stale title is not
coming from here.

## Tool: the row that was served

```json
{
  "path": "docs/brief.md",
  "title": "The product, distilled",
  "bytes": 0,
  "mtime": 1758312044123,
  "hash": "cbf29ce484222325"
}
```

`bytes` is 0 and `hash` is the empty FNV-1a 64. The row *was* rewritten. The
title field was copied from the previous row when `hash` matched. Empty
files all share that hash, so a file that used to have a heading keeps it
after being truncated.

## Tool: the skip

```sh
rg -n "hash === previous.hash" /Users/reader/Dev/shelf/packages/index/src/scan/build-row-from-stat.ts
```

```text
/Users/reader/Dev/shelf/packages/index/src/scan/build-row-from-stat.ts:41:  if (previous && hash === previous.hash) return previous;
```

That is the line. A truncated file and a never-written file both hash to
`cbf29ce484222325`, so the old row wins.

## The fix I would take

Keep the short-circuit only when `bytes` is also unchanged:

```ts
if (previous && hash === previous.hash && bytes === previous.bytes) return previous;
```

A zero-byte write then falls through to `firstAtx('', stem)` and the palette
shows `brief`. I have not applied this; the file is yours.

## Paths I touched while reading

- `/Users/reader/Dev/shelf/packages/index/src/scan/build-row-from-stat.ts`
- `/Users/reader/Dev/shelf/packages/index/src/query/compile-term-expression.ts`
- `/Users/reader/notes/.shelf/rows/docs/brief.md.json`

None of those paths were written. The document on disk is still the empty
`docs/brief.md` the reader saved.
