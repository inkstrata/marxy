// Per-file-type default view mode on open (docs/design/09-app-shell.md §Source mode).

import { detectKind } from '@marxy/core';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { isUntitled } from '../document/untitled.ts';

const RENDERED_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);

/** Lowercase extension including the dot, or '' when there is none. */
export function extensionOf(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * An extension-less `README`, `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or `HISTORY`: the rest of the text family
 * (ADR-0060 item 3). Asked of detection itself, so the two lists cannot drift: a name in this family is the only
 * extension-less file that the path alone gives `readme` or `changelog` (tier 2 applies inside the family only).
 */
function isNamedTextFamily(path: string): boolean {
  if (extensionOf(path) !== '') return false;
  const kind = detectKind({ path, head: new Uint8Array() }).kind;
  return kind === 'readme' || kind === 'changelog';
}

/**
 * Default mode when a file is opened (before the reader toggles): Rendered for the text family (`.md`,
 * `.markdown`, `.mdx`, `.txt`, and from K-05a the extension-less README family, ADR-0060 item 8), Source for
 * everything else. The mode follows the family and not the kind a rule or *show as* gave the file: no other
 * file's opening mode changes until its kind's own story lands.
 */
export function defaultModeForPath(path: string): 'rendered' | 'source' {
  // A scratch document is Markdown until Save As names it something else (E-13).
  if (isUntitled(path)) return 'rendered';
  return RENDERED_EXT.has(extensionOf(path)) || isNamedTextFamily(path) ? 'rendered' : 'source';
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
