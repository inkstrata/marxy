// Source gutter defaults and the remembered toggle (config.toml `line_numbers`, L-06.1) (reader-artifacts handbook §04).

import { fileTypeForExtension } from '@marxy/core/src/index-model/file-types.ts';
import { extensionOf } from './default-mode.ts';

export function defaultLineNumbersForPath(path: string): boolean {
  // The Markdown and text families read as prose, so no gutter; a name with no extension keeps it.
  const kind = fileTypeForExtension(extensionOf(path).slice(1))?.kind;
  return kind !== 'markdown' && kind !== 'text';
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
