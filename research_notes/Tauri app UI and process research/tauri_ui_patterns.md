# UI/UX Patterns from Real Tauri Apps

Scope note: Every app cited below was checked for genuine Tauri usage (tauri.conf.json,
`@tauri-apps/*` dependency, or an explicit "built with Tauri" statement from the maintainer or
madewithtauri.com/aptakube's own site). Obsidian, Zed, Warp and VS Code are excluded per the
brief (none are Tauri). Some findings are thin because public docs/screenshots don't expose
implementation detail — these are marked as gaps rather than guessed at.

## How do Tauri apps implement custom window chrome / titlebars?

### Takeaway
Tauri's own `decorations: false` + `data-tauri-drag-region` is the baseline mechanism; real apps
either fully replace the frame (cross-platform custom titlebar) or use macOS's
`titleBarStyle: Transparent`/Overlay to keep native traffic lights while drawing their own content
around them. Community plugins (`tauri-plugin-decorum`, `tauri-plugin-frame`) exist specifically
because the raw API leaves gaps (traffic-light inset control, Windows 11 Snap Layout support).

### Cited Findings
- Setting `"decorations": false` in `tauri.conf.json`'s window config removes the native frame entirely; the app must then draw its own titlebar. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- On macOS, `TitleBarStyle::Transparent` (set on the window builder in Rust, `#[cfg(target_os = "macos")]`) hides the titlebar bar while keeping the native traffic-light controls, letting content extend under them. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- Any element with the `data-tauri-drag-region` HTML attribute becomes a draggable region for moving the window, the standard way to make a custom titlebar draggable without native chrome. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- Manual dragging can also be wired via JS: `appWindow.startDragging()` on `mousedown` against a titlebar element. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- Tauri's docs explicitly warn: "using a custom titlebar will also lose some features provided by the system, such as moving or aligning the window" — i.e., snapping/aero-snap-like behaviors are not free once you go custom. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- Required window permissions for a custom titlebar UI: `core:window:allow-close`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-start-dragging`, plus (from a separate discussion) `setDecorations`. — [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/); [Window Customization discussion](https://tauri.by.simon.hyll.nu/backend/window/customization/)
- `tauri-plugin-decorum` (Tauri v2) creates a custom titlebar via a Rust-side helper on the `WebviewWindow`, hides native decorations, and specifically adds a helper to "set a custom inset to the traffic lights" on macOS with precise X/Y offsets — solving the classic misalignment problem between native traffic lights and a custom-drawn titlebar. It exposes CSS class hooks (`.decorum-tb-btn`, `#decorum-tb-minimize`, etc.) so window-control buttons can be restyled while keeping native click/hover behavior, and it preserves Windows Snap Layout even with a custom frame. — [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum)
- `tauri-plugin-frame` is a Windows-specific plugin that replaces the frame with a custom overlay titlebar while explicitly preserving Windows 11 Snap Layout hover-on-maximize behavior, and it auto-injects the needed frontend script so no custom JS is required from the app. — [tauri-plugin-frame](https://github.com/clarifei/tauri-plugin-frame)
- md-reader (a genuinely Tauri-2 markdown reader: "a Rust core for the filesystem, workspace watching, and native menus, and a React + CodeMirror front end") ships Read/Write/Split/Research layout presets switchable from the toolbar or keyboard, plus a dedicated focus mode and "bionic reading" toggle — evidence that reader-focused Tauri apps treat layout density itself as a summonable/dismissable mode, not just the titlebar. — [md-reader](https://github.com/olafkrawczyk/md-reader)

### Inferences
- The two viable chrome strategies for Marxy map directly onto the two Tauri patterns above: (a) full custom titlebar via `decorations:false` + `data-tauri-drag-region`, giving total control but losing native window-snap affordances, or (b) macOS-only `titleBarStyle: Transparent` to keep native traffic lights (satisfying platform feel) while still drawing custom content in the titlebar strip — worth doing per-platform rather than picking one globally, since Windows/Linux don't have an equivalent "keep native, draw around it" option and will need the decorum/frame-style plugin approach instead.
- Marxy's "chrome at rest is zero" goal is a more extreme version of what decorum/frame plugins solve for persistent-but-restyled chrome; Marxy would need the titlebar region to disappear/collapse entirely at rest (not just be restyled), which none of the surveyed plugins do out of the box — this is likely custom work layered on top of `decorations:false`.

### Gaps
- No source documents an app that fully collapses the titlebar to zero height at rest and expands it on hover/hotkey (true "chrome at rest is zero" for the titlebar itself, not just toolbars/sidebars) — none of the fetched sources described this exact interaction for a titlebar specifically.
- Could not verify traffic-light exact pixel insets used by any single named production app (decorum exposes the mechanism but public docs didn't show a specific app's chosen values).

## What command-palette implementations exist in Tauri apps?

### Takeaway
Spacedrive (verified Tauri 2, per its own docs: "Desktop: Tauri 2") ships a Cmd/Ctrl+K command palette for cross-cutting search and actions; the wider React ecosystem's two dominant libraries for this pattern are `cmdk` (primitive, unopinionated, renders the list/results but doesn't own app shortcuts) and `kbar` (built on cmdk, adds virtualization and a fuller "actions" model) — no source confirmed either library specifically inside a named Tauri app, so treat the pairing as ecosystem-plausible, not verified.

### Cited Findings
- Spacedrive's Command Palette opens via **Cmd+K** (macOS) or **Ctrl+K** (Windows/Linux) and is described as letting users "search, navigate, and execute commands without needing to leave your current workflow" — covering files, folders, documents, media, and metadata search, plus actions like adding storage locations or creating tags. — [Spacedrive — Made with Tauri](https://madewithtauri.com/submissions/spacedrive); [Spacedrive GitHub](https://github.com/spacedriveapp/spacedrive)
- Spacedrive's desktop app is confirmed to run on "Tauri 2" per its own architecture docs, with React 19, Vite, TanStack Query, Tailwind CSS v4, and a shared "SpaceUI" component library — i.e. Cmd+K is implemented in a genuinely Tauri-hosted webview, not Electron. — [Spacedrive GitHub](https://github.com/spacedriveapp/spacedrive)
- `cmdk` is the commonly-used React primitive for building a command-palette UI (keyboard-first, accessible); it does not manage an app's other global keyboard shortcuts and is reported to stay smooth only into "the low thousands" of items before needing debouncing/virtualization. — [WebSearch summary of cmdk/kbar ecosystem, no single primary doc]
- `kbar` is built on top of `cmdk` and adds built-in virtualization plus a more complete "actions registry" model (nested commands, keyboard shortcuts tied to actions) — positioned as the more batteries-included option once item counts grow. — [kbar GitHub](https://github.com/timc1/kbar)

### Inferences
- For Marxy's outline + command palette, `kbar`'s actions-registry model (nested commands, virtualized results) is closer to what's needed once the palette also drives document navigation (jump to heading) rather than pure fuzzy file search, where `cmdk`'s minimal primitive would need extra work to avoid perf cliffs.

### Gaps
- Could not fetch Spacedrive's Command Palette guide page directly (404 on `spacedrive.com/docs/product/guides/command-palette`); the summary above is reconstructed from search-result snippets and the madewithtauri/GitHub pages, not a primary doc — flagged as lower-confidence on exact palette behavior (e.g., whether it does fuzzy vs. exact search, whether results are grouped).
- No verified Tauri app was found that publicly documents using `cmdk` or `kbar` by name; this pairing is ecosystem-plausible (both are the standard React choices) but unconfirmed for any specific Tauri codebase in this research pass.

## Are there Tauri apps with a "focus mode" / zero-chrome reading or writing mode?

### Takeaway
Several genuinely-Tauri markdown apps ship an explicit "focus mode" or "zen mode," typically toggled by a keyboard shortcut or toolbar button that hides secondary panes (sidebar, toolbar) rather than the titlebar itself; none of the sources found describe a hover-edge-to-reveal interaction specifically — toggling appears to be the dominant summon/dismiss mechanism in this space, not proximity/hover.

### Cited Findings
- **Paperling** (Tauri + React + TypeScript): described as "a no-setup Markdown reader and editor that opens any .md file and reads it beautifully, with live preview" — positioned explicitly as a minimal, distraction-free reader. — [Paperling GitHub](https://github.com/Razee4315/Paperling)
- **markdown_tauri**: "A focused markdown editor built with Tauri 2.0 - gets out of your way," aimed at users who "value their time and attention." — [markdown_tauri GitHub](https://github.com/prateekjain24/markdown_tauri)
- **CrabPad** (Tauri, Rust backend + React/TypeScript frontend): includes a documented "Zen Mode" feature where UI state must persist across sessions (i.e., re-entering the app remembers whether Zen Mode was on). — [DEV Community: I built a Markdown editor with Tauri](https://dev.to/ukash/i-built-a-markdown-editor-with-tauri-heres-what-i-learned-4f5l)
- **md-reader** (Tauri 2, React + CodeMirror, confirmed via its own README): ships "Read, Write, Split, and Research presets from the toolbar or keyboard," a dedicated focus mode, and a "bionic reading" toggle; mode switches are bound to keyboard shortcuts, e.g. `⌘E` toggles reader/editor and `⌥⌘E` gives a side-by-side split. Themes (Light/Dark/Auto) are described as "applied instantly." — [md-reader GitHub](https://github.com/olafkrawczyk/md-reader)
- **markdown-viewer** (Tauri 2, Rust, Svelte 5, TypeScript, confirmed via README): keyboard interaction is deliberately consistent between panes — "in the file tree, `↑`/`↓` move, `→` expands, `←` collapses, `Home`/`End` jump; the outline uses the same pattern" — and it supports `prefers-reduced-motion` to disable transitions/smooth-scrolling app-wide, plus visible focus rings on every control. Settings (theme, content width, text size) persist in webview local storage, not a cloud account. — [markdown-viewer GitHub](https://github.com/putuandy/markdown-viewer)

### Inferences
- The pattern across every verified reader/editor found is "mode as a named, keyboard-toggled state" (Focus Mode / Zen Mode / Read-Write-Split-Research presets) rather than continuous hover-to-reveal chrome; if Marxy wants hover-edge summon/dismiss specifically, it will be departing from what's documented in this space rather than following precedent — worth flagging as a design choice to validate in taste review rather than assuming prior art supports it.
- Persisting the last-used mode/state (CrabPad's Zen Mode persistence, markdown-viewer's local-storage settings) is a small but consistent expectation: reopening the app should not silently reset a reader's chosen density/mode.

### Gaps
- No fetched source gave frame-by-frame detail on the *animation* used when toggling focus mode (fade vs. slide vs. instant) for any of these apps — likely only visible by running the apps directly, which wasn't done in this pass.
- No verified Tauri app was found using a pure hover-edge (mouse-proximity) trigger for summoning chrome; only explicit hotkey/click toggles were documented.

## How do Tauri apps implement theming?

### Takeaway
CSS custom properties (`--variable` tokens redefined per theme, often via a `.dark` class or similar selector) is the dominant, explicitly-named technique among Tauri app templates, matching Marxy's own `--marxy-*` contract approach; a purpose-built "dynamically change theme" plugin (`tauri-plugin-theme`) existed but is now deprecated in favor of Tauri's own native OS-theme API, suggesting the ecosystem has converged on "OS theme detection via Tauri core + CSS variables for the actual palette" rather than a plugin-driven runtime theme engine.

### Cited Findings
- In the `tauri-vue-app` / `tauri-template`-style projects, "Colors are CSS custom properties that the `.dark` class redefines, so components use `bg-card` or `text-muted-foreground` and follow the theme automatically" — a token-indirection pattern (semantic token names, not raw colors, referenced by components). — [xbuilderltd/tauri-template](https://github.com/xbuilderltd/tauri-template) (via search synthesis)
- `tauri-plugin-theme` ("Dynamically change Tauri App theme") is explicitly marked no-longer-maintained because "Tauri officially provides a better API" for this now — i.e., theme-switching has moved from a community plugin into Tauri core itself. — [tauri-plugin-theme GitHub](https://github.com/wyhaya/tauri-plugin-theme)
- Some Tauri app templates combine SCSS with CSS custom properties for styling flexibility, rather than CSS variables alone. — [WebSearch synthesis, awesome-tauri ecosystem]
- `KitsuneX07/tauri-vue-app` (Tauri v2 + Vue 3) advertises "theme switching" as a named starter feature alongside i18n, though the specific token architecture wasn't independently verified beyond the summary. — [KitsuneX07/tauri-vue-app](https://github.com/KitsuneX07/tauri-vue-app)
- md-reader offers "Light, Dark, and Auto" themes "applied instantly" (no reload), implying its theme switch is a pure CSS-variable/class swap rather than a re-render or restart. — [md-reader GitHub](https://github.com/olafkrawczyk/md-reader)
- markdown-viewer persists theme (System/Light/Dark) plus content width and text size in the webview's local storage rather than a server or account — reinforcing "no accounts" as a norm even among polished readers in this space. — [markdown-viewer GitHub](https://github.com/putuandy/markdown-viewer)

### Inferences
- Marxy's existing `--marxy-*` custom-property contract is directly in line with what other Tauri apps converged on (semantic CSS variable tokens + a class or media-query switch for light/dark), not an unusual choice — this validates rather than changes Marxy's approach.
- None of the surveyed apps documented a user-facing "theme marketplace" (installable third-party themes) — theming in this space tops out at built-in light/dark(/auto) plus, in template starters, a palette choice at scaffold time. If Marxy wants a real theme-marketplace/import experience, it appears to be ahead of what's publicly documented in the Tauri app space, not something to copy from precedent.

### Gaps
- No verified Tauri app was found with a genuine third-party/community theme marketplace or user-authored-theme import flow; this appears to be unexplored territory in the surveyed apps, so no citable pattern exists to adopt here.
- Could not confirm exact CSS variable naming conventions used by any single named production Tauri app (only the general "semantic token + `.dark` class" pattern was described, not a specific token list).

## What settings-UI patterns do polished Tauri apps use?

### Takeaway
The clearest verified example, Aptakube (a genuinely Tauri-based, actively marketed Kubernetes GUI explicitly positioned against Electron competitors), demonstrates that a polished Tauri app can ship a fully custom, in-app settings/UI experience rather than deferring to native OS settings — but public sources didn't expose granular settings-pane interaction detail (search-within-settings, categorization) for any app in this pass.

### Cited Findings
- Aptakube markets itself explicitly as "built with Tauri," contrasting itself with "Electron-based alternatives" and claiming to be "significantly faster and smaller while delivering a beautiful, intuitive desktop experience" — establishing it as a deliberately design-forward, verified-Tauri reference app in an adjacent (developer-tool GUI) category. — [Aptakube — Made with Tauri](https://madewithtauri.com/submissions/aptakube); [Aptakube official site](https://aptakube.com/)
- Aptakube's own build notes describe Tauri and Solid.js as the two best technical decisions of the project, framing it as "a minimal web app packaged into a tiny macOS executable" — i.e., the settings/config UI is implemented as ordinary web UI inside the Tauri shell, not native OS panels. — [Aptakube by @goenning — BuildWith.app](https://buildwith.app/apps/aptakube)

### Inferences
- Given every reader/editor app surveyed in this research (md-reader, markdown-viewer, CrabPad, Paperling) keeps settings as in-webview, locally-persisted state rather than native OS preference panes, the norm for this category of Tauri app is a custom in-app settings surface — consistent with Marxy's own "no accounts, local-first" stance — but no source described a specific search-within-settings interaction to cite.

### Gaps
- No source (including Aptakube's own site/build-notes) described the settings pane's internal layout, categorization, or whether it supports search-within-settings — this would require directly opening the app or its screenshots, which wasn't done in this research pass.
- No second polished, verified-Tauri settings UI was found with enough public detail to compare against Aptakube's.

## Specific Tauri apps in the file-manager/note-taking/reader space worth studying closely

### Takeaway
Spacedrive (file manager) and Aptakube (developer-tool GUI, adjacent category) are the two most design-forward, unambiguously-verified Tauri apps found; in the markdown-reader niche closest to Marxy itself, md-reader and markdown-viewer are the most feature-comparable and both explicitly confirm Tauri 2 in their own READMEs, making them the most directly citable prior art for reader-specific interaction patterns (outline sync, keyboard-consistent panes, instant theme switch, reduced-motion support).

### Cited Findings
- **Spacedrive** — cross-platform file explorer, Tauri 2 + React 19 + TanStack Query + Tailwind v4, Cmd/Ctrl+K command palette for search/navigation/actions, backed by a Rust "virtual distributed filesystem." — [Spacedrive GitHub](https://github.com/spacedriveapp/spacedrive)
- **Aptakube** — Kubernetes GUI, Tauri + Solid.js, explicitly built to be smaller/faster than Electron competitors; multi-cluster support; positioned as a design-quality benchmark for "boring category, polished execution." — [Aptakube GitHub](https://github.com/aptakube/aptakube); [Aptakube site](https://aptakube.com/)
- **md-reader** — "a calm, native macOS markdown reader for notes, docs, and knowledge bases. Local-first, zero telemetry." Confirmed Tauri 2 (Rust core + React/CodeMirror front end). Read/Write/Split/Research layout presets, focus mode, bionic reading, instant Light/Dark/Auto themes. — [md-reader GitHub](https://github.com/olafkrawczyk/md-reader)
- **markdown-viewer** — "small, fast, local-first Markdown reader for the desktop," confirmed Tauri 2 + Rust + Svelte 5. Sidebar file tree with auto-expand-to-current-file, outline that highlights the active heading and scroll-syncs, fully consistent arrow-key navigation across file tree and outline, `prefers-reduced-motion` support, local-storage-only settings persistence (theme/width/text size), no accounts/server/telemetry. — [markdown-viewer GitHub](https://github.com/putuandy/markdown-viewer)
- **Paperling** and **markdown_tauri** — both confirmed Tauri-based minimal/distraction-free markdown readers/editors, though with less public design detail than md-reader or markdown-viewer. — [Paperling GitHub](https://github.com/Razee4315/Paperling); [markdown_tauri GitHub](https://github.com/prateekjain24/markdown_tauri)

### Inferences
- Of everything surveyed, **markdown-viewer** and **md-reader** are the closest direct analogues to Marxy (same category: local-first, no-account, Tauri, markdown reading) and their public feature lists (outline scroll-sync, keyboard-consistency between outline and file tree, reduced-motion support, instant local-only theme switching) read like a checklist Marxy should already be matching or exceeding, since Marxy's stated bar is "a competent, ordinary-looking markdown viewer is a failure."
- Spacedrive and Aptakube are worth studying for chrome/command-palette/settings polish specifically because they're outside Marxy's own category (file manager, k8s GUI) and thus demonstrate that the "Tauri app can look genuinely premium, not just functional" bar is achievable outside note-taking apps too — useful as aesthetic reference points beyond the reader niche.

### Gaps
- Could not verify screenshot-level visual polish for any of these apps in this pass (no image fetch was performed); this research is text/doc-based only. A follow-up pass should look at each app's actual screenshots/video (e.g., madewithtauri.com submission pages, project READMEs' embedded images) before citing them in a taste-review context.
