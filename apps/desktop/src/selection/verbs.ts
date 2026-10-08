// Default verbs by selection kind: the one place verbs are ordered (ADR-0054, docs/design/03 §Default verbs, C-06).
// `Mod+C` and `Mod+Shift+C` read these tables, never a string prefix of a command id, and the palette's
// chord hints and the verb menu (C-13) read the same ones.

import type { Block, Document, ListItem, Node } from '@marxy/core';
import type { AppContext, Command } from '../commands/registry.ts';
import type { Selection } from './selection.ts';

export type VerbKind = 'text' | 'code' | 'table' | 'section' | 'document' | 'task' | 'block' | 'inline';

export const VERB_KINDS: readonly VerbKind[] = ['text', 'code', 'table', 'section', 'document', 'task', 'block', 'inline'];

const BLOCK_TYPES: ReadonlySet<string> = new Set<Block['type']>([
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'listItem',
  'codeBlock',
  'htmlBlock',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'mathBlock',
  'footnoteDefinition',
  'frontmatter',
]);

const TABLE_TYPES: ReadonlySet<string> = new Set(['table', 'tableRow', 'tableCell']);

function sameNode(a: Node, b: Node): boolean {
  return a === b || (a.type === b.type && a.src.start === b.src.start && a.src.end === b.src.end);
}

/** The chain of nodes from the document's child down to `target`'s parent; empty when `target` is not found. */
export function ancestorsOf(doc: Document, target: Node): readonly Node[] {
  const path: Node[] = [];
  const walk = (node: Node): boolean => {
    for (const child of node.children ?? []) {
      if (child.src.start > target.src.start || child.src.end < target.src.end) continue;
      if (sameNode(child, target)) return true;
      path.push(child);
      if (walk(child)) return true;
      path.pop();
    }
    return false;
  };
  return walk(doc) ? path : [];
}

export function isTaskItem(node: Node | undefined): node is ListItem {
  return node?.type === 'listItem' && (node as ListItem).task !== undefined;
}

/** The selection's kind for the verb tables, or null when nothing is selected. */
export function verbKindOf(sel: Selection, doc: Document): VerbKind | null {
  switch (sel.kind) {
    case 'none':
      return null;
    case 'text':
      return 'text';
    case 'document':
      return 'document';
    case 'section':
      return 'section';
    case 'node': {
      const node = sel.node;
      if (!BLOCK_TYPES.has(node.type)) return 'inline';
      if (node.type === 'heading') return 'section';
      if (node.type === 'codeBlock') return 'code';
      if (TABLE_TYPES.has(node.type)) return 'table';
      if (isTaskItem(node)) return 'task';
      if (node.type === 'paragraph') {
        const parent = ancestorsOf(doc, node).at(-1);
        if (isTaskItem(parent)) return 'task';
      }
      return 'block';
    }
  }
}

/** Command ids in menu order. Ids not (yet) registered are skipped. The one place verbs are ordered. */
export const MENU_ORDER: Readonly<Record<VerbKind, readonly string[]>> = {
  text: ['selection.copy-rich', 'selection.copy-plain', 'selection.copy-markdown'],
  code: ['op.copy-code-clean', 'op.copy-command', 'op.copy-source', 'op.copy-rich', 'view.jump-to-source'],
  table: [
    'op.copy-table-tsv',
    'op.copy-table-csv',
    'op.copy-table-json',
    'op.copy-source',
    'op.copy-rich',
    'op.align-table-pipes',
  ],
  section: [
    'op.copy-section',
    'op.copy-rich',
    'op.copy-plain',
    'op.extract-tasks',
    'op.extract-code-blocks',
    'op.extract-links',
    'view.jump-to-source',
  ],
  document: ['op.copy-section', 'op.copy-plain', 'op.extract-tasks', 'op.extract-code-blocks', 'op.extract-links'],
  task: ['op.toggle-task', 'op.copy-rich', 'op.copy-plain', 'op.copy-source', 'view.jump-to-source'],
  block: ['op.copy-rich', 'op.copy-plain', 'op.copy-source', 'view.jump-to-source'],
  inline: ['op.copy-source', 'view.jump-to-source'],
};

/**
 * Mod+C candidates; the first registered and applicable wins. Clipboard-only ids: a verb that changes the
 * buffer is never a default (ADR-0054 §3, and `verbs.test.ts` runs each over the corpus to hold it).
 *
 * `inline` names `op.copy-source`, as design 03 does, and C-07's copy-source refuses an inline node (a
 * partial span has no block bytes of its own). So no default applies to an inline selection today and
 * Mod+C stays the webview's own; the row is kept so the table reads as design 03 does.
 */
export const COPY_DEFAULT: Readonly<Record<VerbKind, readonly string[]>> = {
  text: ['selection.copy-rich'],
  code: ['op.copy-code-clean'],
  table: ['op.copy-table-tsv', 'op.copy-source'],
  section: ['op.copy-section'],
  document: ['op.copy-section'],
  task: ['op.copy-rich', 'op.copy-source'],
  block: ['op.copy-rich', 'op.copy-source'],
  inline: ['op.copy-source'],
};

/** Mod+Shift+C candidates: exact markdown. */
export const MARKDOWN_COPY: Readonly<Record<VerbKind, readonly string[]>> = {
  text: ['selection.copy-markdown'],
  code: ['op.copy-source'],
  table: ['op.copy-source'],
  section: ['op.copy-section'],
  document: ['op.copy-section'],
  task: ['op.copy-source'],
  block: ['op.copy-source'],
  inline: ['op.copy-source'],
};

/**
 * The first of `ids`, in that order, that is registered in `registered` and applicable in `ctx`.
 * The list is passed in rather than imported, so this module stays below the registry (no import cycle).
 */
export function firstApplicable(ids: readonly string[], ctx: AppContext, registered: readonly Command[]): Command | null {
  for (const id of ids) {
    const cmd = registered.find((c) => c.id === id);
    if (cmd?.when(ctx)) return cmd;
  }
  return null;
}

/** The selection's kind in `ctx`, read against the document the selection was resolved on. */
export function verbKindIn(ctx: AppContext): VerbKind | null {
  if (ctx.selection.kind === 'none') return null;
  if (ctx.selection.kind === 'text') return 'text';
  const doc = ctx.operationInputs?.()[0]?.document ?? ctx.operationInput()?.document;
  if (!doc) return null;
  return verbKindOf(ctx.selection, doc);
}

/** The command `Mod+C` runs for the selection in `ctx`, or null (native copy). */
export function copyDefault(ctx: AppContext, registered: readonly Command[]): Command | null {
  const kind = verbKindIn(ctx);
  return kind ? firstApplicable(COPY_DEFAULT[kind], ctx, registered) : null;
}

/** The command `Mod+Shift+C` runs for the selection in `ctx`, or null. */
export function markdownCopy(ctx: AppContext, registered: readonly Command[]): Command | null {
  const kind = verbKindIn(ctx);
  return kind ? firstApplicable(MARKDOWN_COPY[kind], ctx, registered) : null;
}
