// Async tab width for Source from `.editorconfig` under the indexed root (MARXY-239).

import type { Shell } from '@marxy/shell-api';
import { appHandle } from '../commands/app-handle.ts';
import { indexedRootForDocument, resolveTabWidth } from './editorconfig.ts';

export interface TabWidthResolver {
  readonly indexedRoot: string;
  readonly readText: (path: string) => Promise<string>;
}

let resolver: TabWidthResolver | null = null;

export async function updateTabWidthResolver(filePath: string, shell: Pick<Shell, 'readFile'>): Promise<void> {
  const indexedRoot = indexedRootForDocument(filePath);
  resolver = {
    indexedRoot,
    readText: async (path) => {
      const bytes = await shell.readFile(path);
      return new TextDecoder().decode(bytes);
    },
  };
  const { reconfigureTabSize } = await import('./editor.ts');
  const { EditorView } = await import('@codemirror/view');
  const dom = document.querySelector<HTMLElement>('#marxy-source .cm-editor');
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (view) await reconfigureTabSize(view, filePath);
}

export async function tabSizeForFile(path: string): Promise<number> {
  if (!resolver && typeof window !== 'undefined') {
    // No document has been rendered yet (Source opened first): the running app's shell reads `.editorconfig`.
    const shell = appHandle()?.shell;
    if (shell) updateTabWidthResolver(path, shell);
  }
  if (!resolver) return 4;
  return resolveTabWidth(path, resolver.indexedRoot, resolver.readText);
}
