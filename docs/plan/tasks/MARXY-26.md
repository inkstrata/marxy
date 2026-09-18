---
key: MARXY-26
design: [02-render, 06-shell, 09-app-shell]
depends: [MARXY-61, MARXY-75, MARXY-95]
verify: [pnpm precheck, pnpm done MARXY-26]
---
# MARXY-26 — Images with reserved dimensions; remote images blocked with a notice

**Design:** [02-render](../../design/02-render.md) post-passes 3–4, [06-shell](../../design/06-shell.md) §Asset scoping, [09-app-shell](../../design/09-app-shell.md) §Notices · **Depends on:** MARXY-61, MARXY-75.

## Do this, in order
1. Rust: `image_size(path)` with the `imagesize` crate (MIT); `allow_asset_scope(dir)` (ADR-0026) calling `asset_protocol_scope().allow_directory(dir, true)`; `assetProtocol.enable = true` in `tauri.conf.json` with an empty static scope. (Superseded: `fs::allow_document_dir` as a side effect of `read_file` — §06 now uses the explicit command.)
2. `src/shell/tauri.ts`: `imageSize`, `allowAssetScope`, `assetUrl = convertFileSrc` — names and signatures exactly as ADR-0026.
3. `apps/desktop/src/render/images.ts`: resolve `src` against the **image root** (§02 post-pass 3, ADR-0027 §5: repository root from `detectIndexRoot`, else `dirname(path)`; `/x.png` against the image root, relative paths against the document's directory); refuse anything whose normalised path leaves the image root; `allowAssetScope(imageRoot)` once per root; set `width`/`height` (scaled to the measure if wider), then `src`. Skip `img[data-marxy-remote]` (no `src`; MARXY-44 and MARXY-97 own them).
4. `apps/desktop/src/notices/index.ts`: the notices region API `notify({ kind, text, actions?, transient? })`; `apps/desktop/src/notices/blocked.ts`: the blocked-content notice from `removed` (hosts deduplicated from `removed[].url` once MARXY-96 lands, else from the `value` field; no allow action yet — MARXY-44 adds it).
5. CSP: add `asset: http://asset.localhost` to `img-src` (§06).

## Tests
Playwright (headless render entry with the stub shell for layout; app harness for the notice): CLS = 0 while images decode on `02-readme-real-world.md`; a remote image renders alt text and one notice naming `img.shields.io` once; a `../../etc/x.png` reference is refused; in a fixture repository, `/assets/logo.png` from `docs/README.md` resolves to `<repo>/assets/logo.png`. Rust: `image_size` on a corpus PNG.
