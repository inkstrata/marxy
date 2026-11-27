// Async tab width for Source from `.editorconfig` under the indexed root.

import type { Shell } from '@marxy/shell-api';
import { isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { isUntitled as isScratch } from '../document/untitled.ts';

/** No folder, so no `.editorconfig`: a scratch document or an archive's entry, which is in memory. */
const isUntitled = (path: string): boolean => isScratch(path) || isArchiveEntry(path);
import { appHandle } from '../commands/app-handle.ts';
import { rootFor } from '../index/walk.ts';
import { createEditorConfigCache, fallbackRoot, resolveMaxLineLength, resolveTabWidth } from './editorconfig.ts';

export interface TabWidthResolver {
  readonly indexedRoot: string;
  readonly readText: (path: string) => Promise<string>;
}

let resolver: TabWidthResolver | null = null;
/** One walk per directory per session. */
const cache = createEditorConfigCache();
let applying = 0;
const roots = new Map<string, string>();

/** Rendered's `tab-size` and hang read this one property; a Markdown fence keeps the default 4. */
async function applyTabWidth(width: number | null): Promise<void> {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Nothing was set and nothing is: leave the document untouched (a Markdown page's layout is not disturbed).
  if ((width === null || width === 4) && !root.style.getPropertyValue('--marxy-tab-size')) return;
  if (width === null || width === 4) root.style.removeProperty('--marxy-tab-size');
  else root.style.setProperty('--marxy-tab-size', String(width));
  // Loaded on demand: the highlighter stays out of the startup graph.
  const { reindentLines } = await import('../render/highlight.ts');
  reindentLines(document);
}

export async function updateTabWidthResolver(
  filePath: string,
  shell: Pick<Shell, 'readFile'> & Partial<Pick<Shell, 'readDir'>> & { markOpened?(path: string, as?: 'file' | 'root' | 'indexRoot'): Promise<void> },
): Promise<void> {
  if (isUntitled(filePath)) {
    applying++;
    await applyTabWidth(null);
    return;
  }
  // Without readDir the root is the file's own folder: never walk up blind.
  // The indexed root is the nearest `.git` ancestor: the walk never reads above it.
  let indexedRoot = roots.get(filePath);
  if (indexedRoot === undefined) {
    try {
      if ('readDir' in shell) {
        indexedRoot = await rootFor(shell as Parameters<typeof rootFor>[0], filePath);
      } else {
        indexedRoot = fallbackRoot(filePath);
      }
    } catch {
      indexedRoot = fallbackRoot(filePath);
    }
    roots.set(filePath, indexedRoot);
  }
  // Marked on every call, not once: the index may have let this root go since, and a refused read is cached as a missing file.
  if ('readDir' in shell) await shell.markOpened?.(indexedRoot, 'indexRoot').catch(() => undefined);
  const readText = async (path: string): Promise<string> => new TextDecoder().decode(await shell.readFile(path));
  resolver = { indexedRoot, readText };
  const mine = ++applying;
  const width = isMarkdownPath(filePath) ? null : await resolveTabWidth(filePath, indexedRoot, readText, cache);
  if (mine === applying) await applyTabWidth(width);
  // The focused pane's editor, when it shows this file: another pane's is not this file's.
  const { activeSourceEditor, reconfigureTabSize, refreshColumnGuide } = await import('./editor.ts');
  const editor = activeSourceEditor();
  if (editor && editor.buffer.path === filePath) {
    await reconfigureTabSize(editor.view, filePath);
    // The guide follows the same file's `max_line_length`.
    await refreshColumnGuide(editor.view, filePath);
  }
}

export async function tabSizeForFile(path: string): Promise<number> {
  // No folder, no .editorconfig.
  if (isUntitled(path)) return 4;
  if (!resolver && typeof window !== 'undefined') {
    // No document has been rendered yet (Source opened first): the running app's shell reads `.editorconfig`.
    const shell = appHandle()?.shell;
    if (shell) updateTabWidthResolver(path, shell);
  }
  if (!resolver) return 4;
  return resolveTabWidth(path, resolver.indexedRoot, resolver.readText, cache);
}

/**
 * The file's `.editorconfig` `max_line_length`, for the Source column guide, or null: none given, no folder, or the
 * folder's `.editorconfig` has not been read yet (the read that finishes it refreshes the guide).
 */
export async function maxLineLengthForFile(path: string): Promise<number | null> {
  if (isUntitled(path) || !resolver) return null;
  return resolveMaxLineLength(path, resolver.indexedRoot, resolver.readText, cache);
}
