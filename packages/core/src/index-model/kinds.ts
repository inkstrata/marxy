// The index's file classes; the table itself is the registry (`kind/registry.ts`).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { fileTypeOf } from '../kind/registry.ts';
import { basename } from './paths.ts';

/** Lowercase extension without the dot, or `''` when the name has none. */
export function extensionOf(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i + 1).toLowerCase();
}

/**
 * The index class of a path. Every file is listed: a name no row names is text, and a binary is `binary`, which
 * Find never reads. Typed with `undefined` for the callers written when the allow-list could refuse a file.
 */
export function classify(path: string): IndexEntry['kind'] | undefined {
  return fileTypeOf(path)?.kind ?? 'text';
}
