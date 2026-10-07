// Maps --marxy-* custom properties to a CodeMirror 6 theme (§09, L-06).
//
// Colours, sizes and spacing are written as `var(--marxy-*)` so Source reads the same contrast-audited
// tokens as Rendered and follows a variant or size change without a rebuild. What a stylesheet cannot
// carry (CodeMirror's light/dark base theme) is re-applied through a compartment the moment the root
// changes, on the same editor: no remount, so selection and undo stay.

import { Compartment, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

/** Whether the reader is currently on the light variant (ADR-0024; dark is the default). */
function isLightVariant(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-marxy-variant') === 'light';
}

// The grid unit is half a line box (ADR-0030). Padding is written in these, never in raw px.
const UNIT = 'calc(var(--marxy-line-box, 30px) / 2)';

/** Theme extension reading marxy tokens from the document root. */
export function marxyCodeMirrorTheme(): Extension {
  const text = 'var(--marxy-color-code-text, #e3dfd6)';
  const bg = 'var(--marxy-color-code-bg, #1d1c19)';
  const accent = 'var(--marxy-color-accent, #8fb4dd)';
  const selection = 'var(--marxy-color-selection, #1f3651)';
  const rule = 'var(--marxy-color-rule, #2a2825)';
  const secondary = 'var(--marxy-color-text-secondary, #a39e94)';
  const mono = 'var(--marxy-font-mono, "JetBrains Mono", ui-monospace, monospace)';
  const activeLine = `color-mix(in srgb, ${selection} 40%, transparent)`;

  return EditorView.theme(
    {
      '&': {
        color: text,
        backgroundColor: bg,
        fontFamily: mono,
        fontSize: 'var(--marxy-size-code, var(--marxy-size-body, 20px))',
      },
      '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--marxy-line-box-code, 30px)' },
      '.cm-content': {
        caretColor: accent,
        fontVariantLigatures: 'none',
        padding: `calc(${UNIT} * 2) calc(${UNIT} * 4)`,
      },
      // The code line box is two grid units; a wrapped line is a whole number of them.
      '.cm-line': { lineHeight: 'var(--marxy-line-box-code, 30px)', padding: '0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: `${selection} !important`,
      },
      '.cm-activeLine': { backgroundColor: activeLine },
      '.cm-activeLineGutter': { backgroundColor: activeLine },
      '.cm-gutters': {
        backgroundColor: bg,
        color: secondary,
        border: 'none',
      },
      '.cm-gutterElement': { lineHeight: 'var(--marxy-line-box-code, 30px)', padding: `0 ${UNIT}` },
      '.cm-foldGutter .cm-gutterElement': { padding: '0', cursor: 'pointer' },
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
        backgroundColor: 'var(--marxy-color-notice, #1f1e1b)',
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
    },
    { dark: !isLightVariant() },
  );
}

/**
 * The theme in `compartment`, re-applied to the same view whenever the document root's variant or
 * inline tokens (text size) change.
 */
export function liveMarxyTheme(compartment: Compartment): Extension {
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
          this.view.dispatch({ effects: compartment.reconfigure(marxyCodeMirrorTheme()) });
        });
      }
      destroy(): void {
        this.observer?.disconnect();
      }
    },
  );
  return [compartment.of(marxyCodeMirrorTheme()), follow];
}
