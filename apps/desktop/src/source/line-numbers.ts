// Source gutter defaults and persisted toggle (reader-artifacts handbook §04).

import { extensionOf } from './default-mode.ts';

const STORAGE_KEY = 'marxy-source-line-numbers';

const MARKDOWN = new Set(['.md', '.markdown', '.mdx', '.txt']);

export function defaultLineNumbersForPath(path: string): boolean {
  const ext = extensionOf(path);
  return !MARKDOWN.has(ext);
}

export function readLineNumbersPreference(): boolean | null {
  if (typeof sessionStorage === 'undefined') return null;
  const v = sessionStorage.getItem(STORAGE_KEY);
  if (v === 'on') return true;
  if (v === 'off') return false;
  return null;
}

export function writeLineNumbersPreference(on: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
}

/**
 * `explicit === false` from the legacy app shell means “use handbook default”, not “force off”.
 * Only `explicit === true` forces the gutter on regardless of path.
 */
export function resolveLineNumbers(path: string, explicit?: boolean): boolean {
  const stored = readLineNumbersPreference();
  if (stored !== null) return stored;
  if (explicit === true) return true;
  return defaultLineNumbersForPath(path);
}
