// Open the document in the reader's external editor at the current line (docs/design/09-app-shell.md
// §Open in external editor, D-A31). A-16.
import { lineOf } from '@marxy/core';
import type { AppShell } from '../app.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

type EditorShell = AppShell & { revealInExternalEditor?(path: string, line?: number): Promise<void> };

/** A file on disk: not the bundled pieces and About, which live at `marxy:` paths. */
function editablePath(): string | null {
  const path = appHandle()?.currentPath() ?? null;
  return path && !path.startsWith('marxy:') ? path : null;
}

/** 1-based: the cursor's line in Source, the reading position's line in Rendered. */
async function currentLine(): Promise<number | undefined> {
  const handle = appHandle();
  const harness = handle?.sourceHarness();
  if (!handle || !harness) return undefined;
  if (harness.mode === 'source') {
    const { activeSourceEditor } = await import('../source/editor.ts');
    const state = activeSourceEditor()?.view.state;
    if (state) return state.doc.lineAt(state.selection.main.head).number;
  }
  const open = handle.openDocument();
  return open ? lineOf(open.buffer, harness.byteOffset) : undefined;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

function reasonOf(err: unknown): string {
  const text =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
  return text.replace(/[.\s]+$/, '') || 'unknown error';
}

export function editorCommands(): readonly Command[] {
  return [
    {
      id: 'document.open-in-editor',
      title: 'Open in external editor',
      key: 'Mod+Shift+E',
      global: true,
      group: 'document',
      when: () => editablePath() !== null,
      run: async (ctx) => {
        const path = editablePath();
        const shell = appHandle()?.shell as EditorShell | undefined;
        if (!path || !shell) return;
        const line = await currentLine();
        try {
          if (typeof shell.revealInExternalEditor !== 'function') throw new Error('this build has no external editor');
          // Only the path and the line leave the webview; the program is Rust's to choose (D-A31).
          await shell.revealInExternalEditor(path, line);
        } catch (err) {
          ctx.showNotice(`Could not open ${baseName(path)} in the external editor: ${reasonOf(err)}.`);
        }
      },
    },
  ];
}
