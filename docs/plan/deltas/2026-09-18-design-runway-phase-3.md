# Plan delta — 2026-09-18 (design runway, Phases 3–4)

> A **design pass**, not a planner cycle. It continues `2026-09-18-design-runway.md`, which
> covered Phases 1–2. It adds designs §12 (trust) and §13 (release), ADR-0026 and ADR-0027
> (both proposed), task cards for every Phase 3 and Phase 4 story, and five new stories, and
> corrects §00–§03, §05, §06 and §09–§11. No product code. It does **not** edit
> `docs/plan/jira-issues.csv` or `orchestration/deps.json`: the orchestrator owns those, and the
> main checkout holds its uncommitted edits to them. The board edits are listed below, ready to
> apply.

## Why this pass was needed now

Phase 3 had no cards, and reading its stories against the code on `main` turned up ten
problems. Four of them would have stopped an implementor mid-story. The rest would have let an
implementor finish something that contradicted another story.

| # | Finding | What it would have cost | Resolution |
| --- | --- | --- | --- |
| 1 | **Nothing owns the buffer.** §01 says MARXY-14 builds `packages/core/src/buffer/`. MARXY-14 landed the Rust save path and no buffer. MARXY-37's card says "if MARXY-14 did not land them, coordinate by checking the module first". MARXY-34, 37, 41, 42, 43 and 49 all need it. | Two or three agents creating the same files, which is the failure `AGENTS.md` names. | New story **MARXY-93** (Phase 1). Consumers depend on it and never create files there (§01, D-A20). |
| 2 | **The frozen shell-api does not describe the app.** `Shell` lacks `imageSize`, `openExternal`, `webkitVersion`, `configPaths`, `setTitle`, `saveDialog`, asset scoping, `args`/`mark`/`quit`. `tauri.ts` already routes around this with `Pick<Shell,…> & {…}`, and MARXY-34 adds more members the same way. `listRoot` and `fuzzy` describe a Rust index that MARXY-35 built in TypeScript instead. | Seven contract PRs that each need Ian, or a contract that stops meaning anything. | **ADR-0026** (proposed): one additive amendment for all of v1. Story **MARXY-94**. Until it lands, stories add members to `tauri.ts` under the ADR's names. |
| 3 | **The remote-image opt-in contradicts the final CSP.** `docs/scope.md` and ADR-0009 §3 promise a per-document opt-in for remote images. MARXY-45 and §06 promise a CSP with no `http(s)` source. Tauri cannot widen a CSP for one document. | MARXY-45 or MARXY-44 fails its own acceptance, or `https:` goes into the CSP for every document. | **ADR-0027** (proposed). The webview never has network. The sanitiser defers `https:` images to an inert `data-marxy-remote`. The shell fetches only hosts the reader granted for that document, over HTTPS only, with no cookies and no referrer. `http:` images are never loaded. Story **MARXY-97**. |
| 4 | **Two rules for local images.** MARXY-12 left an open question in `document-origin.ts`: the sanitiser keeps `../x` and `/x`, while the gate fails anything outside the document's directory. | MARXY-26 and MARXY-45 each pick a rule, and the two rules differ. | ADR-0027 §5: resolve against the **image root**, which is the repository root, else the document's directory. `/x` is repository-relative, as on GitHub. The shell's asset scope is the same root (§02, §06; MARXY-26's card updated). |
| 5 | **The first runway's dependency edits never reached `deps.json`.** `MARXY-75` is absent from it. `MARXY-20` still depends on `[11, 13]` rather than `[61, 75]`. | `ready.mjs` offers MARXY-20 before provenance exists. | Re-listed below. Apply with the rest. |
| 6 | **MARXY-75's card listed the stories it blocks as its dependencies** (`depends: [12, 61, 20, 23, 38, 41]`). MARXY-20 depends on 75, so that is a cycle. | A dispatcher that reads card frontmatter deadlocks. | Frontmatter fixed (`depends: [12, 61]`, `blocks: [20, 23, 38, 41]`). |
| 7 | **`Alt+←` has two meanings.** §09 uses it to select the parent block; MARXY-86's `keys.ts` uses it for history back. | Whichever story lands second breaks the other. | History keeps `Alt+←/→`; selecting the parent becomes `Alt+Shift+↑` (D-A27). |
| 8 | **No browser harness can drive the app.** §10 says browser tests use the render entry, never `main.ts`. MARXY-87's card tests "Boot `main.ts`". Every Phase 3 behaviour (palette, notices, operations, save, find, themes) needs the real app code in a browser. | Each story invents its own harness, or tests stop being real. | §10 **app harness entry**: `main.ts` becomes `startApp(tauriShell)`, and tests call `startApp(memoryShell)` from `dist/app.html`. Story **MARXY-95** (Phase 2, before MARXY-87). |
| 9 | **MARXY-41's acceptance cannot be met honestly.** "span … selections resolve to ranges whose bytes match the selected text" fails because smart typography and soft hyphens make the painted text differ from the source. | The story fails review, or the property gets weakened until it passes. | §03 states the property over node, section and document selections. A dragged text selection stays copy-only (as D-A2 already said). The CSV edit is below. |
| 10 | **MARXY-44 held a security-bearing core change and an app feature in one story** of roughly 900 lines. | Review throughput (see the review-throughput delta), and the security half gets reviewed alongside UI. | Split: **MARXY-96** (core: wide policy, reserved `marxy-` ids, deferral, located removals), then MARXY-44 (grants, notice, persistence, revoke). |

Smaller corrections made in the designs: a link click follows the link and `Alt+click` selects
it (D-A28). Closing with unsaved changes shows a notice, not a modal (D-A29). Find folds smart
typography on the query side (D-A30). The external editor runs from a whitespace-split template,
never through a shell (D-A31). A user theme applies after first text, and "Use this theme"
writes one config line (D-A32). About is a bundled read-only document (D-A33). The Flatpak has
no network permission (D-A34). §06's Rust-index rows are marked historical. §01's API gains
`eolString` and `lineOf`. The command registry (§03, D-A26) is the one list that both the palette
and the keyboard map read.

## Decisions Ian may want to overrule

Each is written into a design and can be reversed there. They are listed because each one
changes what a reader experiences:

1. **`http:` images are never loaded, even after consent** (ADR-0027 §3). A few old READMEs
   lose images for good.
2. **The Flatpak ships with no network permission** (§13). Badges in a Flatpak marxy need a
   `flatpak override`, and the notice says how.
3. **Closing with unsaved changes stops the reader once, with a notice** (§01). This is the only
   interruption in the app. It is queued for taste review #3.
4. **Grants are per path, with no global "always allow"** (§12). This is safer, and it means one
   click per README.

ADR-0026 and ADR-0027 are *proposed*. ADR-0026 lands through a contracts-path PR. Since ADR-0028
(merged after this pass was written) that path merges on a signed review, with a non-blocking
flag to Ian. ADR-0028 also puts the sanitiser, `tauri.conf.json` and `capabilities/` **on**
CODEOWNERS, so MARXY-42 (capabilities), MARXY-45, MARXY-52, MARXY-96 and MARXY-97 each need
Ian's review. ADR-0027 is accepted by the two stories that implement it.

## New stories (applied and synced 2026-09-18: MARXY-93 … MARXY-97)

| Placeholder | Phase | Labels | Summary | Paths | Acceptance |
| --- | --- | --- | --- | --- | --- |
| MARXY-93 | 1 | `phase-1,agent-loop` | The document buffer: bytes, splice, undo, line endings | `packages/core/src/buffer, packages/core/src/index.ts, packages/core/scripts/fidelity.ts` | Every §01 API function exists with its signature (`buffer.test.ts`); splice changes exactly its range over the whole corpus (`pnpm gate:fidelity`, shown failing once with `splice` neutralised); `contentHash('')` is `cbf29ce484222325`. |
| MARXY-94 | 1 | `phase-1,contracts,human-gated` | Amend the frozen shell-api once for all of v1 (ADR-0026) | `packages/shell-api/src/index.ts, docs/adr/0026-shell-api-v1-surface.md, docs/adr/README.md` | The interface lists every ADR-0026 §2 member (a type test: a literal implementing all members compiles, one missing `fetchRemoteImage` is a `@ts-expect-error`); `listRoot`/`fuzzy` deprecated; no other file changed; ADR-0026 accepted. |
| MARXY-95 | 2 | `phase-2,agent-loop` | Split startup into startApp(shell) and drive it in a browser with a memory shell | `apps/desktop/src/app.ts, apps/desktop/src/main.ts, apps/desktop/src/shell/memory.ts, apps/desktop/src/harness, apps/desktop/app.html, apps/desktop/vite.config.ts, apps/desktop/test/app-harness.test.mjs, apps/desktop/test/shell-boundary.test.mjs, scripts/gate-bundle.mjs` | `main.ts` only calls `startApp` (≤ 30 lines); `app-harness.test.mjs` boots the real app on a memory shell and sees the heading with one `readFile` recorded; the production bundle does not contain `createMemoryShell` (bundle gate); startup smoke check unchanged. |
| MARXY-96 | 3 | `phase-3,agent-loop,security` | The wide allow-list, reserved ids, deferred remote images and located removals (core) | `packages/core/src/sanitize, packages/core/src/render/pipeline.ts, packages/core/goldens, scripts/gate-no-network.mjs` | `WIDE_POLICY` admits exactly the §12 table and has the same `urlSchemes` (`policy.test.ts`); every vector passes under both policies; `javascript:` inside `<details>` stripped; island `marxy-` ids refused; `https:` images become `data-marxy-remote` with no `src`, and the removal carries the full URL; island removals carry `src`; `gate:no-network` green under both policies. |
| MARXY-97 | 3 | `phase-3,agent-loop,security` | Load images from hosts a reader allowed, through the shell, never from the webview (ADR-0027) | `apps/desktop/src-tauri/src, apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock, apps/desktop/src-tauri/tauri.conf.json, apps/desktop/src/shell/tauri.ts, apps/desktop/src/render/remote-images.ts, apps/desktop/test/remote-images.test.mjs` | Each ADR-0027 §3 property has a Rust test (http refused, no cookie/referer/origin, cross-host redirect refused, size/type limits); on a granted host the page's images get `src` from the shell, other hosts are untouched, and the page makes zero requests (harness with the no-network hook); the CSP still has no `http(s)` source (`check-csp`). |

## Edits to existing rows

| Key | Field | Change |
| --- | --- | --- |
| MARXY-41 | Acceptance | Replace "Span, block, section and document selections resolve to ranges whose bytes match the selected text (property test over the corpus)" with "Node, section and document selections resolve to their node's byte range; re-parsing the range alone yields a node of the same type (Playwright property over every provenance-carrying element of every corpus document); a dragged text selection never resolves (`kind === 'text'`)". Keep "selection survives re-render". |
| MARXY-41 | Paths | `packages/core/src/sourcemap, packages/core/src/index.ts, apps/desktop/src/selection, apps/desktop/test/selection.test.mjs` |
| MARXY-42 | Paths | `packages/core/src/operations, apps/desktop/src/commands, apps/desktop/src/selection/apply.ts, apps/desktop/src/selection/view.ts, apps/desktop/src/palette/view.ts, apps/desktop/src-tauri/src, apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock, apps/desktop/src-tauri/capabilities, apps/desktop/src/shell/tauri.ts, apps/desktop/test/operations-copy.test.mjs` |
| MARXY-43 | Paths | `packages/core/src/operations, packages/core/scripts/fidelity.ts, apps/desktop/src/render/tasks.ts, apps/desktop/src/commands/document.ts, apps/desktop/src/commands/index.ts, apps/desktop/test/operations-edit.test.mjs` |
| MARXY-44 | Paths | `apps/desktop/src/trust, apps/desktop/src/notices, apps/desktop/src/commands/trust.ts, apps/desktop/src/commands/index.ts, apps/desktop/src/app.ts, fixtures/corpus/15-unclosed-script.md, packages/core/goldens, apps/desktop/test/trust.test.mjs` (the sanitiser path moves to MARXY-96) |
| MARXY-45 | Paths | add `scripts/check-csp.mjs, scripts/check-csp.test.mjs, scripts/allowlists/capabilities.json, fixtures/themes/hostile, packages/core/src/sanitize/document-origin.ts` |
| MARXY-47 | Paths | add `packages/theme/src/css-urls.ts, packages/theme/src/config.ts, fixtures/themes/quiet, fixtures/themes/contract-2, apps/desktop/test/user-theme.test.mjs` |
| MARXY-48 | Paths | `apps/desktop/src/outline, apps/desktop/src/find, apps/desktop/src/commands/view.ts, apps/desktop/src/commands/app.ts, apps/desktop/src/commands/index.ts, apps/desktop/src/palette/keys.ts, apps/desktop/src-tauri/src, apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock, apps/desktop/src/shell/tauri.ts, apps/desktop/test/outline-find.test.mjs, apps/desktop/test/keyboard.test.mjs` |
| MARXY-49 | Paths | `apps/desktop/src/shell/save.ts, apps/desktop/src/shell/close.ts, apps/desktop/src/shell/tauri.ts, apps/desktop/src/title.ts, apps/desktop/src/commands/document.ts, apps/desktop/src-tauri/src, apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock, packages/core/scripts/fidelity.ts, apps/desktop/test/save.test.mjs` |
| MARXY-52 | Paths | add `apps/desktop/src-tauri/entitlements.plist, packaging/flatpak, scripts/lib/licences.mjs, scripts/gate-licences.mjs, scripts/notices.mjs, scripts/notices.test.mjs, apps/desktop/src/about, apps/desktop/src/commands/app.ts, README.md, .github/workflows/ci.yml` |
| MARXY-53 | Paths | add `scripts/tighten-budgets.mjs, scripts/tighten-budgets.test.mjs, docs/plan/deltas` |
| MARXY-26 | Paths | `apps/desktop/src/notices.ts` becomes the directory `apps/desktop/src/notices` |
| MARXY-51 | Description | "A container: the planner writes child stories from the queue per `docs/plan/tasks/MARXY-51.md`; no implementor takes it." |

## `deps.json`

Re-apply the first runway's edits, which never landed: `MARXY-61 → [12]`,
`MARXY-75 → [12, 61]`, `MARXY-20 → [61, 75]`, `MARXY-27 → [61, 20]`, `MARXY-28 → [61, 20]`,
`MARXY-29 → [12]`, `MARXY-23 → [19, 20, 21, 64, 75]`, `MARXY-38 → [34]`, `MARXY-34 → [14, 75]`,
`MARXY-33 → [21, 27, 28, 35]`. Add MARXY-75 to phase 1.

This pass:

```
MARXY-93          → [MARXY-11]                                            phase 1
MARXY-94    → []                                                     phase 1
MARXY-95     → [MARXY-61, MARXY-94]                     phase 2
MARXY-87                  → [MARXY-86, MARXY-95]
MARXY-26                  → [MARXY-61, MARXY-75, MARXY-95]
MARXY-37                  → [MARXY-20, MARXY-75, MARXY-93]
MARXY-41                  → [MARXY-75, MARXY-93, MARXY-95]
MARXY-42                  → [MARXY-41, MARXY-87]
MARXY-43                  → [MARXY-42]
MARXY-96     → [MARXY-75]                                            phase 3
MARXY-44                  → [MARXY-96, MARXY-26, MARXY-42, MARXY-38]
MARXY-97   → [MARXY-44, MARXY-94]                     phase 3
MARXY-45                  → [MARXY-97, MARXY-47]
MARXY-47                  → [MARXY-20, MARXY-37, MARXY-38, MARXY-95]
MARXY-48                  → [MARXY-42, MARXY-38, MARXY-23, MARXY-95]
MARXY-49                  → [MARXY-43, MARXY-37, MARXY-34, MARXY-94]
MARXY-52                  → [MARXY-16, MARXY-45]
```

I checked the merged graph (these edges on top of the current `deps.json`) for cycles, and
found none. The longest chain to MARXY-54 is twelve stories, and it runs through
typesetting and the taste reviews, not through Phase 3:
`11 → 12 → 61 → 75 → 20 → 21 → 23 → 25 → 30 → 31 → 51 → 54`. The longest Phase 3 chain,
`61 → 75 → 20 → 37 → 47 → 45 → 52 → 54`, is shorter, so this pass adds no length to the path
to v1.

## Recommended dispatch order for Phase 3

Once its dependencies are done, each of these can start. Stories on the same line have
disjoint paths:

1. MARXY-93, MARXY-94, MARXY-96 (Ian reviews: sanitiser path). None of them waits on
   Phase 3, so they can land early and take pressure off the critical path.
2. MARXY-95, then MARXY-87.
3. MARXY-41, then MARXY-42, then MARXY-43 and MARXY-48 in parallel (their paths meet only at
   `commands/index.ts`, a one-line append, so dispatch them one after the other or let path
   overlap serialise them).
4. MARXY-44, then MARXY-97. MARXY-47 runs in parallel.
5. MARXY-49 once 43, 37 and 34 are done. MARXY-45 last in the phase.

## Tripwires (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms | Unchanged: still Ian's call. Nothing here adds to the startup path. The user theme and `trust.json` were deliberately kept off it (§05, §12). |
| A licence problem in a new dependency | New crates: `ureq` + `rustls` (ADR-0027 names the fallback), `toml`, `tauri-plugin-dialog`, `tauri-plugin-clipboard-manager`. The licence gate decides for each. |
| Machinery outgrowing the product | Of the five new stories, three are product (buffer, wide policy, remote images). One is a contract and one is a test harness that eight product stories need. |

## How we would know I was wrong

1. **ADR-0026 is rejected** and Ian prefers per-story amendments. Then the MARXY-94
   card is dropped, each card that names an ADR-0026 member gains a contract step, and each of those
   stories amends the contract itself.
2. **`ureq`/`rustls` fails the licence gate and `native-tls` also fails.** Then the remote-image
   opt-in cannot ship without a licence exception. The cut in scope order is to drop it from v1:
   MARXY-97 is marked dropped, ADR-0027 §1 stands, and images stay alt text with
   the notice.
3. **The app harness cannot boot `app.ts` without Tauri globals.** That would mean startup code
   still imports `@tauri-apps` outside `src/shell/`, which the boundary test should already
   catch. Fix the leak; do not mock Tauri.
4. **MARXY-48 exceeds 600 lines and splits.** This is expected. The card names the seam.

## Summary for the orchestrator

- **Done 2026-09-18:** the CSV rows and edits and the `deps.json` edges were applied and `jira.mjs sync` run (5 created as MARXY-93–97, 82 updated, 0 failed).
- Dispatch MARXY-93 and MARXY-96 as soon as their dependencies are done.
  Neither blocks anything in flight.
- MARXY-94 amends a frozen contract: flag it in `needs-human.md` (non-blocking since ADR-0028). MARXY-42, 45, 52, 96 and 97 touch CODEOWNERS paths under ADR-0028 and wait for Ian's review.
- MARXY-26 and MARXY-37 cards changed (image root, buffer dependency). Re-read them before
  dispatch.
- MARXY-75's card frontmatter no longer lists the stories it blocks as its dependencies.
- MARXY-51 is a container for the planner, not a dispatchable story.
- Every Phase 3 and Phase 4 story now has a card. Every card points into §01–§13, and no card
  contains a design decision that §01–§13 does not.
