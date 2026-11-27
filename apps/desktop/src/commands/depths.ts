// The depths as registry commands: `x` x-ray, `X` Reveal, `z` and `Z` folds, `v` only this. Single
// keys, so they act only with focus on the page and `verbs` on (selection/bind.ts); Escape leaving "only this" is
// `selection.clear`'s, which owns that key.
import type { Block, Document } from '@marxy/core';
import { appHandle } from './app-handle.ts';
import { partRange } from './cursor.ts';
import type { AppContext, Command } from './registry.ts';
import { foldAllHeadings, sectionOf } from '../depths/depth-maths.ts';
import {
  depthHidden,
  dropLens,
  focusOn,
  foldAll,
  lensOf,
  markCurrent,
  setCursorRangeSource,
  setFocusOn,
  toggleFold,
  toggleReveal,
  toggleXray,
  type DepthTarget,
} from '../depths/dress.ts';
import { isSectionHeading } from '../selection/cursor.ts';
import { blockAt, isBlock } from '../selection/selection.ts';
import { notify } from '../notices/index.ts';

const ready = (): boolean => appHandle()?.selection.cursorReady() === true;
const hasPart = (ctx: AppContext): boolean => ready() && partRange(ctx.selection) !== null;

let following: unknown = null;

/** The focused pane's article as the depths act on it; the x-ray box under the cursor follows the selection from here. */
function focusedTarget(): DepthTarget | null {
  const handle = appHandle();
  if (!handle) return null;
  const sel = handle.selection;
  if (following !== sel && typeof sel.onChange === 'function') {
    following = sel;
    setCursorRangeSource(() => {
      const r = partRange(sel.state().selection);
      return r ? { article: sel.article(), range: r } : null;
    });
    sel.onChange(markCurrent);
  }
  const article = sel.article();
  const pane = handle.panes().panes.find((p) => p.article === article);
  if (!pane) return null;
  return { article, store: () => pane.view.store(), mountThrough: (byte) => pane.view.mountThrough(byte) };
}

/** The cursor goes when what it is on is folded away or left out. */
function dropHiddenCursor(): void {
  const sel = appHandle()?.selection;
  const s = sel?.state().selection;
  if (!sel || !s) return;
  const article = sel.article();
  const el =
    s.kind === 'node' ? s.el : s.kind === 'section' ? article.querySelector(`[data-marxy-s="${s.heading.src.start}"][data-marxy-e="${s.heading.src.end}"]`) : s.kind === 'blocks' ? s.els[0] : null;
  if (el && depthHidden(el)) sel.clear();
}

/** The top-level block the selection starts in. */
function topBlockOf(doc: Document, byte: number): Block | null {
  return doc.children.find((b) => b.src.start <= byte && byte < b.src.end) ?? null;
}

export function depthCommands(): readonly Command[] {
  return [
    {
      id: 'depths.xray',
      title: 'X-ray: the part as the file stores it, in place',
      key: 'x',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const r = partRange(ctx.selection);
        const target = focusedTarget();
        if (r && target) toggleXray(target, { start: r.start, end: r.end });
      },
    },
    {
      id: 'depths.reveal',
      title: 'Reveal: the markup the reading left out, put back around it',
      key: 'Shift+X',
      group: 'view',
      when: ready,
      async run() {
        const target = focusedTarget();
        if (target) toggleReveal(target);
      },
    },
    {
      id: 'depths.fold',
      title: 'Fold the section, or unfold it',
      key: 'z',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const handle = appHandle();
        const target = focusedTarget();
        const doc = target?.store()?.snapshot().ast;
        if (!handle || !target || !doc) return;
        const sel = ctx.selection;
        if (sel.kind === 'section') {
          toggleFold(target, sel.heading);
          return;
        }
        const r = partRange(sel);
        const top = r && topBlockOf(doc, r.start);
        const heading = top && (isSectionHeading(doc, top) ? top : sectionOf(doc, top));
        if (!heading || heading.type !== 'heading') {
          notify({ kind: 'refused', text: 'Folding works on a heading and what is under it.', transient: true });
          return;
        }
        // Out to the top level first: from inside a fold the cursor has no way out.
        // An inline part counts as its block: the cursor steps out from the block, not from the inline.
        const nested = (): boolean => {
          const s = handle.selection.state().selection;
          if (s.kind !== 'node') return false;
          const block = isBlock(s.node) ? s.node : blockAt(doc, s.node.src.start);
          return block !== null && !doc.children.includes(block);
        };
        for (let i = 0; i < 12 && nested(); i++) if (!handle.selection.cursorMove('out')) break;
        toggleFold(target, heading);
        handle.selection.cursorMove('out');
        dropHiddenCursor();
      },
    },
    {
      id: 'depths.fold-all',
      title: 'Fold every section to the second level, or open them all',
      key: 'Shift+Z',
      group: 'view',
      when: ready,
      async run() {
        const target = focusedTarget();
        const doc = target?.store()?.snapshot().ast;
        if (!target || !doc) return;
        foldAll(target, foldAllHeadings(doc));
        dropHiddenCursor();
      },
    },
    {
      id: 'depths.focus',
      title: 'Only this: the part alone on the page, or everything again',
      key: 'v',
      group: 'selection',
      when: (ctx) => hasPart(ctx) || (ready() && focusOn(appHandle()!.selection.article())),
      async run(ctx) {
        const target = focusedTarget();
        if (!target) return;
        if (focusOn(target.article)) {
          setFocusOn(target, null);
          return;
        }
        const r = partRange(ctx.selection);
        if (!r) return;
        setFocusOn(target, { start: r.start, end: r.end });
        const first = target.article.querySelector(`[data-marxy-s="${r.start}"]`);
        first?.scrollIntoView({ block: 'nearest' });
      },
    },
  ];
}

/** Escape with one part shown alone, or a lens on, shows everything again (selection.clear's key). True when it did. */
export function leaveFocus(): boolean {
  const target = focusedTarget();
  if (!target) return false;
  if (dropLens(target.article)) return true;
  if (!focusOn(target.article)) return false;
  setFocusOn(target, null);
  return true;
}

export function focusShown(): boolean {
  const article = appHandle()?.selection.article();
  return article ? focusOn(article) || lensOf(article) !== null : false;
}
