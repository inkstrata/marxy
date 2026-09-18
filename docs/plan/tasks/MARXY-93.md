---
key: MARXY-93
design: [01-buffer]
depends: [MARXY-11]
verify: [pnpm precheck, pnpm done MARXY-93]
---
# MARXY-93 — The document buffer: bytes, splice, undo, line endings

**Design:** [01-buffer](../../design/01-buffer.md) (everything except §Save) · **Depends on:** MARXY-11 · **ADRs:** ADR-0003, ADR-0004.

**Outcome.** `packages/core/src/buffer/` exists and is the only way a document's bytes change. Nothing a reader sees changes; MARXY-34, 37, 41–43 and 49 build on it and none of them creates files here.

## Files and signatures
- `packages/core/src/buffer/buffer.ts` — `Buffer`, `createBuffer`, `bytesOf`, `textOf`, `splice`, `fromText`, `byteToUtf16`, `utf16ToByte`, `contentHash`, `eolString`, `lineOf(buffer, byte): number` (1-based; used by the truncation notice and the external editor).
- `packages/core/src/buffer/history.ts` — `Edit`, `History` (depth 100, `clear()`).
- `packages/core/src/buffer/index.ts` — re-exports; `packages/core/src/index.ts` exports `./buffer/index.ts`.
- `packages/core/src/buffer/buffer.test.ts`, `history.test.ts`.
- `packages/core/scripts/fidelity.ts` — extend with the splice property.

## Do this, in order
1. `createBuffer`: decode with `new TextDecoder('utf-8', { ignoreBOM: true })`; detect `bom`, `eol` as §01 §Line endings; reuse `packages/core/src/parse/byte-offsets.ts` for `offsets` (do not write a second UTF-16→byte table).
2. `splice`: build the new bytes by concatenation only; `version + 1`; recompute `text`, `eol`, `offsets` from the new bytes.
3. `textOf` throws `RangeError` on a range not at UTF-8 boundaries (a continuation byte `0b10xxxxxx` at `start` or `end`).
4. `fromText(path, text, like)`: replace every `\r\n` and lone `\n` in `text` with `eolString(like)` (for `mixed`, use `\n`), prepend U+FEFF when `like.bom` and it is not already there, encode.
5. `contentHash`: FNV-1a 64 over the bytes with `BigInt`, lowercase hex, 16 chars.
6. `History`: `push` truncates the redo branch; `undo` re-splices `after.length` bytes at `range.start` with `before`.
7. Fidelity property in `fidelity.ts`: for every corpus file and every AST node, splice the node's range with its own bytes → identical; splice with `"X"` → bytes outside `[start, end)` identical, inside is `X`.

## Tests → expected
| Check | Expect |
| --- | --- |
| §01 test table (six rows) | all pass |
| `lineOf` | byte 0 → 1; first byte after the first `\n` → 2; CRLF counted once |
| `History` | push, undo, redo, push-after-undo drops redo; depth 101st push drops the oldest |
| `pnpm gate:fidelity` | green; neutralise `splice` to return `buffer` unchanged → the `"X"` property fails |
| `contentHash` | stable known value for `''` (`cbf29ce484222325`) and for `12-crlf-and-bom.md` (write it into the test) |

## Acceptance → check
1. Every function in §01's API exists with that signature → `packages/core/src/buffer/buffer.test.ts`.
2. Splice changes exactly its range over the whole corpus → `pnpm gate:fidelity`.
3. No file outside `packages/core/src/buffer/`, `packages/core/src/index.ts`, `packages/core/scripts/fidelity.ts` and `CHANGELOG.md` changed → story boundary.

## Do not
Normalise anything in `createBuffer`. Add a DOM or Node built-in to `src/`. Implement `save` (MARXY-49). Touch `packages/core/src/contracts/`.
