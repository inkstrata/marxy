// Maps --marxy-* custom properties to a CodeMirror 6 theme (§09, L-06, V-12).
//
// Colours, sizes and spacing are written as `var(--marxy-*)` so Source reads the same contrast-audited
// tokens as Rendered and follows a variant or size change without a rebuild. What a stylesheet cannot
// carry (CodeMirror's light/dark base theme) is re-applied through a compartment the moment the root
// changes, on the same editor: no remount, so selection and undo stay.
//
// Source has metrics of its own (ADR-0067): it holds no prose, so it leaves the prose grid for a tighter
// type and line (`--marxy-size-source` on `--marxy-line-box-source`), an exact gutter hung left of the text,
// and, for a code file, lines that scroll instead of wrap. The in-place block editor (ADR-0048) is an
// island inside Rendered's page and keeps Rendered's code metrics, which is the `island` look below.

import { Compartment, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** Whether the reader is currently on the light variant (ADR-0024; dark is the default). */
function isLightVariant(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-marxy-variant') === 'light';
}


/** Which look the editor wears: a code file or prose in Source (V-12), or the block editor inside Rendered's page. */
export type SourceLook = 'code' | 'prose' | 'island';

// The grid unit is half a line box (ADR-0030). The island pads in these, never in raw px.
const UNIT = 'calc(var(--marxy-line-box, 30px) / 2)';

// Source's own metrics (ADR-0067), the tokens with their default values as the fallback.
const SIZE = 'var(--marxy-size-source, 14px)';
const LINE = 'var(--marxy-line-box-source, 21px)';

/** Digits the number column always has room for, so a file of up to 99 999 lines never moves its text. */
const DIGITS = 5;
/** The gutter's whole width: a fold column of one line box, then the numbers, with half a line box each side. */
const GUTTER = `calc(${DIGITS}ch + 2 * ${LINE})`;

/**
 * The text column. Markdown in Source is as wide as Rendered's measure, in pixels
 * (`--marxy-measure-chars` clamped to 45..80, times the average advance, times the body size); a code file's is
 * 100 characters of the mono face at Source's size (ADR-0067).
 */
const PROSE_COLUMN = 'calc(clamp(45, var(--marxy-measure-chars, 66), 80) * var(--marxy-avg-char, 0.463) * var(--marxy-size-body, 20px))';
const CODE_COLUMN = '100ch';

/** The rules every look shares: caret, selection, find matches and the search panel, read from tokens. */
function sharedRules(): Record<string, Record<string, string>> {
  const accent = 'var(--marxy-color-accent, #8fb4dd)';
  const selection = 'var(--marxy-color-selection, #1f3651)';
  const rule = 'var(--marxy-color-rule-strong, var(--marxy-color-rule, #2a2825))';
  const secondary = 'var(--marxy-color-text-secondary, #a39e94)';
  const surface = 'var(--marxy-color-surface, var(--marxy-color-notice, #1f1e1b))';
  const mono = 'var(--marxy-font-mono, "JetBrains Mono", ui-monospace, monospace)';
  const bg = 'var(--marxy-color-bg, #151412)';
  const activeLine = `color-mix(in srgb, ${selection} 40%, transparent)`;
  return {
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: `${selection} !important`,
    },
    // A pale fill cannot be 3:1 against the ground and keep every token readable, so a 2 px edge in
    // --marxy-color-find-edge carries the 3:1 (L-11); the current match adds a 2 px text-colour outline.
    '.cm-searchMatch': {
      backgroundColor: 'var(--marxy-color-find, #3a3010)',
      borderBottom: '2px solid var(--marxy-color-find-edge, #94701a)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--marxy-color-find-current, #403510)',
      outline: '2px solid var(--marxy-color-code-text, #e3dfd6)',
    },
    '.cm-panels': {
      backgroundColor: surface,
      color: 'var(--marxy-color-text, #e8e4dc)',
      borderColor: rule,
      fontFamily: mono,
    },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${rule}` },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${rule}` },
    '.cm-search': { padding: `calc(${UNIT} / 2) ${UNIT}`, fontSize: 'var(--marxy-size-caption, 15px)' },
    '.cm-search label': { color: secondary },
    '.cm-search input, .cm-search button': {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'var(--marxy-color-text, #e8e4dc)',
      backgroundColor: bg,
      backgroundImage: 'none',
      border: `1px solid ${rule}`,
      borderRadius: '2px',
    },
    '.cm-search button:hover': { backgroundColor: activeLine },
    '.cm-search input:focus-visible, .cm-search button:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: '1px' },
    '.cm-search [name=close]': { color: secondary, border: 'none', backgroundColor: 'transparent' },
  };
}

/** The look of a Source editor for a file (V-12): its own type, an exact gutter, a column on the page ground. */
function sourceRules(look: 'code' | 'prose'): Record<string, Record<string, string>> {
  const text = 'var(--marxy-color-code-text, #e3dfd6)';
  const bg = 'var(--marxy-color-bg, #151412)';
  const secondary = 'var(--marxy-color-text-secondary, #a39e94)';
  const mono = 'var(--marxy-font-mono, "JetBrains Mono", ui-monospace, monospace)';
  const selection = 'var(--marxy-color-selection, #1f3651)';
  const activeLine = `color-mix(in srgb, ${selection} 40%, transparent)`;
  const column = look === 'prose' ? PROSE_COLUMN : CODE_COLUMN;
  // The text's start edge is `start`: centred on the window, but never closer to it than the gutter is wide. The
  // numbers hang left of that edge, in the gutter's own margin, so the edge is the same whether numbers are on or
  // off and the column stays on the window's axis (L-07). It is margins, not scroller padding, because a sticky
  // gutter stops at the scroller's content box and padding would push the numbers over the text.
  const start = `max(${GUTTER}, calc((100% - ${column}) / 2))`;
  const gutterStart = `max(0px, calc((100% - ${column}) / 2 - ${GUTTER}))`;
  const content: Record<string, string> =
    look === 'prose'
      ? { width: column, flexGrow: '0', padding: `${LINE} 0` }
      : // A code line never wraps: the content is as wide as the widest line it has drawn, and at least the column.
        { flexGrow: '0', width: 'max-content', minWidth: `max(0px, min(${column}, calc(100% - ${start} - ${LINE})))`, boxSizing: 'content-box', padding: `${LINE} ${LINE} ${LINE} 0` };
  return {
    '&': {
      color: text,
      backgroundColor: bg,
      fontFamily: mono,
      fontSize: SIZE,
      // The article's weight, so Source is 380 on the dark ground like Rendered, with the platform's offset.
      '--marxy-wght': 'calc(var(--marxy-weight-body, 380) + var(--marxy-weight-offset, 0))',
      fontWeight: 'var(--marxy-wght)',
      fontVariationSettings: "'wght' var(--marxy-wght)",
    },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: LINE },
    '.cm-content': {
      caretColor: 'var(--marxy-color-accent, #8fb4dd)',
      fontVariantLigatures: 'none',
      marginInlineStart: start,
      ...content,
    },
    // With the gutter before it the text follows the gutter, which carries the margin.
    '.cm-gutters + .cm-content': { marginInlineStart: '0' },
    // One line box a row, whatever face a run is drawn in: the number and its row share a top (V-12).
    '.cm-line': { lineHeight: LINE, padding: '0' },
    // Each run holds the same line box (the way `base.css` holds prose runs), so a run in a fallback face (emoji, CJK,
    // box drawing) cannot make its row taller. A marked special character keeps the line height of its own box.
    '.cm-line span:not(.cm-specialChar)': { lineHeight: LINE },
    // Nothing at rest (ADR-0011): the active line is tinted only while the editor has the caret.
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-activeLine': { backgroundColor: activeLine },
    '&.cm-focused .cm-activeLineGutter': { backgroundColor: activeLine },
    '.cm-gutters': {
      backgroundColor: bg,
      color: secondary,
      border: 'none',
      marginInlineStart: gutterStart,
    },
    '.cm-gutters .cm-gutter': { lineHeight: LINE },
    // CodeMirror's `.cm-lineNumbers .cm-gutterElement` (padding 0 3px 0 5px) is as specific as a single theme
    // class rule, so the exact padding is written with the whole path, in units of the line box.
    '.cm-gutters .cm-lineNumbers': { minWidth: `calc(${DIGITS}ch + ${LINE})` },
    '.cm-gutters .cm-lineNumbers .cm-gutterElement': {
      lineHeight: LINE,
      padding: `0 calc(${LINE} / 2)`,
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    },
    // With no fold column before it, the numbers keep the room it would have.
    '.cm-gutters > .cm-lineNumbers:first-child': { marginInlineStart: LINE },
    '.cm-gutters .cm-foldGutter': { width: LINE },
    '.cm-gutters .cm-foldGutter .cm-gutterElement': { lineHeight: LINE, padding: '0', textAlign: 'center', cursor: 'pointer' },
    // A fold shows its chevron when the pointer is over the gutter; a folded line always shows its marker.
    '.cm-foldGutter .marxy-fold-open': { opacity: '0' },
    '.cm-gutters:hover .marxy-fold-open': { opacity: '1' },
    // A Markdown line that wraps hangs its continuation past its own indent (the `sourceHang` plugin sets the width).
    '.marxy-source-hang': { paddingInlineStart: 'var(--marxy-hang, 0ch)', textIndent: 'calc(-1 * var(--marxy-hang, 0ch))' },
    ...sharedRules(),
  };
}

/** The block editor inside Rendered's page: Rendered's code metrics, on the prose grid, as it was before V-12. */
function islandRules(): Record<string, Record<string, string>> {
  const text = 'var(--marxy-color-code-text, #e3dfd6)';
  const bg = 'var(--marxy-color-code-bg, #1d1c19)';
  const selection = 'var(--marxy-color-selection, #1f3651)';
  const faint = 'var(--marxy-color-text-faint, var(--marxy-color-text-secondary, #a39e94))';
  const mono = 'var(--marxy-font-mono, "JetBrains Mono", ui-monospace, monospace)';
  const activeLine = `color-mix(in srgb, ${selection} 40%, transparent)`;
  return {
    '&': {
      color: text,
      backgroundColor: bg,
      fontFamily: mono,
      fontSize: 'var(--marxy-size-code, var(--marxy-size-body, 20px))',
    },
    // The island sits in the same margins Rendered has: past 100 columns of code the free width goes to
    // both sides of the gutter and text, not to a ragged right edge.
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'var(--marxy-line-box-code, 30px)',
      paddingInline: 'max(0px, calc((100% - 108ch) / 2))',
    },
    '.cm-content': {
      caretColor: 'var(--marxy-color-accent, #8fb4dd)',
      fontVariantLigatures: 'none',
      padding: `calc(${UNIT} * 2) calc(${UNIT} * 4)`,
    },
    // The code line box is two grid units; a wrapped line is a whole number of them.
    '.cm-line': { lineHeight: 'var(--marxy-line-box-code, 30px)', padding: '0' },
    '.cm-activeLine': { backgroundColor: activeLine },
    '.cm-activeLineGutter': { backgroundColor: activeLine },
    '.cm-gutters': { backgroundColor: bg, color: faint, border: 'none' },
    '.cm-gutterElement': { lineHeight: 'var(--marxy-line-box-code, 30px)', padding: `0 ${UNIT}` },
    '.cm-foldGutter .cm-gutterElement': { padding: '0', cursor: 'pointer' },
    ...sharedRules(),
  };
}

/** Theme extension reading marxy tokens from the document root. */
export function marxyCodeMirrorTheme(look: SourceLook = 'code'): Extension {
  const rules = look === 'island' ? islandRules() : sourceRules(look);
  return EditorView.theme(rules, { dark: !isLightVariant() });
}

/**
 * Hangs a wrapped line past its own indentation, by two columns (the rule `base.css` keeps for `pre`): a
 * continuation row starts under the text of its line, never at column 0, so wrapped Markdown does not read as
 * dedented. The width is the leading whitespace in columns (a tab counts to the next tab stop), capped at 40.
 */
export function sourceHang(): Extension {
  const HANG_EXTRA = 2;
  const HANG_CAP = 40;
  const cache = new Map<number, Decoration>();
  const lineAt = (columns: number): Decoration => {
    let deco = cache.get(columns);
    if (!deco) {
      deco = Decoration.line({ class: 'marxy-source-hang', attributes: { style: `--marxy-hang: ${columns}ch` } });
      cache.set(columns, deco);
    }
    return deco;
  };
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const tab = view.state.tabSize;
    let last = -1;
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        pos = line.to + 1;
        // Two visible ranges can meet on one line (a fold inside it): it is decorated once.
        if (line.from <= last) continue;
        last = line.from;
        let columns = 0;
        for (let i = 0; i < line.length; i++) {
          const ch = line.text.charCodeAt(i);
          if (ch === 0x20) columns++;
          else if (ch === 0x09) columns += tab - (columns % tab);
          else break;
        }
        builder.add(line.from, line.from, lineAt(Math.min(columns + HANG_EXTRA, HANG_CAP)));
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.startState.tabSize !== update.state.tabSize) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * The theme in `compartment`, re-applied to the same view whenever the document root's variant or
 * inline tokens (text size) change.
 */
export function liveMarxyTheme(compartment: Compartment, look: SourceLook = 'code'): Extension {
  const follow = ViewPlugin.fromClass(
    class {
      private readonly observer: MutationObserver | null;
      private queued = false;
      constructor(private readonly view: EditorView) {
        this.observer =
          typeof MutationObserver === 'undefined'
            ? null
            : new MutationObserver(() => this.schedule());
        this.observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-marxy-variant', 'style'] });
      }
      schedule(): void {
        if (this.queued) return;
        this.queued = true;
        // Not inside CodeMirror's own update cycle.
        queueMicrotask(() => {
          this.queued = false;
          if (!this.view.dom.isConnected) return;
          this.view.dispatch({ effects: compartment.reconfigure(marxyCodeMirrorTheme(look)) });
        });
      }
      destroy(): void {
        this.observer?.disconnect();
      }
    },
  );
  return [compartment.of(marxyCodeMirrorTheme(look)), follow];
}
