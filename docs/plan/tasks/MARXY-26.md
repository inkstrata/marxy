# MARXY-26 — Images with reserved dimensions; remote images blocked with a notice

**Design:** [02-render](../../design/02-render.md) post-passes 3–4, [06-shell](../../design/06-shell.md) §Asset scoping, [09-app-shell](../../design/09-app-shell.md) §Notices · **Depends on:** MARXY-61, MARXY-75.

## Do this, in order
1. Rust: `image_size(path)` with the `imagesize` crate (MIT); `fs::allow_document_dir(app, dir)` called from `read_file` when invoked with `{ scope: 'document' }`; `assetProtocol.enable = true` in `tauri.conf.json` with an empty static scope.
2. `src/shell/tauri.ts`: `imageSize`, `assetUrl = convertFileSrc`.
3. `apps/desktop/src/render/images.ts`: resolve `src` against `dirname(path)`; refuse anything whose canonical path leaves that directory; set `width`/`height` (scaled to the measure if wider), then `src`.
4. `apps/desktop/src/notices.ts`: the notices region API `notify({ kind, text, actions?, transient? })`; the blocked-content notice from `removed` (hosts deduplicated; the allow action is a disabled placeholder until MARXY-44).
5. CSP: add `asset: http://asset.localhost` to `img-src` (§06).

## Tests
Playwright (headless entry with the stub shell): CLS = 0 while images decode on `02-readme-real-world.md`; a remote image renders alt text and one notice naming `img.shields.io` once; a `../../etc/x.png` reference is refused. Rust: `image_size` on a corpus PNG.
