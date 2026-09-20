// Maps --marxy-* custom properties to a CodeMirror 6 theme (§09).

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Theme extension reading marxy tokens from the document root. */
export function marxyCodeMirrorTheme(): Extension {
  const bg = cssVar('--marxy-color-code-bg', '#1d1c19');
  const text = cssVar('--marxy-color-code-text', '#e3dfd6');
  const accent = cssVar('--marxy-color-accent', '#8fb4dd');
  const selection = cssVar('--marxy-color-selection', '#2a4a6e');
  const mono = cssVar('--marxy-font-mono', 'JetBrains Mono, ui-monospace, monospace');
  const size = cssVar('--marxy-size-code', cssVar('--marxy-size-body', '17px'));

  return EditorView.theme(
    {
      '&': {
        color: text,
        backgroundColor: bg,
        fontFamily: mono,
        fontSize: size,
      },
      '.cm-content': { caretColor: accent },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: `${selection} !important`,
      },
      '.cm-activeLine': { backgroundColor: `${selection}33` },
      '.cm-gutters': {
        backgroundColor: bg,
        color: cssVar('--marxy-color-text-secondary', '#a39e94'),
        border: 'none',
      },
    },
    { dark: true },
  );
}
