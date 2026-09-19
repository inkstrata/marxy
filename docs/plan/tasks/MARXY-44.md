---
key: MARXY-44
design: [13-trust, 09-app-shell, 11-config-and-storage, 08-position-and-watching]
depends: [MARXY-96, MARXY-26, MARXY-42, MARXY-38]
verify: [pnpm precheck, pnpm done MARXY-44]
---
# MARXY-44 — Per-document opt-in that widens the allow-list, with a discoverable notice

**Design:** [13-trust](../../design/13-trust.md) §The unclosed-element case, §Persistence, §The notice, §Revoking · [09-app-shell](../../design/09-app-shell.md) §Notices · [11-config-and-storage](../../design/11-config-and-storage.md) §Data files · [08-position-and-watching](../../design/08-position-and-watching.md) (re-render keeps position) · **Depends on:** MARXY-96 (core), MARXY-26 (notices region and the blocked-content notice it starts), MARXY-42 (command registry), MARXY-38 (data-file storage helpers) · **ADRs:** ADR-0009, ADR-0027.

**Outcome.** `02-readme-real-world.md` opens with one quiet line saying what was simplified and which image hosts were not contacted. "Show this document's HTML" re-renders it with `<details>`, centred title blocks and sized images, still sanitised, and marxy remembers the choice for that file. A document cut short by an unclosed `<script>` says so instead of looking short. Images from hosts still need their own grant (MARXY-97); this story records host grants in the store and offers the action, but fetching is that story's.

## Files and signatures
- `apps/desktop/src/trust/trust.ts` — `TrustStore` (`loadTrust`, `grantsFor`, `grant`, `revoke`), pure over parsed JSON plus an injected `write(bytes)`; `trust.test.ts`.
- `apps/desktop/src/notices/blocked.ts` — replaces MARXY-26's placeholder action with the §12 table; the Details expansion; the truncation notice (`notices/truncation.ts` if it reads better separately).
- `apps/desktop/src/commands/trust.ts` — `trust.revoke-html`, `trust.revoke-images`; one line in `commands/index.ts`.
- The render path in `apps/desktop/src/app.ts` (or wherever MARXY-26 left the render call) — render with `policyFor(grantsFor(path))`; the first-document-of-launch re-render when `trust.json` arrives late (§12 §Persistence).
- `fixtures/corpus/16-unclosed-script.md` (the next free corpus number; take the next one if 16 is gone by then) — new fixture: three paragraphs, a `<script>` with no end tag at line 5, then 20 lines of prose. Add its AST/HTML goldens.
- `apps/desktop/test/trust.test.mjs` (app harness).

## Do this, in order
1. `TrustStore` + tests (LRU 2,000, punycode host normalisation with `new URL('https://' + host).hostname`, version handling and corruption per §11).
2. The notice: counts, host list (Unicode and punycode when they differ), element names from allow-list removals only; suppress the HTML action when `WIDE_POLICY` would remove every removed element (test with a document whose only removal is `<script>`).
3. Grant HTML → `grant(path, { html: true })` → re-render with position kept → transient summary. Grant images → `grant(path, { imageHosts })` (fetching is the next story; until it lands, the images stay alt text and the summary says "Images will load when marxy can fetch them" — delete that string in MARXY-97).
4. Truncation notice with **Show source** (mode switch at the line via `lineOf`; if MARXY-37 has not landed, the action is omitted and the PR says so).
5. Revoke commands.

## Tests → expected
| Check | Expect |
| --- | --- |
| `trust.test.ts` | LRU, normalisation, new host not granted, corrupt file renamed `.bad-<ts>` |
| `02-readme-real-world.md` default | exactly one blocked-content notice; it names the image hosts and the simplified elements; zero page requests (no-network harness attached) |
| click "Show this document's HTML" | `details`, `div[align=center]`, `img[width]` present; `script` absent; `javascript:` link has no `href`; `trust.json` written with `html: true`; same first visible block before and after |
| restart the harness with that `trust.json` | no HTML action in the notice; wide render |
| `16-unclosed-script.md` | truncation notice names line 5 and the remaining line count; it is not transient |
| only-`<script>` document | no HTML action offered |
| revoke | default render; entry removed from `trust.json` |

## Acceptance → check
CSV row: notice naming what was removed → default case; opting in renders img/details/div align through the sanitiser → grant case; `javascript:` still stripped → grant case + core vector; choice persists per file → restart case; `marxy-` id refused → core story's `reserved-id` vector (cite it); never-closed removal renders a notice → `16-unclosed-script.md` case.

## Do not
Add a global "always trust" switch. Show the HTML action when it would change nothing. Fetch anything. Put trust state in `config.toml`.
