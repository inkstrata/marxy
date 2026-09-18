# 01 — The buffer

The document as bytes, and the only way those bytes ever change. Lives in
`packages/core/src/buffer/` (new). Shell-free; the shell only reads and writes `Uint8Array`.

## Type

```ts
export interface Buffer {
  readonly path: string;            // absolute; 'untitled' for a buffer with no file
  readonly bytes: Uint8Array;       // the file, exactly; never normalised
  readonly text: string;            // decoded with { ignoreBOM: true }: char 0 is U+FEFF when bom
  readonly bom: boolean;
  readonly eol: 'lf' | 'crlf' | 'mixed' | 'none';   // see Line endings
  readonly version: number;         // increments on every splice; 0 on creation
  readonly offsets: ByteOffsets;    // utf-16 → byte, built once (packages/core/src/parse/byte-offsets.ts)
}
```

`text` is only for display and for Source mode. Every range in the system is in bytes.

## API (`packages/core/src/buffer/index.ts`)

```ts
export function createBuffer(path: string, bytes: Uint8Array): Buffer;
export function bytesOf(buffer: Buffer, range: Source): Uint8Array;      // view, not copy
export function textOf(buffer: Buffer, range: Source): string;           // decode of that slice; MUST throw RangeError if range is not at UTF-8 boundaries
export function splice(buffer: Buffer, range: Source, replacement: string | Uint8Array): Buffer;  // pure: returns a new Buffer, version + 1
export function fromText(path: string, text: string, like: Buffer): Buffer;  // encode with `like.eol` and `like.bom`; used when leaving Source mode with edits (§09)
export function byteToUtf16(buffer: Buffer, byte: number): number;       // for CodeMirror positions (§09); linear-scan fallback for non-ASCII, cached
export function utf16ToByte(buffer: Buffer, cu: number): number;         // = buffer.offsets.at(cu)
export function contentHash(bytes: Uint8Array): string;                  // FNV-1a 64 as hex; used by watch reload (§08)
```

`splice` **MUST** produce `bytes = concat(bytes[0..start), encode(replacement), bytes[end..))`
and nothing else. A property test (`packages/core/scripts/fidelity.ts` already exists for the
open→save case; extend it) asserts for every corpus file and every node: splicing a node's
range with its own bytes yields identical bytes, and splicing with `"X"` changes exactly
`[start, end)`.

## Undo

```ts
export interface Edit { readonly range: Source; readonly before: Uint8Array; readonly after: Uint8Array; readonly label: string }
export class History { push(edit: Edit): void; undo(buffer: Buffer): Buffer | null; redo(buffer: Buffer): Buffer | null; readonly canUndo: boolean; readonly canRedo: boolean; }
```

One `Edit` per operation invocation, even when the operation touched several ranges (v1
operations touch one). Undo re-splices `after.length` bytes at `range.start` with `before`.
Depth 100. Cleared when the buffer is replaced by an external reload (§08) — a reload is a
new document, and undoing across it would splice into bytes the user never saw.

## Line endings

Detected once at `createBuffer`: count `\r\n` and lone `\n`; `crlf` if all line breaks are
`\r\n`, `lf` if all are `\n`, `mixed` otherwise, `none` if there are no line breaks. Operations
that produce line breaks (align table pipes, §03) **MUST** use `eolString(buffer)`: `'\r\n'` for
`crlf`, `'\n'` for `lf` and `none`, and for `mixed` the ending of the *line they are rewriting*
(each rewritten line keeps its own ending). Nothing ever converts an untouched line.

## Dirty state and the disk

- `dirty = buffer.version !== savedVersion`. Shown in the window title as ` •`, nowhere else.
- `save(shell, buffer)` → `shell.writeFileAtomic(buffer.path, buffer.bytes)`; on success
  `savedVersion = version` and `savedHash = contentHash(bytes)`.
- A watch event for `buffer.path` whose content hash equals `savedHash` is the app's own write
  and is ignored. Any other external change while `dirty` raises the conflict notice (§08);
  while clean it reloads silently with position kept.
- `untitled` buffers cannot be saved without a path from `shell.openDialog` (Phase 3).

## Tests (`packages/core/src/buffer/buffer.test.ts`)

| Case | Expect |
| --- | --- |
| `12-crlf-and-bom.md` | `bom = true`, `eol = 'crlf'`, `text[0] === '﻿'`, `bytes` identical after `splice` of an empty range with `''` |
| `13-no-trailing-newline.md` | `eol = 'lf'`, last byte not `\n`, untouched by any splice elsewhere |
| non-ASCII (`07-cjk.md`) | `textOf` of a heading equals the heading text; `byteToUtf16(utf16ToByte(n)) === n` for every code-unit index |
| range inside a multibyte char | `textOf` throws `RangeError` |
| `splice` then undo | bytes identical to original; `version` monotonic |
| `fromText` with `eol = 'crlf'` | every `\n` in the text becomes `\r\n`; BOM restored when `like.bom` |
