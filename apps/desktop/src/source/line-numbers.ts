// Source gutter defaults and the remembered toggle (config.toml `line_numbers`, L-06.1) (reader-artifacts handbook §04).

import { extensionOf } from './default-mode.ts';

const MARKDOWN = new Set(['.md', '.markdown', '.mdx', '.txt']);

export function defaultLineNumbersForPath(path: string): boolean {
  const ext = extensionOf(path);
  return !MARKDOWN.has(ext);
}

/**
 * The reader's choice for this launch: seeded from `line_numbers` in config.toml when the key is
 * present, then updated by the toggle. A cache of the file, which wins at every launch; null means
 * the key is absent and the per-path default stands.
 */
let choice: boolean | null = null;

export function setLineNumbersChoice(on: boolean | null): void {
  choice = on;
}

/**
 * `explicit === false` from the legacy app shell means “use handbook default”, not “force off”.
 * Only `explicit === true` forces the gutter on regardless of path.
 */
export function resolveLineNumbers(path: string, explicit?: boolean): boolean {
  const stored = choice;
  if (stored !== null) return stored;
  if (explicit === true) return true;
  return defaultLineNumbersForPath(path);
}
