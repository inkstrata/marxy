---
key: MARXY-61
design: [02-render, 00-architecture]
depends: [MARXY-12, MARXY-75, MARXY-20, MARXY-26]
verify: [pnpm precheck, pnpm done MARXY-61]
---
# MARXY-61 — The desktop renders through `@marxy/core`; markdown-it and DOMPurify leave the tree

**Design:** [02-render](../../design/02-render.md) (post-passes 1, 2), [00-architecture](../../design/00-architecture.md) (waterfall)
**Depends on:** MARXY-12 merged. **Blocks:** MARXY-75, MARXY-20, MARXY-26..29.

## Outcome
`marxy file.md` shows the document rendered by `renderDocumentSafeHtml`. The bundle no longer contains markdown-it or DOMPurify. Startup marks are unchanged in name and meaning.

## Do this, in order
1. `apps/desktop/src/main.ts`: replace the markdown-it + DOMPurify block with
   `const doc = parseMarkdown(bytes, { file }); const { html, removed } = renderDocumentSafeHtml(doc);`
   from `@marxy/core` (`packages/core/src/index.ts` must export `renderDocumentSafeHtml`, `renderSafeHtml` — add the two exports; that file is in your paths).
2. Keep `parseMarkdown` and `renderDocumentSafeHtml` as two calls (the AST is needed by later stories); store both on a module-level `state` object typed as in §09 `AppState.document` (`nodeMap` and `blocks` may be `null` until MARXY-75).
3. Add `apps/desktop/src/render/post.ts` with `applyLinks(article, shell)`: `a.marxy-external` → `shell.openExternal(href)`; `a[href^="#"]` → scroll to the id (plain `scrollIntoView` for now).
4. Add `openExternal` to `src/shell/tauri.ts` and a Rust command `open_external` in `commands/os.rs` using the `open` crate (MIT), refusing any scheme other than `http`, `https`, `mailto` with `ShellError { code: 'unsupported' }` (§06). Create `commands/mod.rs` and move nothing else yet.
5. Remove `markdown-it`, `dompurify`, `@types/*` for both from `apps/desktop/package.json` and from the root `package.json` if still present; `pnpm install`; confirm `pnpm ls --depth 0` shows neither.
6. Show `removed` as a temporary `console.info` count (the notice UI is MARXY-26).

## Tests
| Test | Where | Expect |
| --- | --- | --- |
| bundle contents | `apps/desktop/test/bundle.test.mjs` | `dist/assets/*.js` contains neither `markdown-it` nor `DOMPurify` strings |
| CLI smoke (exists) | `apps/desktop/scripts/smoke-cli-open.mjs` | still passes; `blocks ≥ 10` for `02-readme-real-world.md` |
| external link | Rust `cargo test` | `open_external("javascript:x")` → `unsupported`; `("https://a")` → ok (mock `open`) |
| shell boundary (exists) | `apps/desktop/test/shell-boundary.test.mjs` | `@tauri-apps` only under `src/shell/` |

## Acceptance → check
1. Bundle free of markdown-it/DOMPurify → `bundle.test.mjs`. 2. Renders through core → smoke check evidence + a grep test that `main.ts` imports `@marxy/core`. 3. `first_text` still emitted after paint → smoke check's frame count assertion.

## Do not
Change `packages/core/src/render/*` or the sanitiser. Add a theme. Touch the CSP.
