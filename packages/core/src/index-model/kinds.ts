// Extension allow-list (ADR-0012); the table itself lives in file-types.ts (V-09).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { fileTypeOf } from './file-types.ts';
import { basename } from './paths.ts';

/** Lowercase extension without the dot, or `''` when the name has none. */
export function extensionOf(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i + 1).toLowerCase();
}

/**
 * Classifies a path into an index kind, or `undefined` when the allow-list rejects it.
 * Binaries drop out here: they have no listed extension.
 */
export function classify(path: string): IndexEntry['kind'] | undefined {
  const type = fileTypeOf(path);
  return type?.indexed ? type.kind : undefined;
}
