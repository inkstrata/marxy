# Driving Marxy headless: the harness map (from the 2026-10-11 survey, main 7b543931)

- Full-app harness (with palette, menu hooks, panes): serve `apps/desktop/app.html` via Vite dev server
  (`apps/desktop/test/support/two-pane.mjs`: `harnessBase()`, `shippedSkeleton()`), then in the page
  `import('/src/main.ts').bootApplication(createMemoryShell(bytes), {argv:[path]})`; set `window.__marxyHandle = handle`;
  `handle.palette.setIndexEntries([...])` to give the palette documents. Template: survey/s2.mjs (boot block) and
  apps/desktop/test/open-beside.test.mjs. `bootTwoPanes` uses `startApp` (no palette; handle.palette undefined).
- gate.html + `pnpm --filter @marxy/desktop build:harness` (2.6 s) is the aesthetics gate's render-only entry
  (`window.marxyGate.render`), not a driver: no palette, one render per page. Use for layout, not behaviour.
- Playwright: `scripts/playwright-webkit.mjs` `launchWebkit()`. Import with absolute paths from a scratch script.
  Mac modifier is `Meta`. Hooks: `handle.open(path)`, `handle.panes()`, `handle.shell.calls` (memory shell call log),
  `import('/src/commands/index.ts').commands()` lists the 110 registry commands.
- Files in memory shell: `/config` is config.toml; `/data/*` is Marxy's data dir (kinds.json, layout.json, positions.json).
- Entry points: apps/desktop/src/{main.ts,app.ts}; commands/ (registry, one file per feature); palette/view.ts (keys: Mod+P
  only, `>` commands, `/` content); pane/keys.ts (Mod+\, Mod+Shift+\, Mod+1/2, Alt+arrows); selection/{verbs,verb-menu}.ts
  (right-click verb menu); src-tauri/src/main.rs `app_menu::MENU` (native menu: Quit, Open File, Close, Edit, Toggle
  Rendered/Source, Back, Forward, Open Quickly); packages/core/src/{kind,transforms,operations,index-model,paste}.
- Gotchas: `Use light variant` via palette did not change `data-marxy-variant` in the memory shell (unverified cause,
  probably config write not echoed by the memory watch). Palette fuzzy-matches titles, so `>kind` matches nothing
  ("Show this file as..."). Alt+ArrowDown selection state reads null from `marxySelection` but right-click works.
  `gate:fidelity` is core-only (1.3 s). Do not trust docs/machine.md. No GUI needed anywhere above.
