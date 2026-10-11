// Async tab width for Source from `.editorconfig` under the indexed root (MARXY-239).

import type { Shell } from '@marxy/shell-api';
import { isUntitled } from '../document/untitled.ts';
import { appHandle } from '../commands/app-handle.ts';
import { rootFor } from '../index/walk.ts';
import { createEditorConfigCache, fallbackRoot, resolveTabWidth } from './editorconfig.ts';

export interface TabWidthResolver {
  readonly indexedRoot: string;
  readonly readText: (path: string) => Promise<string>;
}

let resolver: TabWidthResolver | null = null;
/** One walk per directory per session (V-16). */
const cache = createEditorConfigCache();
let applying = 0;
const roots = new Map<string, string>();

const MARKDOWN = /\.(md|markdown|mdown|mkd|mdx)$/i;

/** Rendered's `tab-size` and hang read this one property; a Markdown fence keeps the default 4. */
async function applyTabWidth(width: number | null): Promise<void> {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Nothing was set and nothing is: leave the document untouched (a Markdown page's layout is not disturbed).
  if ((width === null || width === 4) && !root.style.getPropertyValue('--marxy-tab-size')) return;
  if (width === null || width === 4) root.style.removeProperty('--marxy-tab-size');
  else root.style.setProperty('--marxy-tab-size', String(width));
  // Loaded on demand: the highlighter stays out of the startup graph (MARXY-33).
  const { reindentLines } = await import('../render/highlight.ts');
  reindentLines(document);
}

export async function updateTabWidthResolver(filePath: string, shell: Pick<Shell, 'readFile'> & Partial<Pick<Shell, 'readDir'>>): Promise<void> {
  if (isUntitled(filePath)) {
    applying++;
    await applyTabWidth(null);
    return;
  }
  // Without readDir the root is the file's own folder: never walk up blind.
  // The indexed root is the nearest `.git` ancestor (ADR-0012): the walk never reads above it.
  let indexedRoot = roots.get(filePath);
  if (indexedRoot === undefined) {
    try {
      indexedRoot = 'readDir' in shell ? await rootFor(shell as Parameters<typeof rootFor>[0], filePath) : fallbackRoot(filePath);
    } catch {
      indexedRoot = fallbackRoot(filePath);
    }
    roots.set(filePath, indexedRoot);
  }
  const readText = async (path: string): Promise<string> => new TextDecoder().decode(await shell.readFile(path));
  resolver = { indexedRoot, readText };
  const mine = ++applying;
  const width = MARKDOWN.test(filePath) ? null : await resolveTabWidth(filePath, indexedRoot, readText, cache);
  if (mine === applying) await applyTabWidth(width);
  // The focused pane's editor (D-11), when it shows this file: another pane's is not this file's.
  const { activeSourceEditor, reconfigureTabSize } = await import('./editor.ts');
  const editor = activeSourceEditor();
  if (editor && editor.buffer.path === filePath) await reconfigureTabSize(editor.view, filePath);
}

export async function tabSizeForFile(path: string): Promise<number> {
  // No folder, no .editorconfig (E-13).
  if (isUntitled(path)) return 4;
  if (!resolver && typeof window !== 'undefined') {
    // No document has been rendered yet (Source opened first): the running app's shell reads `.editorconfig`.
    const shell = appHandle()?.shell;
    if (shell) updateTabWidthResolver(path, shell);
  }
  if (!resolver) return 4;
  return resolveTabWidth(path, resolver.indexedRoot, resolver.readText, cache);
}
