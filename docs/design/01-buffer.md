# 01 — The buffer

The document as bytes, and the only way those bytes ever change. Lives in
`packages/core/src/buffer/` (new). Shell-free; the shell only reads and writes `Uint8Array`.

**Owner.** MARXY-14 landed the byte-faithful save path in Rust (`atomic_write.rs`) and
`tauri.ts`, but not this module; nothing on `main` builds a `Buffer`. MARXY-34 (reload),
MARXY-37 (Source mode), MARXY-41–43 (operations) and MARXY-49 (save) all consume it, and "check
whether someone else landed it first" is how two agents end up editing one file. The module is
therefore its own story, **MARXY-93**, which lands everything in this document except
`save` (MARXY-49). Every consumer depends on it and none of them creates files under
`packages/core/src/buffer/`.

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
export function eolString(buffer: Buffer, atByte?: number): '\n' | '\r\n';   // §Line endings; for `mixed`, the ending of the line containing atByte
export function lineOf(buffer: Buffer, byte: number): number;            // 1-based line number; the external editor (§09) and the truncation notice (§12)
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
- Saving is §Save below; on success `savedVersion = version` and `savedHash = contentHash(bytes)`.
- A watch event for `buffer.path` whose content hash equals `savedHash` is the app's own write
  and is ignored. Any other external change while `dirty` raises the conflict notice (§08);
  while clean it reloads silently with position kept.
- `untitled` buffers cannot be saved without a path from `shell.saveDialog` (ADR-0026).

## Save (MARXY-49, `apps/desktop/src/shell/save.ts`)

```ts
export async function save(ctx: AppContext, opts?: { as?: boolean }): Promise<'saved' | 'unchanged' | 'cancelled' | 'failed'>
```

1. In Source mode, first fold the editor into the buffer exactly as leaving Source does (§09):
   unchanged text → buffer untouched; changed → `fromText` + one history entry. Saving never
   takes bytes from anywhere but `buffer.bytes`.
2. If `!dirty && !opts.as` → `'unchanged'`; nothing is written (no mtime bump, no watch echo).
3. Path: `buffer.path`, or for `untitled`/`opts.as`, `await shell.saveDialog({ defaultPath })`;
   `null` → `'cancelled'`. A read-only document (any path with the `marxy:` scheme, i.e. the bundled `about.md`, §13) → notice
   "about.md is part of Marxy and cannot be saved", `'cancelled'`.
4. `await shell.writeFileAtomic(path, buffer.bytes)`. The Rust side already refuses read-only
   files, foreign owners and hard-linked files with a message; those refusals arrive as
   `ShellError { code: 'permission' }` and become the persistent save-failed notice (§09):
   "Could not save README.md: it is read-only." [Save as…] [Dismiss].
5. On success: `savedVersion = version`, `savedHash = contentHash(bytes)`, title loses ` •`
   (`shell.setTitle`), and a save-as re-points `buffer.path`, re-allows the asset scope for the
   new directory and moves the reading position entry to the new path.

`Mod+S` in either mode calls `save(ctx)`; `Mod+Shift+S` calls `save(ctx, { as: true })`.
There is no autosave. Closing or quitting with a dirty buffer is intercepted (Tauri
`CloseRequested`, `api.prevent_close()` while the webview reports dirty) and shows a notice,
not a modal: "README.md has changes that are not saved." [Save and close] [Close without
saving]. A second close request while that notice is up closes without saving — the reader
asked twice. Opening another document from the palette while dirty takes the same path. This
is the only place Marxy stops the reader, and it is queued for taste review #3.

## Tests (`packages/core/src/buffer/buffer.test.ts`)

| Case | Expect |
| --- | --- |
| `12-crlf-and-bom.md` | `bom = true`, `eol = 'crlf'`, `text[0] === '﻿'`, `bytes` identical after `splice` of an empty range with `''` |
| `13-no-trailing-newline.md` | `eol = 'lf'`, last byte not `\n`, untouched by any splice elsewhere |
| non-ASCII (`07-cjk.md`) | `textOf` of a heading equals the heading text; `byteToUtf16(utf16ToByte(n)) === n` for every code-unit index |
| range inside a multibyte char | `textOf` throws `RangeError` |
| `splice` then undo | bytes identical to original; `version` monotonic |
| `fromText` with `eol = 'crlf'` | every `\n` in the text becomes `\r\n`; BOM restored when `like.bom` |
