# ADR-0059 — Token contract v2: surface, status and face roles, re-scoped per kind with no second family

- **Status:** proposed
- **Date:** 2026-10-10
- **Amends:** ADR-0008 (the contract version moves to 2; a theme may scope tokens to a kind) and
  ADR-0031 (the contract gains the names below; it is still names, kinds and meanings, never values).
  Builds on ADR-0024 (additive tokens carry a default), ADR-0030 (the grid unit is half the line box),
  ADR-0033 (measure from the average character) and ADR-0055 (the find edge, 3:1).
- **Evidence:** [`docs/plan/direction-2026-10/03-kinds-and-the-look.md`](../plan/direction-2026-10/03-kinds-and-the-look.md)
  §Token contract v2, §Themes can restyle any kind and §Per-language colour;
  [`06-reconciliation.md`](../plan/direction-2026-10/06-reconciliation.md) (Night and Paper are the
  defaults, `article` is the default kind); the mockup's `mock-v2/shared/tokens.css`, `07-themes.md`
  §Token reference and `TYPOGRAPHY.md`; [`docs/research/reader-typography/`](../research/reader-typography/10-spec.md)
  (`10-spec.md` §Contrast, `09-color-access.md`).

## Context

Contract v1 (`packages/theme/src/tokens.css`) has 18 colour tokens, three families and no role for
anything a reader summons: the palette, the verb menu, notices and the workspace panels. The palette
and outline already reach for names the contract never declared (`--marxy-color-surface`,
`--marxy-color-border`, `--marxy-color-accent-muted`, each with a hard-coded fallback). The direction
adopts Galley's role-based palette and its type sets (03, §What Marxy adopts), and makes a document's
kind a scope a theme can restyle. Galley does that with a second family of `--k-*` tokens. Three
stories wait on the names: H-02 (the contrast gate), H-03 (the tokens and the validator) and H-04
(Night and Paper). Under ADR-0031 a name, kind or meaning changes only by ADR; this is that ADR. It
sets no value: values are taste (ADR-0031) and land in H-04.

## Decision

1. **Contract v2 adds 27 theme-settable names** (the tables below) and changes no v1 name, kind or
   meaning. Every name has one kind from `scripts/check-tokens.mjs` (`length`, `number`, `colour`,
   `family`, `ratio`, `keyword`), one meaning, and a **v1 fallback**: the v1 token, or the literal
   where v1 had nothing, that it takes when a theme does not set it.

2. **A fallback is CSS, not loader code.** In `tokens.css` each v2 name is declared as
   `var(<its v1 fallback>)` (or the literal), with its meaning in a comment as ADR-0031 requires. A v1
   theme that sets `--marxy-color-text` therefore gets a `--marxy-color-text-strong` of its own text
   colour, not Marxy's. The default theme's real v2 values move into Night and Paper (H-04). The
   declared kind is what `check-tokens` infers from that declaration, so `--marxy-face-chrome`'s
   literal is `system-ui, sans-serif` (a comma reads as `family`) and `--marxy-shadow-surface`'s is
   `none` (`keyword`).

3. **Colour roles** (kind `colour`; set per variant, dark on `:root`, light under
   `[data-marxy-variant="light"]`, as today):

   | Name | Meaning | v1 fallback |
   | --- | --- | --- |
   | `--marxy-color-surface` | Ground of every summoned surface: palette, verb menu, notices, workspace panels | `--marxy-color-notice` |
   | `--marxy-color-surface-glass` | Translucent surface where the platform draws vibrancy; Reduce transparency replaces it with the surface | `--marxy-color-surface` |
   | `--marxy-color-text-strong` | Headings and bold | `--marxy-color-text` |
   | `--marxy-color-text-faint` | Section labels, counts, line numbers; still text, never decoration | `--marxy-color-text-secondary` |
   | `--marxy-color-rule-strong` | A stronger decorative line: keycaps, switch tracks, a surface's outline | `--marxy-color-rule` |
   | `--marxy-color-edge` | The boundary of a control: field, button, switch, focusable row | `--marxy-color-text-secondary` |
   | `--marxy-color-accent-strong` | The accent pressed or emphasised | `--marxy-color-accent` |
   | `--marxy-color-accent-fg` | Text and icons on an accent fill | `--marxy-color-bg` |
   | `--marxy-color-accent-wash` | Translucent accent fill: the active row, an on button, a chip | `--marxy-color-selection` |
   | `--marxy-color-status-ok` | Status text and marks for success; always with a word and an icon | `--marxy-color-text` |
   | `--marxy-color-status-warn` | The same, for a warning | `--marxy-color-text` |
   | `--marxy-color-status-err` | The same, for an error | `--marxy-color-text` |
   | `--marxy-color-status-info` | The same, for information | `--marxy-color-accent` |
   | `--marxy-color-status-ok-wash` | Fill behind a success notice or row | `--marxy-color-notice` |
   | `--marxy-color-status-warn-wash` | Fill behind a warning | `--marxy-color-notice` |
   | `--marxy-color-status-err-wash` | Fill behind an error | `--marxy-color-notice` |
   | `--marxy-tok-marker` | Markdown syntax markers in Source (`#`, `*`, `>`, fences) | `--marxy-tok-punctuation` |
   | `--marxy-tok-heading` | Markdown heading text in Source | `--marxy-color-code-text` |
   | `--marxy-tok-link` | Link text and destinations in Source | `--marxy-color-link` |

   Reasons, one line each:
   - *The three accent siblings are strong, fg and wash*: the three the mock's audit names, and the
     only accent states the mock's chrome draws; the mock's lighter second wash is the wash mixed
     half-way to transparent by Marxy, not a fourth name.
   - *Four statuses, three washes*: an info notice sits on the plain surface in the mock (it has no
     `--info-wash`), and a wash nobody draws is a name nobody can test.
   - *Status keeps Galley's short names* (`ok`, `warn`, `err`, `info`), so the import mapping and the
     mock read one to one.
   - *Each fallback is chosen to pass its floor whenever v1 already passes*: edge from secondary text
     (4.5:1 implies 3:1), accent-fg from the ground (contrast is symmetric, and the accent is 4.5:1
     on it), accent-wash from the selection (body text is already held to 4.5:1 on it), statuses
     from body text (the word carries the meaning, so a v1 theme's notice is plain and legible).

4. **Shadow** (kind `keyword`, a `box-shadow` value): `--marxy-shadow-surface`, the elevation under a
   summoned surface; v1 fallback `none`, because v1 drew no shadow. A shadow is never a surface's only
   boundary: the outline (`--marxy-color-rule-strong`) or the ground's difference is.

5. **Face roles** (kind `family`): the type set. A role names what a face sets, not what it looks
   like, except where one form has one role.

   | Name | Meaning | v1 fallback |
   | --- | --- | --- |
   | `--marxy-face-book` | Long-form serif for books | `--marxy-font-text` |
   | `--marxy-face-article` | Editorial face for articles, the default kind | `--marxy-font-text` |
   | `--marxy-face-sans` | Reports, docs, transcripts, notes, changelogs | `--marxy-font-text` |
   | `--marxy-face-readme` | READMEs | `--marxy-font-text` |
   | `--marxy-face-mono` | Code, data, logs, terminal output, and code inside prose | `--marxy-font-mono` |

   - *`--marxy-face-article` exists*: `article` is the default kind (06, row 7), and the default type
     set gives it a face of its own (Source Serif 4 beside Literata for books); without the role a type
     set could not set the default kind's face once.
   - *03's `--marxy-face-serif` is named `--marxy-face-book`*: with two serif roles "the serif" is
     ambiguous, and the Hyperlegible and Typewriter sets fill it with a sans and a mono.
   - *The v1 families keep their meaning as slots.* `--marxy-font-text`, `--marxy-font-heading` and
     `--marxy-font-mono` are still the face the text is set in; a kind scope points a slot at a role
     (`--marxy-font-text: var(--marxy-face-sans)`). Every face role falls back to a slot, so a v1
     theme sets every kind in its one text face, exactly as it renders today.

6. **Chrome**: `--marxy-face-chrome` (kind `family`; the face of controls on summoned surfaces;
   fallback `system-ui, sans-serif`) and `--marxy-size-chrome` (kind `length`, px; the size of control
   text; fallback `13px`). *The platform face at 13 px* is the mock's and 03's rule. No v1 token carried
   chrome (it inherited the text face), so both fall back to literals.
   - *The other control sizes are ratios of the chrome size*, set by Marxy and not further names:
     section labels `calc(var(--marxy-size-chrome) * 11 / 13)` and status text
     `calc(var(--marxy-size-chrome) * 11.5 / 13)` (11 and 11.5 px at 13, as the mock draws them).
   - *The reader owns the chrome size* (lead ruling for this proposed record; the author may overturn
     it). A reader setting in `config.toml`, `chrome_size`, sets `--marxy-size-chrome` on `:root`,
     within 11–26 px (200 % of 13, WCAG 1.4.4); unset, the theme's value stands, and a theme sets only
     that default, clamped to the same range. The reader's type set and text size do not move it: they
     style the text being read (`TYPOGRAPHY.md`), and the chrome size is its own setting.
   - *The trade:* a chrome larger than the platform's 13 px no longer matches macOS controls and costs
     the unfolded workspace room. Resolved toward the reader (ADR-0049, the reader owns their tools):
     a reader who needs larger controls cannot wait on a theme author to ship one.

7. **The kind scope.** K-05 sets `data-marxy-kind="<kind>"` on each pane root; the kinds are K-01's
   (ADR-0060). Inside `[data-marxy-kind="…"]`, alone or with `[data-marxy-variant="…"]`, a theme sets
   the same `--marxy-*` names to other values. There is no `--k-*` family.

   | | Names |
   | --- | --- |
   | **May be set per kind** | Every colour role except the surface three below; every `--marxy-tok-*`; the slots (`--marxy-font-text`, `-heading`, `-mono`) and the face roles; `--marxy-size-body`, `-code`, `-caption`, `--marxy-line-box`, `--marxy-line-box-code`, `--marxy-lh-h1`, `--marxy-lh-h2`, **only as multiples of the reader's values** (below); `--marxy-scale-ratio`; `--marxy-measure-chars`, `--marxy-avg-char`; the weights and `--marxy-tracking-heading`, `--marxy-opsz-auto`; `--marxy-justify`; the code and quote presentation knobs |
   | **Global only** (`:root` and the variant) | `--marxy-color-surface`, `--marxy-color-surface-glass`, `--marxy-shadow-surface`; `--marxy-face-chrome`, `--marxy-size-chrome` (the reader's setting wins, item 6); `--marxy-color-divider`, `--marxy-color-divider-focus`, `--marxy-divider-hit`; `--marxy-progress-rule`; `--marxy-typeset` |
   | **Never set by a theme** | `--marxy-weight-offset`, `--marxy-measure` (computed), `--marxy-lang` (item 8), the root copies of the reader's sizes (below), and every derived spacing (the half line, heading space above and below) |

   - *Surfaces, chrome and dividers are global* because a summoned surface is one object wherever it is
     summoned, the palette sits above every pane, and a divider lies between two panes of different
     kinds.
   - *The reader's size wins.* The reader's text size writes `--marxy-size-body`, `--marxy-line-box`,
     `--marxy-size-code` and `--marxy-line-box-code` on `:root` (`applyReaderConfig`,
     `apps/desktop/src/theme/reader-config.ts`). A kind scope that set them in px would override the
     size the reader chose (ADR-0049, WCAG 1.4.4). So inside a kind scope these, and `-size-caption`,
     `-lh-h1` and `-lh-h2`, are written only as a multiple of the reader's root value: a unitless ratio
     (`--marxy-size-body: 0.85`) or the same ratio in `em`; the theme loader compiles both forms, so
     no raw `em` reaches the DOM (an `em` there would resolve against the element's own font size).
     Because a custom property cannot refer to itself, H-03 compiles the ratio to
     `calc(<ratio> * var(<root copy>))`. The root copies are declared in `tokens.css` on `:root` as
     `var(<original>)`, for example `--marxy-root-size-body: var(--marxy-size-body)` (kind `length`),
     so each holds whatever wins on `:root`: the reader's inline value, the theme's, or the default.
     `applyReaderConfig` is unchanged (at the default size it writes nothing, so a copy it wrote would
     not exist). The copies are system-owned, counted apart from the 27, and the validator drops a
     theme that sets one, as it drops `--marxy-weight-offset`.
     The validator clamps the ratio to the range the root value is clamped to, and rejects an absolute
     length in a kind scope with a warning naming the token and the kind.
   - *The line box may be set per kind; the grid may not.* A pane has one kind, so it has one line box
     and one grid: the unit is half of that pane's line box (ADR-0030), every vertical space is a
     multiple of it, and the multiples stay system-owned (03: "A kind scope can set the line box, never
     the multiples"). Two panes of different kinds have different grids, which is sound because each
     pane scrolls on its own and a split shares no baselines (ADR-0057 item 4). A per-kind line box,
     once multiplied, is rounded to an even whole pixel (ADR-0030; 06, row 9), so the unit is whole.
   - *A kind's measure takes effect.* `--marxy-measure` is computed on `:root` today (`tokens.css`), so a
     per-kind `--marxy-measure-chars` or `--marxy-avg-char` would change nothing below it. H-03 moves
     the `--marxy-measure` computation to the article and pane scope, so it is evaluated where the
     kind's values are; the two names stay per-kind.
   - *The validator clamps per kind exactly as at `:root`* (H-03): the measure to 45–80 characters in
     kinds that reflow (which kinds reflow is K-01's), the line box even and within its bounds, and a
     global-only name set inside a kind scope is dropped with a warning naming it.
   - *A derived default resolves where it is declared.* A kind scope that changes a v1 token does not
     move a v2 role derived from it on `:root`; the scope sets both. This bites no v1 theme, since
     v1 themes have no kind scopes.
   - *A slot pointed at a role needs the role set, on `:root`.* `tokens.css` declares the roles as the
     slots, so a theme that writes `--marxy-font-text: var(--marxy-face-sans)` on `:root` without
     setting `--marxy-face-sans` makes a cycle; the validator reports it as a theme error (H-03), on
     `:root` only. Inside a kind scope the same line is valid: `--marxy-face-sans` there inherits the
     value already resolved on `:root`, so nothing refers back to itself.

8. **Per-language colour.** `data-marxy-lang="<id>"` (a lowercase language id from the Linguist-derived
   table K-19 ships) marks an element whose text is code in one language: a rendered code block, the
   Source editor root, a file row. Marxy sets `--marxy-lang` (kind `colour`, system-owned, like
   `--marxy-weight-offset`) on it to the brand colour, lightness-walked to pass (03, §Per-language
   colour). Inside `[data-marxy-lang="…"]` a theme may set only `--marxy-tok-*`; grounds and text roles
   stay the kind's. K-19 declares `--marxy-lang`; both attribute names are reserved now in
   `scripts/registry.json` so the registry is touched once.

9. **The contract version is 2.** `theme.toml` says `contract = 2`, and Marxy speaks 2 from H-03.
   - A theme declaring `contract = 1` loads and renders as it does today, its v2 roles resolving to
     their v1 fallbacks through item 2. The loader keeps ADR-0008's warning, worded for the case:
     *"Theme '<name>' targets contract 1; its contract-2 roles use their fallbacks."*
   - A theme declaring `contract = 2` that leaves a v2 colour role unset in a variant also loads, with a
     warning naming each unset role; the fallback is used. Every bundled theme sets every role, and
     the contrast gate fails one that does not.
   - A contract above 2 keeps today's warning.
   - *Why a version bump for an additive change*, when ADR-0024 and ADR-0055 added tokens inside v1:
     the kind scope and the face roles change what a complete theme is, and the number tells the
     loader and the gate whether to expect the roles or the fallbacks.

10. **Contrast floors** (WCAG 2.2, unrounded, translucent colours composited over their ground first,
    in every variant and every kind scope; `09-color-access.md`, `10-spec.md` §Contrast). H-02 gates
    these.

    | Role | Floor | Against |
    | --- | --- | --- |
    | `--marxy-color-text` | 7:1 | `-bg` |
    | `--marxy-color-text`, `-text-strong` | 4.5:1 | `-surface`, `-code-bg`, `-selection`, `-find`, `-find-current`, `-accent-wash`, each status wash, each diff tint |
    | `--marxy-color-text-strong` | 7:1 | `-bg` |
    | `--marxy-color-text-secondary`, `-text-faint` | 4.5:1 | every ground they appear on: `-bg`, `-surface`, `-code-bg`, `-accent-wash`, `-selection`, `-find`, `-find-current` |
    | `--marxy-color-accent`, `-link`, `-accent-strong` | 4.5:1 | `-bg`, `-surface`, `-accent-wash` |
    | `--marxy-color-accent-fg` | 4.5:1 | `-accent`, `-accent-strong` |
    | each `--marxy-color-status-*` colour | 4.5:1 | `-bg`, `-surface`, its own wash |
    | every `--marxy-tok-*`, `-code-text` | 4.5:1 | `-code-bg`, `-bg`, `-selection` composited over `-code-bg`, the current-line ground (Source's active line, today the selection mixed 40 % toward transparent over `-code-bg`; derived, not a token), each diff tint |
    | `--marxy-color-edge`, `-find-edge`, `-divider-focus` | 3:1 | `-bg`, `-surface`, `-code-bg` |
    | `--marxy-color-surface-glass` | as `-surface`, once composited over `-bg` | |
    | `--marxy-color-rule`, `-rule-strong`, `-divider`, `-quote-rule`; the washes, tints and fills themselves; the shadow | none (decorative, or a ground judged by what sits on it) | |

    The large-text allowance (3:1 for text of about 24 px, or 18.7 px bold) is used by no role: a role
    does not know the size it is drawn at, so it meets the floor of the smallest text it sets.

## Consequences

- H-03 adds the 27 names to `tokens.css` as item 2 describes, regenerates `tokens.contract.json`
  with `node scripts/check-tokens.mjs --write`, teaches the loader contract 2 (item 9) and the
  validator the kind scope (item 7). H-04 sets Night's and Paper's values. H-02 builds
  `scripts/gate-contrast.mjs` from item 10. K-05 sets `data-marxy-kind`; K-19 sets
  `data-marxy-lang` and declares `--marxy-lang`.
- The three undeclared names the palette and outline use today are retired, and **H-03 repoints
  them**: `--marxy-color-surface` becomes a declared role; `--marxy-color-border` becomes
  `--marxy-color-edge` where it bounds a control and `--marxy-color-rule-strong` where it outlines a
  surface; `--marxy-color-accent-muted` becomes `--marxy-color-accent-wash`. Declaring `-surface`
  drops the `#1a1a1a` fallback the palette and outline paint today (`palette/view.ts`,
  `outline/view.ts`), so their ground moves to `-notice`'s value. `-border` (`#444`) and
  `-accent-muted` (white at 8 %) are wrong in the light variant today; H-03 fixes both by the repoint.
- H-03 declares `--marxy-size-chrome` and the root copies of the reader's sizes, compiles the
  ratios (item 7), and moves the measure computation to the pane scope (item 7). The reader's
  `chrome_size` setting (item 6) reaches the `config.toml` parser, `reader-config.ts` and
  `app-config.ts`, so it is its own story, H-07, with its control on W-12's settings page.
- Until H-03 lands, the names are reserved by this record, not by a machine: the registry holds only
  `tokenPrefix`, and `check-tokens` fails any name added to `tokens.css` without its snapshot.
- `docs/theme-contract.md` lists the roles as decided and not yet shipped, and stops saying version 1
  once H-03 ships.
- The contract grows by 27 names, not by a copy of itself per kind; a theme author learns one set.

## Rejected

- **A `--k-*` family per kind** (Galley's, and the mock's `--k-face`, `--k-size`, `--k-leading`). It
  doubles the contract, splits every role into a global and a per-kind name, and gives the validator
  and the contrast gate two sets to walk. A kind is a scope; the mock's `--k-*` is prototype plumbing.
- **Two accent washes** (`--accent-wash` and `--accent-wash-strong`): the lighter one appears only
  behind chips and footnote markers, where the contrast-checked wash mixed half-way to transparent
  does the same work.
- **An info wash, and hover and press tokens.** Nothing draws the first; the mock derives the other two
  from the text colour, and Marxy does the same in its chrome stylesheet.
- **Four face roles without `article`**, as 03's table had: the default kind would share a face with
  books or need a per-kind override in every type set.
- **Chrome face and size as constants**: a reader with low vision could not enlarge the controls.
- **Chrome size owned by the theme alone** (this record's first draft): the reader would need a theme
  author's help to read the controls.
- **Absolute lengths for sizes in a kind scope**: they override the reader's chosen size.
- **A global line box**: report, article and code are set at different leadings (`TYPOGRAPHY.md`), which
  is most of what a kind is for.
- **Staying at contract 1**: legal under ADR-0024, but the loader and the gate could not tell a theme
  that chose the fallbacks from one written before the roles existed.
- **The mock's layout names** (`--win`, `--side`, `--side-w`, `--tb-h`, `--sb-h`), its radii and its
  `--swatch`: Marxy has no window chrome to colour, the radii are chrome geometry no theme restyles,
  and a theme's swatch is drawn from its ground.

## How we would know this was wrong

- H-04 needs a name not here to make Night or Paper pass the gate (a fourth accent state, an info
  wash, a second surface), or needs a global-only name per kind.
- A v1 theme fixture renders differently once H-03 lands, beyond the chrome face and the palette and
  outline ground (which moves off its hard-coded `#1a1a1a`, as Consequences says): the fallbacks
  were meant to make that impossible.
- A fallback fails its floor in a v1 theme whose v1 tokens pass theirs.
- Theme authors write kind scopes that set a token per kind and find it ignored, often enough that the
  global-only list reads as an obstacle rather than a guarantee.
