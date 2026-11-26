// Per-file-type default view mode on open.

import { fileTypeFor, fileTypeOf } from '@marxy/core/src/kind/registry.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { isUntitled } from '../document/untitled.ts';
import { LARGE_OPEN_BYTES } from '../render/working.ts';

/** Lowercase extension including the dot, or '' when there is none. */
export function extensionOf(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * An extension-less `README`, `CHANGES`, `NOTICE` and the like, or a name the table holds whole (`LICENSE.mit`,
 * `COPYING.LESSER`): the rest of the text family. Read from the file-type table, so the lists
 * cannot drift.
 */
export function isNamedTextFamily(path: string): boolean {
  const type = fileTypeOf(path);
  if (type?.kind !== 'text') return false;
  return extensionOf(path) === '' || (type.match.name?.includes(basename(path).toLowerCase()) ?? false);
}

/**
 * The mode the file type's row names: Rendered for the text family (`.md`, `.markdown`, `.mdx`, `.txt`, and the
 * extension-less README family) and the readings, Source for code and text no reading knows. The mode follows the
 * family and not the kind a rule or *show as* gave the file. A link followed beside reads this; where a file lands is
 * `landingModeForPath`.
 */
export function defaultModeForPath(path: string): 'rendered' | 'source' {
  // A scratch document is Markdown until Save As names it something else.
  if (isUntitled(path)) return 'rendered';
  return fileTypeOf(path)?.mode ?? 'source';
}

/** Whether `path` is an HTML file (`.html`, `.htm`, `.xhtml`): read as a page, in the sandbox mail's HTML part uses. */
export const isWebPage = (path: string): boolean => fileTypeFor(path).id === 'html';

/** Files written to be edited by the tool that opens them (a commit message, a rebase list): they keep landing in Source. */
const EDITED_IN_PLACE = new Set(['git-commit', 'git-rebase']);

/**
 * Whether `path` is code whose row is edited in Source but which lands in Read: its coloured code reading, or for HTML the
 * sandboxed page, with Source one key away. Not Markdown, data, logs, an SVG, a theme or text no reading knows.
 */
export function landsInRead(path: string): boolean {
  if (isUntitled(path)) return false;
  if (isWebPage(path)) return true;
  const type = fileTypeOf(path);
  return type !== undefined && type.kind === 'source' && type.reading === 'code' && type.viewer === 'text' && type.mode === 'source' && !EDITED_IN_PLACE.has(type.id);
}

/**
 * The mode a file `size` bytes long opens in before the reader toggles: its row's, except code, which is read first
 * (`landsInRead`) under the size a large open starts at. From it Read's first screen comes two to three times later than
 * Source's (measured: about 300 ms against 120 ms at 1.25 MB, 700 ms against 150 ms at 4.9 MB), so code that large lands
 * in Source, as it always did (from 5 MB Read is Lines). An HTML file is its page at any size. Without a size (before the
 * file is read) code is taken to be read.
 */
export function landingModeForPath(path: string, size?: number): 'rendered' | 'source' {
  if (!landsInRead(path)) return defaultModeForPath(path);
  return isWebPage(path) || size === undefined || size < LARGE_OPEN_BYTES ? 'rendered' : 'source';
}
/**
 * When a `theme.css` sits beside a `theme.toml`, open in Source and offer to apply the theme.
 * The caller supplies whether `theme.toml` exists in the same directory.
 */
export function themeCssOpenNotice(path: string, siblingHasThemeToml: boolean): string | null {
  if (!siblingHasThemeToml) return null;
  const base = basename(path);
  if (base !== 'theme.css') return null;
  return 'This file styles a marxy theme. Switch to Rendered after editing, or use “apply this theme” from the notice.';
}
