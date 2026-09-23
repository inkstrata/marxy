# ADR-0026 — The shell-api surface for v1, amended once

**Status:** accepted 2026-09-22 (MARXY-94) · **Source:** design pass 2026-09-18 (Phase 3 runway); ADR-0010, ADR-0020

## Context

`packages/shell-api` is frozen (ADR-0010): switching shells means reimplementing that one
interface. The design set (`docs/design/06-shell.md`) was written as though the interface
already held every command v1 needs. It does not. On `main` the frozen `Shell` lacks
`imageSize`, `openExternal`, `webkitVersion`, `configPaths`, a window title, a save dialog,
asset scoping and the startup plumbing (`args`, `mark`, `quit`). Stories have started to route
around this: `apps/desktop/src/shell/tauri.ts` exports `Pick<Shell, …> & { args; mark; quit }`,
and MARXY-34 adds `watch` plumbing the same way. Each workaround is small; together they turn
the frozen contract into a floor that the real app no longer matches. The second shell the
contract exists for would have to read `tauri.ts` to find out what to implement.

The interface also names two members nothing uses. MARXY-35 built the index in `packages/core`
(`index-model`, a TypeScript walker behind a `DirectoryReader`) and the palette ranks in the app
(MARXY-86), so `listRoot` and `fuzzy` describe a Rust index that was never built.

## Decision

1. **Amend `Shell` once, for all of v1, in one PR that touches only
   `packages/shell-api/src/index.ts`** (the contracts rule in `AGENTS.md`). After it lands the
   interface is frozen again and every later addition needs its own ADR.
2. Added members, with the story that first calls each:

   | Member | Signature | First caller |
   | --- | --- | --- |
   | `args` | `(): Promise<readonly string[]>` | done (MARXY-13) |
   | `mark` | `(name: string, t: number, data?: string): Promise<void>` | done (MARXY-13) |
   | `quit` | `(code?: number): Promise<void>` | done (MARXY-13) |
   | `readDir` | `(dir: string): Promise<readonly FileStat[]>` | MARXY-87 — the `DirectoryReader` behind MARXY-35's `collectFiles`; one level, no recursion, deny list applied in Rust |
   | `setTitle` | `(title: string): Promise<void>` | MARXY-49 |
   | `imageSize` | `(path: string): Promise<{ width: number; height: number } \| null>` | MARXY-26 |
   | `openExternal` | `(url: string): Promise<void>` — rejects any scheme but `http`, `https`, `mailto` with `code: 'unsupported'` | MARXY-61 |
   | `webkitVersion` | `(): Promise<{ major: number; minor: number; micro: number } \| null>` — `null` off Linux | MARXY-21 |
   | `configPaths` | `(): Promise<{ config: string; data: string }>` | MARXY-38 |
   | `allowAssetScope` | `(dir: string): Promise<void>` — adds a recursive asset-protocol scope for this session only | MARXY-26, MARXY-47 |
   | `saveDialog` | `(opts: { defaultPath?: string }): Promise<string \| null>` | MARXY-49 |
   | `fetchRemoteImage` | `(url: string): Promise<string>` — ADR-0027 | MARXY-97 |

3. `listRoot` and `fuzzy` are **deprecated in place** (kept, JSDoc `@deprecated` naming this
   ADR) rather than removed, so the amendment is purely additive and no caller breaks. The
   Tauri implementation may throw `unsupported` for both.
4. `ShellError` is exported from the interface module as the design states it:
   `{ code: 'not-found' | 'permission' | 'io' | 'invalid' | 'unsupported'; message: string; path?: string }`.
5. Until the amendment merges, a story that needs one of these members adds it to the object
   exported from `apps/desktop/src/shell/tauri.ts` **under exactly the name and signature in the
   table**, so the amendment is a type change with no call-site edits.

## Consequences

- One contract PR instead of one per story; the contract describes the app that exists.
- A second shell (a hypothetical Electron or native one) has a complete list to implement.
- `docs/design/06-shell.md` §Commands is the Rust side of this table and is corrected in the
  same design pass; the `listRoot`/`fuzzy`/`index*` rows there become historical.

## Rejected

- **Amend per story.** Seven contract PRs, each blocking a product story on a code-owner review.
- **Leave the contract as a floor and let `tauri.ts` be the real surface.** Then the contract is
  documentation, and it will be wrong the first time someone reads it.
- **Remove `listRoot` and `fuzzy`.** A breaking change to a frozen contract for no reader-visible
  gain; deprecation costs nothing.
