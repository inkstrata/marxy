# Plan delta — 2026-09-22 broad review (Phase 2 is done on the board and absent from the app)

> Author-requested broad review, not a `planner-trigger.mjs` pass. Ran in
> `../marxy-wt/plan-2026-09-22-review`, cut from `origin/main` at `3f76e53` (MARXY-188, #181).
> The orchestrator checkout `/Users/ian/Dev/marxy` was read and never checked out, reset,
> written or cycled; `orchestration/state.json` was read, never written. MARXY-42 and MARXY-94
> were live in their worktrees throughout and were not touched. New rows carry `MARXY-NEW-`
> placeholders; `jira.mjs sync` assigns keys when this lands. Landing key **MARXY-189**, a bare
> out-of-plan Task with no CSV row (the MARXY-187 shape).

## The one finding that matters

**Three Phase 2 stories are Done on the board, and a reader launching Marxy gets none of them.**
Each shipped a tested module and stopped at the edge of its listed paths, the PR said so in
good faith, and no story was ever written to cross the edge.

| Story | Board | What exists | What the running app does |
| --- | --- | --- | --- |
| MARXY-34 live-reload | done (#24) | `src-tauri/src/watch/` (snapshot diff, 333 lines), `shell.watch` client, `core/position/reload.ts` | `watch_root` and `unwatch_root` in `main.rs` are `Ok(())` no-ops ("Phase 0 placeholder until MARXY-34"); `app.ts` never calls `shell.watch`. An agent rewriting the open file changes nothing on screen. |
| MARXY-35 index | done | `core/index-model/` (walk, ignore, deny, ceiling, persist) and a second walker in `src-tauri/src/index/` | Neither is called. `palette.setIndexEntries` has no caller, so the palette searches an empty index forever. `idle-work.ts` `loadIndexMruPins` is `await Promise.resolve()` "until MARXY-34/MARXY-38 wire the real index". |
| MARXY-38 reading position | done (#141) | `core/position/persistence.ts` (`positions.json`, debounce, LRU) | Nothing constructs `PositionPersistence`. Position survives a mode toggle in memory and is lost on quit. |

MARXY-34's own PR body is the root cause, verbatim in intent: `main.rs` is outside Paths, so the
command is not registered and "lights up when a later story adds the two lines"; `main.ts` is
outside Paths, so the reader "does not yet call reload". Every criterion was machine-checked
without that wiring. The criteria were all module-level. None asked for the behaviour through
`startApp`.

Same shape, found while tracing it:

- **MARXY-87 / ADR-0026** names MARXY-87 as `readDir`'s first caller. MARXY-87 merged without it.
- **MARXY-177** (user theme) reads `config.toml` only `if (shell.configPaths !== undefined)`.
  The Tauri shell does not implement `configPaths`, so the configured theme never loads in the
  shipped app. Theme hot-reload also rides on the no-op `watch_root`.

## Two open paths, and they disagree

`app.ts` opens a document through `openDocumentThroughRenderMark` + `finishDocumentOpen`: the
buffer, the image policy (`stripNonLocalImages`, blocked-content notice), the typesetter, the grid,
highlight, maths, theme notice, Source-mode default. **The palette has its own `renderPath`** in
`palette/view.ts` that does `parseMarkdown` → `renderDocumentSafeHtml` → `article.innerHTML = html`
and nothing else. After a palette open:

- `documentBuffer` and `openPath` in `app.ts` still name the *previous* document, so **Mod+E shows
  the previous document's source**, and leaving Source mode commits the previous buffer.
- No typesetter, no grid pass, no images, highlight or maths — the page a reader flips to is the
  unstyled Phase 0 render.
- `stripNonLocalImages` and the blocked notice do not run (core still defers remote images, so this
  is defence-in-depth lost, not a live network leak).

The `onOpenFiles` route (MARXY-183) does use `app.ts`, but each call attaches a new
`TypesetController` without `destroy()`ing the last and adds another `ResizeObserver` to `#doc`.
Its error path writes `` `<p>${String(e)}</p>` `` through `innerHTML`; `read_file`'s error embeds
the path, so a file name becomes markup. CSP `script-src 'self'` stops script, not markup.

## Stories added

| Placeholder | Phase | Depends on | Why this order |
| --- | --- | --- | --- |
| `MARXY-NEW-one-open-path` | 2 | — (overlaps MARXY-42 on `palette/view.ts`; `ready.mjs` sequences it) | Every story below wires into the open path; it must be one path first. Also fixes the leak and the error-path markup. |
| `MARXY-NEW-live-reload` | 2 | one-open-path | Register the watcher, reload in place. The interaction agent artifacts need most (brief: content priority #2). |
| `MARXY-NEW-palette-index` | 2 | one-open-path, MARXY-94 | `readDir` (ADR-0026) → `index-model` → `setIndexEntries`. Without it the palette — ADR-0011's whole answer to "no tabs" — is an MRU list. |
| `MARXY-NEW-persist-reading` | 2 | one-open-path, MARXY-94 | `configPaths` in the Tauri shell; `positions.json` and `history.json` (§11) written and read; lights up MARXY-177's theme config as a side effect. |
| `MARXY-NEW-deferral-gate` | ops | — | So this cannot recur: a deferral comment in product code must name a board key that has not already merged. |

**Placement is a choice, and it costs throughput.** Putting four rows in Phase 2 means
`earlierPhaseOpen` holds every Phase 3 story (43, 44, 45, 48, 49, 97, 184) until they land. Today
nothing in Phase 3 is ready anyway (all wait on 42 or 94), so nothing is held *now*; after 42 merges,
MARXY-43 will wait. The alternative is Phase 3 placement or a `cross-phase` label. Phase 2 is chosen
because it is true: taste review #2 (MARXY-39, done) judged a palette with nothing in it, and the
brief's first sentence is "opens a document instantly, gives you an index you can flip through".
The author may overrule by editing four `deps.json` phase entries.

The four product stories all touch `app.ts`, and three touch `src-tauri/src/main.rs`. They run
one after another by path overlap. That is the correct cost of an integration seam.

## One gate fix carried by this PR

`scripts/check-cards.mjs` read a card's `depends:` with `/MARXY-\d+/`, which drops `MARXY-NEW-`
placeholders. `deps.json` keeps them, so a new story that depends on another new story failed
"card depends ≠ deps.json" on every planner PR, even though `prompts/planner.md` requires
placeholders. Fixed to `MARXY-(?:\d+|NEW-[a-z0-9-]+)`, with a test case in `check-cards.test.mjs`.

## Findings recorded, no new story (salvage instead)

1. **A stranded planning pass already diagnosed the board-report bugs.**
   `/Users/ian/Dev/marxy-planner-integrity` (branch `plan/2026-09-20-board-integrity`, base `ca00050`,
   30+ commits behind, all uncommitted) holds `MARXY-NEW-board-visibility`, which still applies on
   `main`:
   - `cycle.mjs` builds `status.md`'s board from `state.json`, so **MARXY-97, 184 and 185 are on no
     heading of `status.md`** even though `ready.mjs`, which reads the CSV, lists them.
   - `earlierPhaseOpen` ignores the `dropped` label.
   It also holds **ADR-0033 "one index, in core"** (proposed), which decides whether
   `src-tauri/src/index/mod.rs` is deleted. `MARXY-NEW-palette-index` is written so it neither
   deletes nor wires that module and does not depend on ADR-0033. Nothing here re-files that
   work; the author decides whether that worktree is rebased and landed or discarded.
2. **Two more stale worktrees hold uncommitted tooling.** `../marxy-wt/friction` (base #77:
   `merge-bar`, `check-pr`, `precheck`, a `main-red.yml` workflow, a pre-push hook) and
   `../marxy-wt/train` (base #57: `babysit`, `couples`, `train`, two new agent roles). Both predate
   most of the ops lane and will conflict. The cycle keeps them forever as "uncommitted work". They
   need a land-or-discard ruling from the author, not a story.
3. **MARXY-78** is `blocked` at attempts 2, parked since 2026-09-20 for paths, not failure, with WIP
   (`gate-fidelity.mjs`, corpus 20/21, goldens) uncommitted in its worktree. Under the planner rule
   it is a split candidate. Not split here: the parking reason (MARXY-138's paths) has cleared, and
   the right next step is one un-parked attempt on the existing WIP, then a split if it fails.
4. `app.ts` exposes `dispatch() {}` and `commands() { return []; }` on `AppHandle`. MARXY-42 (live)
   adds `apps/desktop/src/commands/`; whether it fills these is its business. Noted, not filed.

## Escalation risk

- **`MARXY-NEW-one-open-path`**: a mechanism no prior story touched (the app's open lifecycle), and
  it lands right behind MARXY-42's edit of the same file. Most likely to need a second attempt.
- **`MARXY-NEW-live-reload`**: Rust watcher lifetime across open events, plus the rule never to
  replace a buffer the reader changed in Source mode. The criteria are exact; the Rust side is new
  ground for Composer.
- **`MARXY-NEW-deferral-gate`**: starts red over today's tree by design, so it ships with an
  allow-list that may only shrink. An implementor tempted to widen the pattern until nothing matches
  will pass the tests and defeat the gate. The mutation criteria are what stop that.

## Tripwires

`docs/roadmap.md` ops-majority: of 77 commits on `main` since 2026-09-19, 10 are `chore(plan)`,
18 `orchestration` and 11 `gates`, so 39 are ops. That is about half: lower than the 8-of-10
that fired on 2026-09-20, but not yet a product majority. One of the five rows added here is ops,
and four are the product work the ops lane's successes had been hiding.

## Summary for the orchestrator

1. Five new rows: four Phase 2 product stories and one ops gate. All have cards and `deps.json` entries.
2. Nothing is dispatchable until MARXY-42 (path overlap) and MARXY-94 (deps) land. No change to anything in flight.
3. Dispatch order after that: one-open-path → live-reload → persist-reading → palette-index (all serial on `app.ts`/`main.rs`).
4. deferral-gate is ops-lane, independent, and can dispatch now.
5. Phase 3 is held behind Phase 2 once these are `todo`. That is intended (see "Placement"). The author may overrule it.
6. Needs the author, not a story: land or discard `marxy-planner-integrity` (board-visibility + ADR-0033), `friction`, `train`.
7. MARXY-78: un-park for one attempt on its existing WIP before splitting.
8. MARXY-86/87/34/35/38/177 stay Done. The work they left is in the new rows, not re-opened.
9. After merge, `jira.mjs sync` assigns keys. Rename the `MARXY-NEW-*` card files and `deps.json` entries to match.
10. Taste review #2 judged a palette with an empty index; queue a re-review once `palette-index` lands.
