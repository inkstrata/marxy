// Whether a block's raw inline HTML leaves the sanitiser's stack of open elements where it found it
// (moved here from the desktop's incremental render, B-24, for D-15's sliced render, which has the
// same question: may a run of blocks be sanitised on its own?).

import type { Node as AstNode } from '../contracts/ast.ts';
import { FOREIGN_ROOTS, RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from '../sanitize/policy.ts';

/**
 * True when the raw tags among a block's inline nodes are properly nested within it, so the sanitiser's
 * stack of open elements is where it was when the block started, once the block is done. A tag the
 * sanitiser would take with its contents to a later end tag (`script`, `style`, `svg`, …) does not count.
 */
export function rawTagsBalanced(block: AstNode): boolean {
  const open: string[] = [];
  let ok = true;
  const walk = (node: AstNode): void => {
    if (!ok) return;
    if (node.type === 'html') {
      ok = tagKeepsStack(node.value, open);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(block);
  return ok && open.length === 0;
}

const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?\/?>$/s;

function tagKeepsStack(value: string, open: string[]): boolean {
  if (value.startsWith('<!') || value.startsWith('<?')) return true; // a comment or a declaration: removed, no element
  const m = TAG.exec(value);
  if (m === null) return false;
  const name = m[2]!.toLowerCase();
  if (RAW_TEXT_ELEMENTS.has(name) || FOREIGN_ROOTS.has(name)) return false;
  if (m[1] === '/') return open.pop() === name;
  if (!VOID_ELEMENTS.has(name)) open.push(name);
  return true;
}
