# Marxy Settings: reference

Every setting in Marxy, with its control, default, range, preference key and the rules that tie it to other settings. The prototype is [08-settings.html](08-settings.html); the tables below were generated from that page's own schema (`Marxy.settingsSchema`) and then edited, so the two agree.

Reading typography follows the [Reader Typography Spec](../docs/src/10-spec.md) and the accessibility chapter, [Colour and Accessibility](../docs/src/09-color-access.md). Where a setting implements a spec rule, the rule is named.

## Contents

1. [The Settings window](#the-settings-window)
2. [Search](#search)
3. [Deep links](#deep-links)
4. [Coupling rules](#coupling-rules)
5. [Precedence: Reading, content types and the type's own defaults](#precedence-reading-content-types-and-the-types-own-defaults)
6. [Settings by section](#settings-by-section)
7. [Persistence format](#persistence-format)
8. [Tauri implementation notes](#tauri-implementation-notes)
9. [Recommended changes to the shared engine](#recommended-changes-to-the-shared-engine)
10. [Open questions](#open-questions)
11. [Related prototypes](#related-prototypes)

## The Settings window

**A separate window, not a page in the document window.** Settings is its own window with its own title bar, traffic lights and a sidebar of categories, in the layout macOS System Settings has used since Ventura. That reads as native for three reasons:

- It is the macOS convention. Marxy › Settings… (⌘,) opens one Settings window from anywhere; a second ⌘, brings the same window forward. HIG calls this the app's settings window, and users expect it to sit beside their documents, not replace one.
- Changes apply immediately, so the document windows must stay visible behind it. Change the theme, text size or line length and the open documents re-render while you watch.
- Thirteen categories need a persistent list. The document window's sidebar is the Library; borrowing it for settings would hide the thing you are tuning.

**Window behaviour.**

| Aspect | Behaviour |
|---|---|
| Opening | ⌘, from any window, the gear in the document sidebar footer, the palette (`Settings: Reading` and so on), or a `08-settings.html#section` link from another view |
| Instances | One. Reopening brings it forward and keeps its scroll position per section |
| Size | Default 900 × 680 pt, minimum 720 × 520 pt, resizable; remembers its frame. The prototype fills the browser viewport |
| Layout | Sidebar of 13 categories in four groups, each with an icon tile (all tiles are the accent: icon in `--accent` on `--accent-wash`, never per-category colours); a search field at the top of the sidebar; the pane shows one category as groups of rows (label and description left, control right). Reading puts a live, measured preview beside its rows |
| Toolbar | Back and Forward (⌘[ and ⌘]) through visited categories; the category title; a changed-count chip; Reset section; Commands (the palette) |
| Saving | None needed. Every change is written at once. Resets and imports offer Undo in a toast |
| Reset | A dot before a label marks a setting changed from its default; clicking the dot resets that one. Reset section restores the visible category. Advanced › Reset all settings asks first, in a sheet whose default button is Cancel |
| Dependent controls | A control that cannot apply is disabled and says why underneath, for example "Needs automatic checks" or "Unavailable: the column holds about 41 characters…". Advisories that do not block (a dark theme below 100%, justification without hyphenation) appear as a note below the row |
| Narrow windows | Below about 1180 pt the Reading preview moves above the rows and stays pinned; below 860 pt the sidebar becomes an icon rail and wide controls drop under their labels. No horizontal scrolling at any width |
| Close | ⌘W. Escape does not close it (System Settings behaves the same); Escape clears the search field |

**Keyboard and accessibility.** Tab order runs search, categories, toolbar, then the pane. Arrow keys move through categories, segmented controls and radio lists (roving focus). Every input has a real label (`<label for>`, or `aria-labelledby` for groups); descriptions and disabled reasons are linked with `aria-describedby`; sliders announce formatted values through `aria-valuetext`; side effects of couplings ("Word spacing now 0.28 em", "Text size 100%") are announced in a polite live region. State is never shown by colour alone: changed settings carry a dot and a reset button with a label, conflicts carry text chips. The page honours Reduce motion, Reduce transparency, Increase contrast and forced colours.

## Search

The search field at the top of the sidebar searches every category at once.

| Aspect | Behaviour |
|---|---|
| What matches | Each word must match somewhere in: the label, the description, hidden keywords (for example "font" finds Type set, "dyslexia" finds Letter spacing), the preference key (`edWrap`), the group name or the category name |
| Results | Replace the pane, grouped as "Category › Group", ordered by the sidebar. Rows are live: change a setting straight from the results |
| Highlight | Matches are highlighted with the CSS Custom Highlight API, so the DOM is not modified; a `<mark>` fallback covers engines without it. A row matched only through a keyword or key says so: "Matches `edWrap`" |
| Shortcuts | Commands and menu items whose name matches, or whose shortcut equals the query (type ⌘K), appear in a Keyboard shortcuts group, recordable in place |
| Sidebar | Each category shows its number of results; categories with none are dimmed but stay clickable |
| Keys | ⌘F focuses the field. Escape clears it. Return opens the first result in its own category and focuses its control. Down arrow moves into the results |
| URL | `#q=term`, so a search can be linked |
| Empty | "No settings match …" with suggested broader words |

## Deep links

| Link | Opens |
|---|---|
| `08-settings.html#general` | General |
| `#appearance` | Appearance |
| `#reading` | Reading |
| `#types` | Content types |
| `#editor` | Source editor |
| `#clipboard` | Copy and collect |
| `#library` | Library and indexing |
| `#shortcuts` | Palette and shortcuts |
| `#macos` | macOS integration |
| `#export` | Export |
| `#privacy` | Privacy and data |
| `#accessibility` | Accessibility |
| `#advanced` | Advanced |
| `#section/row` | That category, scrolled to the row, which flashes and takes focus. The row id is the preference key for single-key rows (`#reading/justify`, `#library/pathBase`), otherwise the row's own id (`#types/kind-book`, `#advanced/settingsFile`, `#privacy/permissions`, `#reading/scripts`) |
| `#q=term` | Search results for *term* |

The palette registers `Settings: <Category>` for every category plus Search settings, Reset this settings section, Reset all settings…, Export settings…, Import settings…, Show settings.json, Test WCAG 1.4.12 text spacing, and Apply WCAG 1.4.12 spacing.

## Coupling rules

The spec's [coupling rules](../docs/src/10-spec.md#coupling-rules), as the Settings window enforces them. Spec rules first, then the couplings this product adds.

| Rule | Spec says | Settings does |
|---|---|---|
| 1. The measure follows the face and size | Recompute the column from the face's average character width when size or face changes, so the character count holds; clamp to the screen | Line length is set in characters. The preview measures the face (`G.measureDoc`), widens the column when letter or word spacing is added, and clamps to the pane. The colophon reports the measured characters per line against the target, and says "Column narrowed to fit the window" when clamped |
| 2. Justification needs width | Below 45 characters set ragged right whatever the setting says, and tell the user why in the settings panel | When the computed column is under 45 characters (large text, a narrow window, Split view, a per-type measure under 45, or a small PDF page) Justification is disabled with the reason and the current width. The stored choice is kept and applies again when the column widens. The per-type editor disables the Justified option for measures under 45; PDF export says when book typography falls back to ragged |
| 3. Letter spacing drags word spacing | Raise word spacing by at least as many ems as letter spacing | Applied word spacing = word spacing + letter spacing (the spec's token sketch). The Word spacing row shows the applied value and its two parts; changes are announced |
| 4. Leading has script floors | Multiply by 1.17 (CJK, never below 1.5), 1.1 (Devanagari, Hebrew with points), 1.07 (Thai and several Indic scripts) | A read-only Script adjustments table in Reading shows the resulting line heights for the current setting |
| 5. Script rules override user spacing | No letter spacing for cursive or Indic scripts; no justification for Thai in a browser engine; CJK justified inter-character | The same table states letter spacing and justification per script |
| 6. Genre overrides user spacing | In verse, code, maths and tables only size and face apply | Spacing never reaches `pre`, `code`, tables, maths or verse (the preview shows it). For the Code and Data types, line length, line height, alignment, paragraphs and page model are disabled with the reason |
| 7. Dark theme implies generous size | Do not ship a dark default with small text | A warning on Theme and Text size when a dark theme is active below 100%, with a one-click "Use 100%"; choosing a dark theme while below 100% offers the same in a toast. The colophon flags it too |

| Product coupling | Behaviour |
|---|---|
| Paragraphs: indent or space, never both | One control with three values (Auto, Indent, Space); only the matching amount slider is shown |
| Documentation is ragged | Docs, README, Changelog and Transcript are set ragged by type (spec, overrides by content type) unless their own Alignment override says otherwise |
| Justified without hyphenation | Advisory note: gaps open up |
| Line height under 1.5, line length over 80 | Advisory notes citing WCAG 1.4.8 (AAA) |
| On launch, Last session | Forces Reopen windows after quitting on |
| File changed on disk while you have unsaved edits | A neutral bar offers Keep mine as a copy and Take theirs (Source editor › Saving); nothing is overwritten without asking |
| Reduce transparency | Forces a solid sidebar |
| Reduce motion | Disables page-turn animation |
| Detection off | Disables sensitivity, reasons and every per-type Detect switch |
| Path base | Disabled while Verify file paths (Reading) is off |
| HTML subset fonts | Needs a self-contained file |
| Palette prefixes | Must be one symbol; duplicates are flagged and the first mode wins |

## Precedence: Reading, content types and the type's own defaults

For each typographic property the effective value is the first that is set:

1. The per-type override in Content types (for example Notes, line length 60).
2. The Reading setting, unless it is Auto.
3. The type's own default from `tokens.css` (Article 66 characters and 1.58, Book 64 and 1.50, Report 74 and 1.55, README 84 and 1.62).

Code and Data ignore steps 1 and 2 for everything except face and size (rule 6). Docs, README, Changelog and Transcript skip the Reading justification setting (they are ragged by type) unless their own Alignment override is set. The Book page model is the existing `bookPaged` preference. The per-type summary line in Content types shows the result.

## Settings by section

Columns: **Setting** as labelled in the window; **Control**; **Default**; **Range or options**; **Pref key** in `G.prefs` (`(window state)` marks rows that show system or session state and are not preferences); **Notes**, including when the row is disabled. "Ships v1.x" and "Later" match the release tiers in [FEATURES.md](FEATURES.md).

### General

Deep link `08-settings.html#general`. Startup, how documents open, the default app for Markdown, updates and notifications.

**Startup**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| On launch, open | Pop-up | Last session | Last session / Library / Inbox / An empty window | `launchOpen` | |
| Reopen windows after quitting | Switch | On | On / Off | `restoreSession` | Forced on (disabled) while On launch is Last session |
| Remember reading position | Switch | On | On / Off | `rememberPosition` | Articles and books also show progress |

**Documents**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Default view | Segmented | Split | Read / Split / Source | `view` | Split by default: the rendered page beside the exact text. Per-type "Opens in" overrides it |
| Open files in | Segmented | Tabs | Tabs / Windows / Automatic | `openIn` | Automatic follows macOS "Prefer tabs when opening documents" |
| Reload files changed on disk | Switch | On | On / Off | `autoReload` | Unsaved edits are never overwritten |
| Ticking a task edits the file | Switch | On | On / Off | `tasksWrite` | Off makes rendered checkboxes read-only |
| Dates in lists | Segmented | Relative | Relative / Absolute | `dateStyle` | |

**Measures**

The counts shown beside a document, in every place the engine draws them: status bar, Source bottom bar, selection, copy confirmation, inspector, library and palette. Searchable by count, words, tokens, characters, length, size.

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Show | Segmented | Contextual | Contextual / All / Custom | `measuresMode` | Contextual: prose words · chars · ≈tokens · lines; code lines · chars · ≈tokens · bytes; data lines · bytes · chars; logs and terminal lines · bytes. All: lines · words · chars · ≈tokens · bytes · reading time |
| Your measures | Toggle chips, draggable (or arrows) | Characters, Tokens | Any of lines, words, chars, tokens, bytes, readTime; at least one | `measures` | Only in Custom. Order matters: where only one fits, the first is used |
| Shown as | Live sample | – | – | (window state) | A table with one sample per kind group in Contextual; one line ("Shown as: 4,812 chars · ≈1,266 tokens") otherwise |
| Tokenizer | Pop-up | Estimate | Estimate / cl100k-like | `tokenizer` | "Estimated on this Mac; nothing is sent." Estimate is about characters / 3.8, shown with ≈; cl100k-like is mocked the same way. Disabled while Custom leaves tokens out |
| Appears in | Note | – | – | (window state) | Status bar, Source bottom bar, selection, copy confirmation, inspector, library, palette |

Per kind, Content types › Edit › **Measures** (Follow app / Choose, then the same chips) writes `kindMeasures[kind]`, which wins over the mode for that kind.

**Default app**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Default app for Markdown | Status and button | – | Make Marxy the default / Restore previous | (window state) | Launch Services state, not stored in settings.json |
| File types | Toggle chips | .md .markdown .mdown | .md .markdown .mdown .mkd .mdx .txt | `claimTypes` | Warning when none is selected |

**Updates**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Check for updates automatically | Switch | On | On / Off | `updateCheck` | Once a day |
| Download and install automatically | Switch | Off | On / Off | `updateAuto` | Disabled: needs automatic checks. Installs on quit, never restarts while you read |
| Channel | Segmented | Stable | Stable / Beta / Nightly | `updateChannel` | Nightly warns to export settings first |
| Marxy 1.4.2 (1420) | Buttons | – | Check now / Release notes | (window state) | |

**Language**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Interface language | Pop-up | System (English) | System / English / Deutsch / Français / Español / 日本語 / 简体中文 | `language` | Applies at next launch. Document language is detected per file |

**Notifications.** Whether banners appear at all is set in System Settings › Notifications › Marxy.

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Indexing problems | Switch | On | On / Off | `notifyIndexErrors` | |
| A long export finished | Switch | Off | On / Off | `notifyExport` | Exports over 5 s |
| Play a sound | Switch | Off | On / Off | `notifySound` | Disabled: all notifications are off |
| Notification style | Button | – | Open System Settings… | (window state) | |

### Appearance

Deep link `08-settings.html#appearance`. Theme, type set, text size and the window around the text.

**Theme**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Theme | Read-only line ("Dark: Mine · Light: Paper", or "One theme: …") and a **Choose in Themes…** link | Follow macOS: Paper and Night | Chosen in [07-themes.html](07-themes.html): any built-in or custom theme | `theme`, `themeLight`, `themeDark` | The choice has one home, the theme list in 07. A custom theme's id may be stored; a missing one falls back to Night (Dark) or Paper (Light). Rule 7 advisory |
| Accent colour | Segmented | Theme | Theme / macOS / Graphite | `accent` | A macOS accent is used only where it passes 3:1 against the theme |
| Code highlighting | Segmented | Full | Full / Minimal / Off | `codeHighlight` | Comments never below 4.5:1 |
| Switch on a schedule | Pop-up | Off | Off / Sunset to sunrise / Custom hours | `themeSchedule` | Ships Later. Disabled unless following macOS |

**Type**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Type set | Radio list with samples | Classic | Classic / Plex / Hyperlegible / System / Typewriter | `typeset` | Samples render in each set's book, sans and code faces |
| Text size | Slider | 100% | 75% to 250%, step 5 | `scale` | Stored as a factor (1 = 100%). Spec range. ⌘+ ⌘− ⌘0 everywhere. Rule 7 advisory |

**Window**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Sidebar | Segmented | Glass | Glass / Solid | `sidebarStyle` | Disabled (solid) while Reduce transparency is on |
| Density | Segmented | Regular | Compact / Regular / Comfortable | `density` | Row height in lists and Settings |
| Toolbar | Segmented | Icon and text | Icon and text / Icon only / Text only | `toolbarStyle` | Buttons are chosen in View › Customise Toolbar ([09-macos.html](09-macos.html#toolbar)) |
| Show sidebar | Switch | On | On / Off | `sidebar` | ⌃⌘S |
| Show tab bar | Switch | On | On / Off | `tabs` | |
| Show status bar | Switch | On | On / Off | `statusbar` | Kind, words, line and column, encoding and the theme switch |
| Inspector | Segmented | Automatic | Automatic / Show / Hide | `inspector` | Automatic opens it in windows 1600 pt or wider. ⌥⌘I |

**Motion**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Reduce motion | Segmented | System | System / On / Off | `reduceMotion` | Also shown in Accessibility (same key). Turns off page turns and smooth scrolling |

### Reading

Deep link `08-settings.html#reading`. Reading typography, following the spec. The preview beside the rows shows the article, book, report, docs, README or notes sample with every setting applied, a Read view / Split view width switch, and a colophon: face, size, leading, measured characters per line against the target and its source, alignment, weight and spacing. **Test WCAG 1.4.12 spacing** applies the four overrides (line height 1.5, paragraph spacing 2 em, letter 0.12 em, word 0.16 em) to the preview as a user style sheet would and reports clipped or overlapping text.

**Column**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Line length | Auto/Custom + slider | Auto | Auto, or 45 to 90 characters | `measure` | Spec default 66 (45–80, bounded by the screen). Auto uses each type's own. Rule 1. Note above 80 (WCAG 1.4.8) |
| Line height | Auto/Custom + slider | Auto | Auto, or 1.30 to 2.00, step 0.05 | `leading` | Spec default 1.5, range 1.3–2.0. Note below 1.5 (WCAG 1.4.8). Scripts raise it (rule 4) |

**Paragraphs**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Paragraph style | Segmented | Auto | Auto / Indent / Space | `paraStyle` | Never both: one value. Auto = indents for books, space for the rest |
| First-line indent | Slider | 1.00 em | 0 to 3 em, step 0.25 | `paraIndent` | Shown with Indent. Spec range 0–3 (rem in the spec; em here so it scales) |
| Space between paragraphs | Slider | 0.75 em | 0 to 2 em, step 0.05 | `paraSpace` | Shown with Space. Spec range 0–2 |

**Alignment and hyphenation**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Justification | Segmented | Auto | Auto / Ragged right / Justified | `justify` | Auto = ragged, books justified when paged. Rule 2: disabled under 45 characters with the reason; choice kept. Points to Advanced › Total-fit justification |
| Hyphenation | Switch | On | On / Off | `hyphenate` | Body text only. Warning when justified without it |
| Hyphenation language | Pop-up | Auto, from the document | Auto / English (US) / English (UK) / German / French / Spanish / Dutch | `hyphenLang` | Disabled: hyphenation is off |
| Hyphens in a row | Segmented | 2 | 1 / 2 / 3 / Any | `hyphenLimit` | Disabled: hyphenation is off |

**Spacing.** Extra spacing helps some readers, and only when letter and word spacing rise together.

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Letter spacing | Slider | +0.00 em | 0 to 0.50 em, step 0.01 | `letterSpacing` | Spec range 0–0.5. Rule 3 |
| Word spacing | Slider | +0.00 em | 0 to 1.00 em, step 0.01 | `wordSpacing` | Spec range 0–1. Applied = word + letter spacing. WCAG 1.4.12 requires tolerating 0.16 em |
| Presets | Buttons | – | Default / WCAG 1.4.12 / Wide | `letterSpacing`, `wordSpacing`, `leading`, `paraStyle`, `paraSpace` | WCAG: 0.12, 0.16, 1.5, space 2 em. Wide: 0.16, 0.40, 1.8, space 1.2 em (BDA guide, no research cited). Undo in the toast |
| Not applied to code, tables, maths or verse | Read-only | – | – | (window state) | Rule 6 |
| Script adjustments | Read-only table | – | – | (window state) | Rules 4 and 5, computed from the current line height |

**Weight**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Text weight | Slider | 0 | −50 to +150, step 10 | `weightAdjust` | Added to the theme's body weight; heavier text helps some low-vision readers |
| Lighter text on dark themes | Switch | On | On / Off | `darkLighter` | Spec: about 5% lighter on dark (Ink 380, Paper 400). Off adds 20 on dark themes. The row shows the body weight now |

**Notes, links and images**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Footnotes | Segmented | Pop-up | Pop-up / Margin / At the end | `footnotes` | Margin falls back to pop-ups when there is no room beside the column, and says so |
| Always underline links | Switch | On | On / Off | `underlineLinks` | Off warns: colour alone fails WCAG 1.4.1 |
| Images | Pop-up | Local; remote on click | Show all / Local; remote on click / None; show alt text | `images` | Remote images can reveal when a file was opened |
| Draw README badges locally | Switch | On | On / Off | `localBadges` | No request to shields.io |
| Render maths | Switch | On | On / Off | `renderMath` | Ships v1.x |
| Render diagrams | Switch | On | On / Off | `renderDiagrams` | Ships v1.x |

**Paths**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Verify file paths | Switch | On | On / Off | `checkPaths` | Resolved against Library › path base |

**Interaction**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Block handles | Switch | On | On / Off | `blockHandles` | |
| Selection toolbar | Switch | On | On / Off | `selectionToolbar` | |
| Start in focus mode | Switch | Off | On / Off | `focusMode` | |
| Reading progress | Switch | On | On / Off | `showProgress` | |
| Page turns | Segmented | Slide | Slide / Fade / None | `pageTurn` | Disabled (none) while Reduce motion is on |

### Content types

Deep link `08-settings.html#types`. Each type has a row with a Detect switch, a summary of its effective typography, and an Edit panel: Face, Size, Line length (35–100), Line height (1.3–2.0), Alignment, Paragraphs, Page, Opens in, Theme, and the quick-tool strip with show/hide and move up/down per tool plus a live strip preview. Reset per type, and a link to [03-content-modes.html](03-content-modes.html).

**Detection**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Detect content type | Switch | On | On / Off | `detectKind` | |
| Sensitivity | Segmented | Balanced | Cautious / Balanced / Eager | `detectSensitivity` | Disabled: detection is off |
| Show why a type was chosen | Switch | On | On / Off | `detectReasons` | Disabled: detection is off |
| Remember types you choose | Switch | On | On / Off | `kindRemember` | |

**Types**

| Type | Type defaults (from tokens.css) | Quick tools, default order | Notes |
|---|---|---|---|
| Report | Sans, 17 px, 74 ch, 1.55, spaced | Copy as, Extract, Verify paths, Tasks, Changes, Split by H2 | |
| Article | Article serif, 20 px, 66 ch, 1.58, spaced | Focus, Highlight, Quote with link, Margin notes, Read aloud | |
| Book | Book serif, 20 px, 64 ch, 1.50, indents | Paged, Contents, Justify, Bookmark, Highlight, Initial | Page model is `bookPaged` |
| README | README sans, 16 px, 84 ch, 1.62, spaced, ragged by type | Copy install, All commands, Badges, Outline, Config table, Open repo | |
| Docs | Sans, 16 px, 74 ch, 1.62, spaced, ragged by type | On this page, Copy section, Copy link, Examples only, Search docs set, Prev / next | |
| Code | Mono, 14 px, verbatim | Wrap, Literate, Symbols, Copy fenced, Go to line | Rule 6: only face and size |
| Transcript | Sans, 16 px, 76 ch, 1.55, spaced, ragged by type | Collapse tools, Only you, Only assistant, Last reply, Export as doc | |
| Data | Mono, 14 px, verbatim | Copy as, Column stats, Filter, Transpose, Chart | Rule 6: only face and size |
| Notes | Sans, 16 px, 70 ch, 1.55, spaced | Tasks, Backlinks, Append clipboard, Daily | |
| Changelog | Sans, 16 px, 80 ch, 1.55, spaced, ragged by type | Versions, Copy release notes, Compare | |

| Pref key | Shape | Default |
|---|---|---|
| `kindDetect` | `{ [kind]: boolean }` | every type `true` |
| `kindOverrides` | `{ [kind]: { face?, size?, measure?, leading?, align?, para?, page?, view?, theme? } }`; absent field = default | `{}` |
| `kindTools` | `{ [kind]: [[toolId, shown], …] }` in display order; absent = the engine's order, all shown | `{}` |
| `kindMeasures` | `{ [kind]: [measureId, …] }` in display order; absent = follow `measuresMode` | `{}` |
| `bookPaged` | boolean | `false` |

Per-type Theme is v1.x in FEATURES.md (for example books in Sepia, code in Night).

**Folder rules.** First match wins. Rules beat detection; a type chosen for one file beats both. A test field shows which rule matches a path, or what detection would say and why.

| Setting | Control | Default | Pref key | Notes |
|---|---|---|---|---|
| Rules | List of glob and type, with move up, move down and delete; Add rule | `**/transcripts/*.md` → Transcript; `~/Work/plans/**/*.md` → Report; `~/Notes/**/*.md` → Notes; `**/CHANGELOG*.md` → Changelog | `folderRules` (`[{ glob, kind }]`) | `**` matches any depth, `*` within one folder, `?` one character; case-insensitive |

### Source editor

Deep link `08-settings.html#editor`. An editor preview (the shared `G.Editor`) at the top shows font, size, line height, ligatures, tab size, wrap, minimap, current line and the problems list as you change them.

**Font**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Font | Pop-up | Type set (code face) | Type set / JetBrains Mono / IBM Plex Mono / Atkinson Hyperlegible Mono / SF Mono / Menlo | `edFont` | |
| Size | Slider | 13 px | 10 to 24 px | `edFontSize` | Multiplied by Text size |
| Line height | Slider | 1.65 | 1.20 to 2.00, step 0.05 | `edLineHeight` | |
| Ligatures | Switch | Off | On / Off | `edLigatures` | Off: in source every character should look like itself |

**Language**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Markdown flavour | Segmented | GitHub (GFM) | GFM / CommonMark / MDX | `mdFlavor` | |
| Line endings for new files | Segmented | LF | LF / CRLF | `edEol` | Existing files keep theirs |
| Slash inserts | Switch | On | On / Off | `edSlash` | |

**Indentation**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Tab size | Segmented | 4 | 2 / 4 / 8 | `edTabSize` | |
| Insert spaces for Tab | Switch | On | On / Off | `edInsertSpaces` | |
| Detect indentation from the file | Switch | On | On / Off | `edDetectIndent` | Overrides the two above per file |

**Wrapping**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Soft wrap | Switch | Off | On / Off | `edWrap` | ⌥Z |
| Wrapped line indent | Segmented | Indent | Same / Indent / Deep | `edWrapIndent` | Disabled: soft wrap is off |
| Wrap at | Pop-up | Window width | Window width / 80 / 100 / 120 columns | `edWrapColumn` | Disabled: soft wrap is off |

**Display**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Line numbers | Switch | On | On / Off | `edLineNumbers` | |
| Relative line numbers | Switch | Off | On / Off | `edRelativeNumbers` | Disabled: line numbers are off |
| Minimap | Switch | On | On / Off | `edMinimap` | |
| Highlight the current line | Switch | On | On / Off | `edCurrentLine` | |
| Show whitespace | Pop-up | Boundary | None / Boundary / In selection / Trailing / All | `edWhitespace` | |
| Colour bracket pairs | Switch | On | On / Off | `edBracketPairs` | |
| Indent guides | Switch | On | On / Off | `edIndentGuides` | |
| Folding | Switch | On | On / Off | `edFolding` | |
| Sticky headings | Switch | On | On / Off | `edStickyHeadings` | |

**Keys and cursor**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Key bindings | Segmented | Standard | Standard / Vim / Emacs | `edKeymap` | Ships v1.x. Source editor only; app shortcuts keep working |
| Add a cursor with | Segmented | ⌥-click | ⌥-click / ⌘-click | `edMultiCursor` | The other modifier opens links and paths |
| Close brackets and quotes | Switch | On | On / Off | `edAutoClose` | |
| Continue lists on Return | Switch | On | On / Off | `edSmartLists` | |
| Paste a URL over a selection as a link | Switch | On | On / Off | `edPasteLink` | |

**Problems**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Check Markdown | Switch | On | On / Off | `edLint` | |
| Rules | Switch and severity (Info / Warning / Error) per rule; limit field for long lines | Heading jumps: warning; trailing whitespace: info; emoji: info; missing paths: warning; unclosed fences: error; long lines: off (120) | Long-line limit 60–400 | `lintRules` (`{ id: { on, sev, max? } }`) | Disabled: checking is off |

**Saving**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Autosave | Segmented | Off | Off / On focus change / After a delay | `edAutosave` | Off by default: other apps may write the same files |
| Delay | Slider | 1 s | 250 ms to 5 s, step 250 | `edAutosaveDelay` | Disabled unless After a delay |
| When the file changes on disk while you have unsaved edits | Segmented | Ask | Ask / Keep mine as a copy / Take theirs | `edDiskChange` | Ask shows a neutral bar with Keep mine as a copy and Take theirs; it is shown only when the file actually changed |
| Trim trailing whitespace on save | Switch | Off | On / Off | `edTrimOnSave` | Keeps two-space hard breaks |
| End files with a newline | Switch | On | On / Off | `edFinalNewline` | |

**Split view**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Sync scrolling | Switch | On | On / Off | `syncScroll` | |
| Mark the block at the cursor | Switch | On | On / Off | `cursorSync` | |
| Re-render while typing after | Slider | 120 ms | 0 to 1000 ms, step 20 | `renderDelay` | The engine's editor debounce is 120 ms today |

### Copy and collect

Deep link `08-settings.html#clipboard` (the id is kept so older links still resolve; the sidebar label is Copy and collect). Links to [06-clipboard.html](06-clipboard.html). A Try it sample shows what ⌘C would put on the clipboard from a short sample with the current settings. Clipboard history is not in this direction.

**Copying**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| ⌘C copies as | Pop-up | Markdown | every `G.copyFormats` entry | `copyDefault` | |
| Remove emoji | Switch | Off | On / Off | `stripEmoji` | Outside code blocks |
| Smart punctuation | Switch | Off | On / Off | `smartPunctOnCopy` | |
| Rich text style | Segmented | Plain | Plain / Match theme / Destination | `richStyle` | |
| Strip tracking from URLs | Switch | On | On / Off | `stripTracking` | Ships v1.x |
| Try it | Read-only | – | – | (window state) | Before and after for the current format, with the options above |

**Collect mode**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Join items with | Pop-up | A blank line | Blank line / Rule (---) / Single newline / Custom text | `collectSep` | |
| Custom separator | Text field | +++ | any text | `collectSepCustom` | Shown with Custom text |
| Number the items | Switch | Off | On / Off | `collectNumber` | |
| Stop collecting after copying the stack | Switch | On | On / Off | `collectAutoOff` | |

**Pasting**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Paste as plain text by default | Switch | Off | On / Off | `pastePlain` | ⌥⇧⌘V always pastes plain |
| Convert rich text to Markdown on paste | Switch | On | On / Off | `pasteToMarkdown` | Disabled: plain paste is on |

### AI and summaries

Not in this direction. The window has no AI category, no provider, key, spending cap or prompt settings, and nothing here sends a document anywhere.

### Library and indexing

Deep link `08-settings.html#library`. Collections are listed with links to [05-collections.html](05-collections.html), where each collection can override these.

**Index**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Index | Segmented | Full text | Full text / Metadata only | `indexContent` | |
| File types | Toggle chips | .md .markdown .mdx .txt .csv .json .yaml | adds .rst .adoc | `indexTypes` | Source files are indexed in Git collections |
| Skip files larger than | Pop-up | 8 MB | 1 / 2 / 4 / 8 / 16 / 64 MB | `indexMaxMb` | |
| Exclude | Token list | node_modules, .git, dist, target | names or globs | `indexExclude` | |
| Respect .gitignore | Switch | On | On / Off | `indexGitignore` | |
| Include hidden files and folders | Switch | Off | On / Off | `indexHidden` | |
| Follow symbolic links | Switch | Off | On / Off | `indexSymlinks` | Never outside the collection |
| Watch latency | Slider | 250 ms | 50 ms to 2 s, step 50 | `watchLatency` | FSEvents coalescing; lower reacts sooner |
| Track read state | Switch | On | On / Off | `trackReadState` | |
| Index location | Path, Change…, Reveal | ~/Library/Application Support/Marxy/Index | any folder | `indexLocation` (empty = default) | |
| Index | Status and Rebuild index… | – | – | (window state) | Rebuild asks first |

**Snapshots**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Keep snapshots | Switch | On | On / Off | `snapshots` | |
| Keep for | Slider | 30 days | 1 to 365 days | `snapshotDays` | Disabled: snapshots are off |
| At most | Slider | 50 versions | 5 to 500, step 5 | `snapshotMax` | Per file; newest kept |

**Paths and duplicates**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Resolve mentioned paths against | Segmented | Collection base | Collection base / The file's folder / A folder | `pathBase` | Disabled while Verify file paths (Reading) is off |
| Folder | Text field | ~/Code | path | `pathBaseCustom` | Shown with A folder |
| Check web links | Switch | Off | On / Off | `checkLinksOnline` | Sends a request per linked site |
| Near-duplicate when | Slider | 90% similar | 70% to 100% | `dupThreshold` | |

### Palette and shortcuts

Deep link `08-settings.html#shortcuts`. Links to [04-palette.html](04-palette.html) and the menu map in [09-macos.html](09-macos.html).

**Command palette**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Prefixes | One-character field per mode | > commands, # headings, @ sections, / content search (⌘/ opens > on transforms), ~ collections, : line | any one symbol | `palettePrefixes` | Letters, digits and spaces refused; duplicates flagged |
| Recent files shown | Slider | 6 | 0 to 20 | `paletteRecent` | |
| Include commands in plain searches | Switch | On | On / Off | `paletteCommands` | |
| Rank by recent use | Switch | On | On / Off | `paletteFrecency` | |

**Keyboard shortcuts.** A table of every palette command (`G.commands`, including those registered by the open page) and every menu item, grouped, with:

- a filter by name or by keys (type ⌘K, or press **Find by keys** and press the combination);
- filters All, Edited, Conflicts and Unassigned, with counts;
- click a shortcut to record: the capture runs before the app's own key handling, so ⌘K and ⌘0 do not fire while recording; Escape cancels, Delete clears; plain keys and macOS-reserved combinations (⌘Q, ⌘H, ⌘M, ⌘Space, ⌘`, ⇧⌘3/4/5 and others) are refused with the reason; a combination already in use offers "Reassign to …" or Cancel;
- per-row reset, Reset all shortcuts (with Undo), and Import / Export as JSON.

Menu items set by macOS (Hide, Hide Others, Minimise, Quit) are shown but locked. Pref key `keymap`: `{ [commandId]: "⌥⌘J" }`, changes only; an empty string means "no shortcut". Keymap file format: `{ "format": "marxy-keymap/1", "bindings": { … } }`.

Building this table found two conflicts, since resolved: Open Library moved off ⇧⌘L (Select all occurrences) to ⌃⌘L; Inline code moved off ⌘` (macOS window cycling) to ⌃`.

### macOS integration

Deep link `08-settings.html#macos`. Links to [09-macos.html](09-macos.html). Finder, Services, Quick Look, Share and the Dock. There is no menu bar extra and no global shortcut group here: those surfaces are described only in 09-macos.

**Dock**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Dock icon | Segmented | Always | Always / Only with a window open | `dockShow` | Note when hidden: with no window open Marxy is reached from Spotlight, Finder or Handoff |
| Dock menu | Switch | On | On / Off | `dockMenu` | Recent documents |

**Finder and other apps**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Finder Quick Actions | Switch | On | On / Off | `finderActions` | Ships v1.x |
| Actions | Switch per action | Open in Marxy, Copy as Rich Text, Combine into One File, Add Folder to Library on | – | `finderActionList` | Disabled: Quick Actions off |
| Services menu | Switch | On | On / Off | `servicesMenu` | Ships v1.x |
| Services | Switch per service | Send to Marxy Inbox, Open as Markdown on; Convert to Markdown Table off | – | `servicesList` | Disabled: Services off |
| Quick Look | Switch | On | On / Off | `quicklook` | Ships v1.x |
| Quick Look uses your theme | Switch | On | On / Off | `quicklookTheme` | Disabled: Quick Look off |
| Share extension | Switch | On | On / Off | `shareExt` | Ships v1.x |
| Shortcuts actions | Switch | On | On / Off | `shortcutsActions` | Ships v1.x. Transform, copy as and more |
| Spotlight | Switch | On | On / Off | `spotlight` | Ships Later. Titles and headings |
| Handoff | Switch | On | On / Off | `handoff` | |
| Extensions in System Settings | Button | – | Open Login Items & Extensions… | (window state) | macOS can switch extensions off independently |

**Login**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Open at login | Switch | Off | On / Off | `openAtLogin` | |

### Export

Deep link `08-settings.html#export`.

**PDF**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Paper size | Pop-up | From region (A4) | From region / A4 / US Letter / A5 / US Legal | `pdfPage` | |
| Margins | Segmented | Normal | Narrow / Normal / Wide | `pdfMargins` | 12.7 / 20 / 30 mm |
| Text size | Slider | 11 pt | 9 to 14 pt, step 0.5 | `pdfSize` | |
| Book typography | Switch | On | On / Off | `pdfPagedType` | Holds a 66-character measure by widening margins; total-fit justification and hyphenation; no heading at a page end |
| Text block | Read-only | – | – | (window state) | Width and characters per line. Rule 2 warning under 45; note over 80 without book typography |
| Running heads | Segmented | Title and section | None / Title / Title and section | `pdfRunningHead` | |
| Page numbers | Segmented | Outer corner | None / Centred / Outer corner | `pdfPageNumbers` | |
| Colours | Segmented | Paper | Paper / Current theme | `pdfTheme` | |
| Wrap long code lines | Switch | On | On / Off | `pdfWrapCode` | Paper cannot scroll |
| Print link addresses as footnotes | Switch | Off | On / Off | `pdfLinkFootnotes` | |

**HTML**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Self-contained file | Switch | On | On / Off | `htmlSelfContained` | |
| Subset fonts | Switch | On | On / Off | `htmlSubsetFonts` | Disabled: only self-contained files embed fonts. Keeps every OpenType feature (spec decision) |
| Light and dark | Switch | On | On / Off | `htmlBothThemes` | |
| Embed the Markdown source | Switch | Off | On / Off | `htmlIncludeSource` | |

**Word**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Style mapping | Pop-up per element; Use a template .docx… | H1–H3 → Heading 1–3, body → Body Text, quote → Quote, code → HTML Preformatted, table → Grid Table 4, caption → Caption | Word built-in style names | `docxStyles` | Ships v1.x |

**Files**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| File name | Text field with live example | `{title} – {date}` | {title} {slug} {date} {kind} {collection} | `exportName` | Warns that / and : become dashes |
| Save to | Segmented | Ask each time | Ask / Beside the original / Downloads | `exportFolder` | |
| Open after export | Switch | On | On / Off | `exportOpen` | |

### Privacy and data

Deep link `08-settings.html#privacy`.

| Group | Contents | Pref key | Notes |
|---|---|---|---|
| Stored on this Mac | Settings, Library index, Snapshots, Recent documents, Logs: path, size, Reveal, and Clear… (or Rebuild) | (window state) | Each Clear asks first |
| Folder access | Each granted folder with its date, Revoke… and Grant access… | (window state) | Security-scoped bookmarks; system state, not in settings.json |
| Permissions | Notifications, Full Disk Access (not requested) | (window state) | Open System Settings… |

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Open marxy:// links from other apps | Segmented | Ask | Always / Ask / Never | `deepLinks` | Links can open files and run transforms |
| Marxy contacts the network only for | Read-only | – | – | (window state) | Computed from the other settings: updates, images, link checks |
| Share usage statistics | Switch | Off | On / Off | `analytics` | Off by default; never content, titles or paths |

### Accessibility

Deep link `08-settings.html#accessibility`. Spacing, line length and justification live in Reading; a button here runs the WCAG 1.4.12 test there.

**Vision**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Follow the macOS text size | Switch | On | On / Off | `followSystemSize` | |
| Use a high-contrast theme with Increase contrast | Switch | On | On / Off | `followSystemContrast` | Shows the current macOS state |
| Reduce transparency | Segmented | System | System / On / Off | `reduceTransparency` | Forces a solid sidebar |
| Reduce motion | Segmented | System | System / On / Off | `reduceMotion` | Same key as Appearance |
| Always show the focus ring | Switch | Off | On / Off | `focusRingAlways` | Also after clicks |
| Never show text smaller than | Pop-up | 11 px | 9 / 11 / 12 / 13 / 14 / 16 px | `minTextSize` | Footnotes, captions, badges, status bar |
| Insertion point width | Slider with preview | 2 px | 1 to 4 px | `caretWidth` | |
| Check text spacing | Button | – | Test in Reading | (window state) | |

**VoiceOver and keyboard**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Read code line by line | Switch | On | On / Off | `vcCodeLines` | |
| Announce line numbers in code | Switch | On | On / Off | `vcLineNumbers` | Disabled: needs line-by-line code |
| Announce table headers with each cell | Switch | On | On / Off | `vcTableHeaders` | |
| Move between blocks with arrow keys | Switch | On | On / Off | `blockNav` | |

**Read aloud**

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| Voice | Pop-up | System voice | System / Ava (Premium) / Zoe (Premium) / Evan (Enhanced) / Daniel (UK) | `speakVoice` | Ships v1.x |
| Speaking rate | Slider | 1.00× | 0.50× to 2.00×, step 0.05 | `speakRate` | |
| Highlight words as they are read | Switch | On | On / Off | `speakHighlight` | The EAA asks e-readers for text-to-speech |
| Skip code blocks | Switch | On | On / Off | `speakSkipCode` | |
| Preview | Button | – | Play | (window state) | Uses Web Speech in the prototype |

### Advanced

Deep link `08-settings.html#advanced`.

| Setting | Control | Default | Range or options | Pref key | Notes |
|---|---|---|---|---|---|
| settings.json | Path, Open in Marxy, Reveal, File / All values switch, Copy, live highlighted JSON | – | – | (window state) | Updates on every change |
| Log level | Pop-up | Warnings | Errors / Warnings / Info / Debug / Trace | `logLevel` | Debug and Trace include paths |
| Logs | Button | – | Open logs | (window state) | ~/Library/Logs/Marxy |
| Total-fit justification | Switch | Off | On / Off | `expTotalFit` | Experimental. Native Knuth–Plass breaker for justified paragraphs |
| Tree-sitter highlighting | Switch | Off | On / Off | `expTreeSitter` | Experimental |
| Semantic search | Switch | Off | On / Off | `expSemantic` | Experimental. 90 MB model download; index about 15% larger |
| Web Inspector | Switch | Off | On / Off | `devtools` | Needs a build with developer tools enabled |
| Move settings to another Mac | Buttons | – | Export… / Import… | (window state) | Keys and folder permissions excluded. Import ignores unknown keys and offers Undo |
| Reset all settings | Button | – | Reset all settings… | (window state) | Sheet with the changed count; Cancel is the default; Undo in the toast |

## Persistence format

`~/Library/Application Support/Marxy/settings.json` holds **only values that differ from their defaults**, as flat camelCase keys matching `G.prefs`, plus a format version. Defaults live in the app, so they can improve between releases without migrating files.

```json
{
  "version": 1,
  "theme": "system",
  "themeDark": "dusk",
  "scale": 1.15,
  "measure": 62,
  "justify": "on",
  "letterSpacing": 0.05,
  "kindOverrides": { "notes": { "measure": 60 } },
  "folderRules": [{ "glob": "~/Work/plans/**/*.md", "kind": "report" }],
  "keymap": { "go-collections": "⌥⌘J" },
  "edDiskChange": "copy"
}
```

| Rule | Detail |
|---|---|
| Writes | Debounced (about 300 ms) and atomic: write a temporary file, then rename |
| External edits | The file is watched; valid edits apply at once to every window; invalid JSON is reported in a banner and ignored, keeping the last good values |
| Unknown keys | Preserved on write, so a newer version's keys survive a downgrade |
| Out-of-range values | Clamped on read and reported in the log |
| Version | `version` increments only for incompatible changes; a migration runs once and keeps a backup beside the file |
| Not stored | Folder grants (bookmarks), default-app status (Launch Services), permissions (TCC), extension enablement (macOS), window frames and per-file state (reading position, chosen type, annotations: Marxy's own database) |
| Keymaps | Stored in `keymap`; export and import use `{ "format": "marxy-keymap/1", "bindings": {} }` |

In the prototype every preference lives in `localStorage` under `marxy.prefs`, shared by all pages; the Advanced pane's File view shows what settings.json would contain.

## Tauri implementation notes

These describe how the window and its effects map onto Tauri 2 on macOS. Plugin names are the official ones; anything that needs native code says so.

| Concern | Approach |
|---|---|
| Settings window | A second `WebviewWindow` with label `settings`, created on ⌘, if absent and focused if present. Native title bar with the sidebar drawn in the webview, or `titleBarStyle: Overlay` with hidden title for the inset-sidebar look |
| Settings storage | Either `tauri-plugin-store` (a JSON store in the app data directory) or a Rust-side `serde` struct with `#[serde(default)]` written with `serde_json`. The app data directory resolves from the bundle identifier (`~/Library/Application Support/<identifier>/`); to use a folder named `Marxy`, write the file from Rust to that path or choose an identifier whose folder you accept. Keep the Rust struct the source of truth so every window and background task reads the same values |
| Propagation | A `set_pref` command validates and saves, then emits a `pref` event to all windows (`AppHandle::emit`); every webview applies it. This replaces the prototype's per-page localStorage |
| Watching settings.json | The `notify` crate, ignoring the app's own writes |
| Open at login | `tauri-plugin-autostart` (LaunchAgent or AppleScript launcher on macOS). `SMAppService` login items (macOS 13 and later) need a small native shim |
| Dock menu | `applicationDockMenu` through `objc2` |
| Updates | `tauri-plugin-updater`; channels are separate update manifests |
| Logs | `tauri-plugin-log`, writing to `~/Library/Logs/<identifier>` |
| Default app for .md | `bundle.fileAssociations` in `tauri.conf.json` declares the document types; becoming the default handler needs `NSWorkspace.setDefaultApplication(at:toOpenContentType:)` (macOS 12 and later) or Launch Services, through native code |
| Quick Look, Finder Quick Actions, Share extension | App extensions (`.appex`) built with Xcode and embedded in the bundle in a post-build step; the Tauri bundler does not build extensions |
| Services menu | `NSServices` entries in Info.plist and a service provider object registered natively |
| Spotlight | Core Spotlight (`CSSearchableIndex`) through `objc2` |
| Folder access | Security-scoped bookmarks are required only in the App Sandbox (Mac App Store); outside it, macOS still prompts for protected folders such as Documents. Store bookmark data in Marxy's database, not settings.json |
| System accessibility state | Read Reduce motion, Reduce transparency and Increase contrast from `NSWorkspace` on the Rust side and pass them to the webviews, as WKWebView's media-query support for the last two is uneven |
| Read aloud | `AVSpeechSynthesizer` natively for voice choice and word callbacks |

## Shared engine status

Building this page surfaced gaps in the shared engine. Most are now fixed there:

| Change | Status |
|---|---|
| Reading preferences applied to every reading view (`G.applyReadingPrefs` in `shared/render.js`): measure, leading, paragraph style and amounts, hyphenation, letter and word spacing (applied word = word + letter), weight adjustment, lighter dark text, link underlines, per-type overrides; `--avg-char` widened by the spacing so the character count holds; justification gated on the measured count of 45 characters | Done; the Workspace and Content modes re-render when any of these change |
| `followSystemContrast` resolves to `hc-light` or `hc-dark` under `(prefers-contrast: more)` | Done |
| A setting changed in one window reaches open windows through the `storage` event | Done |
| Shortcut clashes: Open Library moved to ⌃⌘L, Inline code to ⌃` | Done |
| Books paged by default, as the spec says (`bookPaged: true`) | Done |
| The narrow-window rule hides only the window's own sidebar (`.win > .sidebar`) | Done |
| `G.Editor` reads `edFontSize`, `edLineHeight` and `edLigatures` | Done; `edCurrentLine` and `renderDelay` remain fixed |
| `G.lint` takes `lintRules` (per-rule switch, severity, long-line limit) | Open |
| The settings schema moves into a shared `settings.js` so the palette can search settings and every page can deep-link a row | Open; this page exposes `G.settingsSchema` meanwhile, and the 140 keys it introduces are listed in its `LOCAL` defaults |

## Open questions

1. **Paged books by default?** The spec says paged; the engine says scroll. Settings binds to `bookPaged` either way.
2. **Letter and word spacing units.** The spec gives ranges in rem; Marxy uses em so spacing scales with text size. Confirm.
3. **macOS text size.** The per-app Text size setting in macOS Accessibility applies only to apps that adopt it; Marxy needs to decide whether to read it (and how) or keep its own scale only.
4. **Accent "macOS".** Validating the system accent at 3:1 per theme needs the accent colour from `NSColor.controlAccentColor` passed to the webview.
5. **Margin notes in narrow previews.** The Reading preview rarely has room for margin notes at 1440 pt; consider letting the preview show a wider simulated window.
6. **Settings sync** across Macs (iCloud key-value store) is not designed; export and import cover it for now.

## Related prototypes

[01 Workspace](01-workspace.html) · [02 Source editor](02-source.html) · [03 Content modes](03-content-modes.html) · [04 Palette](04-palette.html) · [05 Library](05-collections.html) · [06 Clipboard](06-clipboard.html) · [07 Themes](07-themes.html) · [09 macOS integration](09-macos.html) · [FEATURES.md](FEATURES.md) · [TYPOGRAPHY.md](TYPOGRAPHY.md)
