---
key: MARXY-26
design: [02-render]
depends: [MARXY-61, MARXY-75]
verify: [pnpm precheck, pnpm done MARXY-26]
---
# MARXY-26 — Resolve an image source against the image root and report the hosts that were blocked (core)

**Design:** [02-render](../../design/02-render.md) post-pass 3 (the resolution rule only) · **Depends on:** MARXY-61, MARXY-75 · **ADRs:** ADR-0020 (core is shell-free), ADR-0027 §5.

**Outcome.** `packages/core/src/render/images.ts` gives the app everything it needs to put an image on
the page and to tell the reader which hosts were refused, and nothing in `packages/core` touches a DOM,
a shell or a network. **A reader sees nothing change in this story.** The app half — the Rust commands,
the asset scope, the reserved box on a real `<img>` and the notice — is `MARXY-138`,
and it is the story where a reader sees something.

**Rewritten 2026-09-19** (`docs/plan/deltas/2026-09-19-marxy-26-split.md`) after PR #95 escalated on
attempt 1. The old row asked for an inline notice, zero CLS across decode and a local image resolving
through `shell.assetUrl`, and listed paths in which none of the three can be built. Read the delta before
you start.

## Where to start
PR #95 at `89709c8` is the tree, not a draft to rewrite:

- **Keep** `packages/core/src/render/images.ts` as it stands. `resolveImageSrc` implements ADR-0027 §5
  correctly, `collapsePath` returns `null` rather than a string when `..` escapes, the header readers are
  allocation-free, and hosts are derived through the sanitiser's own `sanitizeUrl` so the notice text and
  the removal report cannot disagree. Do not re-derive a host with a second URL parser.
- **Keep** the `RenderResult.blockedImages` addition in `packages/core/src/render/{index,pipeline}.ts`.
- **Revert** the `apps/desktop/src/shell/tauri.ts` and `apps/desktop/src/shell/memory.ts` hunks. They are
  outside this story's paths now. The shape you wrote is the intended shape and the other story re-lands
  it wired to real Rust commands; nothing is wasted, but it must not reach `main` before the commands
  exist, because `allowAssetScope` invokes a command that is not registered and `assetUrl` throws until
  it succeeds.
- **Replace** `packages/core/src/render/images.test.ts`. Three of its checks cannot fail: the
  `readFileSync` of `tauri.ts` asserting member names appear in it, the `order` array that can only ever
  receive one entry, and the four-`<img>`-with-no-`src` assertion that holds on `main` with the diff
  removed.

## Files and signatures
- `packages/core/src/render/images.ts` — unchanged exports: `BlockedImage`, `ImageSize`,
  `ImageResolution`, `hostOfRefusedSrc`, `blockedImagesFrom`, `blockedHosts`, `blockedImageNoticeText`,
  `collapsePath`, `isInsideImageRoot`, `resolveImageSrc`, `reserveImageBox`, `ImagePresentation`,
  `presentLocalImage`, `imageSizeFromBytes`.
- `packages/core/src/render/images.test.ts` — rewritten; every case named after the criterion it checks.
- `packages/core/src/render/index.ts`, `pipeline.ts` — `blockedImages` on `RenderResult`, as in #95.

`imageSizeFromBytes` stays exported and stays pure: it is what the memory shell and these tests use so a
test never needs Rust. The **shipping** shell reads headers in Rust with the `imagesize` crate (MIT), per
`docs/design/06-shell.md`; that decision is recorded in the delta and the other story writes the sentence
into §06. Do not delete `imageSizeFromBytes` and do not make it the shipping path.

## Do this, in order
1. Revert the two `apps/desktop/src/shell/` files. Confirm the branch's three-dot diff touches nothing
   under `apps/`.
2. Rewrite `images.test.ts` against the acceptance table below. Every case renders through the real
   pipeline where a document is involved, so a golden and a test cannot drift.
3. For criterion 6, add the case that reads this story's own test file and asserts it contains no
   `readFileSync` of a path under `apps/` and no assertion over another package's source text. It is two
   lines and it is the reason this story escalated.
4. `pnpm precheck`, then `pnpm done MARXY-26`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `blockedImagesFrom` over rendered `10-hostile.md` | two entries in document order, both `example.invalid`; `blockedHosts` length 1; the `data:` image contributes none |
| `resolveImageSrc('/assets/logo.png', 'docs/README.md', root)` | `<root>/assets/logo.png` |
| `resolveImageSrc('image.png', '09-gfm-everything.md', root)` | resolves against the **document's** directory, not the root |
| `resolveImageSrc('../../etc/x.png', 'docs/README.md', root)` | a refusal carrying the reason; never a string path |
| `resolveImageSrc` with a drive letter, and with `..` at the root | refused; `collapsePath` returns `null` |
| `reserveImageBox({1200,400}, 640)` | width 640, height scaled from the ratio; the rounding rule is written into the assertion |
| `reserveImageBox` with a zero or negative width, height or measure | the input returned untouched |
| `presentLocalImage` with an `assetUrl` that throws | not called for `../../etc/x.png`, not called for `https://…`, called exactly once for a resolvable local source |
| the same, with a recorder | the reserve event precedes the single `assetUrl` call |
| `blockedImageNoticeText([])` | `''` |
| `blockedImageNoticeText` with two images on one host | one line, the host once, with a count |
| rendered `10-hostile.md` HTML | contains no host string anywhere — the goldens' rule, asserted here too |
| `imageSizeFromBytes` | PNG, GIF, JPEG, WebP dimensions; `null` for a truncated header and for a non-image |
| the test file itself | no `readFileSync` under `apps/`, no assertion over a source string |
| `packages/core/goldens` | diff empty: no rendered byte changes in this story |

## Acceptance → check
1. Hosts in document order, each named once → `blockedImagesFrom` / `blockedHosts` cases.
2. Image-root resolution and refusal → `resolveImageSrc` cases.
3. The reserved box and its scaling → `reserveImageBox` cases.
4. The shell is never reached for a refused or remote source, and the box precedes the URL →
   `presentLocalImage` cases with a throwing `assetUrl` and a recorder.
5. Notice text is data, not markup → `blockedImageNoticeText` cases plus the no-host-in-HTML case.
6. No test asserts a member name in another package's source and none reads a file under `apps/` → the
   self-check case.
7. `imageSizeFromBytes` per format → four cases plus two negatives.
8. `pnpm precheck` green, goldens unchanged, `CHANGELOG.md` line → story boundary and `pnpm done`.

## Do not
Touch anything under `apps/`. Touch `packages/core/src/contracts/` or `packages/shell-api/` (frozen).
Add a dependency. Change a golden. Put a host string into rendered HTML. Write a second URL parser beside
`sanitizeUrl`. Assert that a name appears in a file — if a criterion can only be checked that way, the
criterion belongs in another story, so stop and report blocked.
