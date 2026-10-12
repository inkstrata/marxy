// The depth lens in Source (K-10a): fold a JSON or YAML file to a depth, and say on every fold how many lines it hides.
//
// A fold is a view: CodeMirror keeps it as a decoration over the text, and the text, a copy of it, a save and the file's
// bytes are the same with it as without (commitment 3). Nothing is folded at rest and no fold is remembered. A fold
// names the lines it hides in words ("… 42 lines"), so what is out of sight is counted, never silent (commitment 4).
//
// "Depth" counts the containers (objects, arrays, block mappings and sequences) a value sits in. The file's own top
// container is depth 0 and always shows its entries; *Fold to depth 1* then folds each value that is itself a
// container, so a 60-item array of objects reads as the array's three lines; depth 2 shows each item's line, depth 3
// the item's own entries. The ranges are the ones the language folds by hand (`foldInside` for brackets, a pair or an
// item for YAML), so the gutter's own chevron and the placeholder's click undo them one at a time.
//
// The ranges are pure over an `EditorState` and its syntax tree; only `foldToDepth` and `unfoldEverything` touch a view.
// Loaded with the editor, never at start-up (MARXY-33).

import { ensureSyntaxTree, foldCode, foldEffect, foldInside, foldedRanges, codeFolding, language, unfoldCode, unfoldEffect } from '@codemirror/language';
import { EditorState, type Extension, type StateEffect, type Text } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';

// The Lezer types, from the functions that take and return them (@lezer/common is a transitive dependency, not ours).
type SyntaxNode = Parameters<typeof foldInside>[0];
type Tree = NonNullable<ReturnType<typeof ensureSyntaxTree>>;

/** The languages the lens folds: their tree has containers, and the language folds them by hand. TOML's mode has no tree. */
export type DepthFoldKind = 'json' | 'yaml';

/** The deepest level the palette offers. */
export const DEPTH_FOLD_LEVELS = [1, 2, 3, 4] as const;

/** How long a fold waits for the whole file's tree. A 2 MB file parses in a fraction of this on this machine. */
const TREE_WAIT_MS = 4000;

export interface FoldRange {
  readonly from: number;
  readonly to: number;
}

/** The kind of file the editor's language makes foldable by depth, or null (no language yet, or one without containers). */
export function depthFoldKind(state: EditorState): DepthFoldKind | null {
  const name = state.facet(language)?.name;
  return name === 'json' || name === 'yaml' ? name : null;
}

/** The JSON and YAML nodes that hold other values. */
const CONTAINERS: Readonly<Record<DepthFoldKind, ReadonlySet<string>>> = {
  json: new Set(['Object', 'Array']),
  yaml: new Set(['BlockMapping', 'BlockSequence', 'FlowMapping', 'FlowSequence']),
};

/** The range that folds `node`, the way the language folds it by hand; null if it would hide no line break. */
function foldRangeOf(kind: DepthFoldKind, node: SyntaxNode, doc: Text): FoldRange | null {
  let range: FoldRange | null;
  if (kind === 'json' || node.name === 'FlowMapping' || node.name === 'FlowSequence') {
    range = foldInside(node);
  } else {
    // A block container is folded through the pair or item that holds it, which is what the language offers on that line.
    // An anchor (`&a`) or a tag (`!!map`) sits between the pair or item and the container it names.
    let holder = node.parent;
    while (holder && (holder.name === 'Anchored' || holder.name === 'Tagged')) holder = holder.parent;
    range = holder && (holder.name === 'Pair' || holder.name === 'Item') ? { from: doc.lineAt(holder.from).to, to: holder.to } : null;
  }
  if (!range || range.from >= range.to) return null;
  if (doc.lineAt(range.from).number >= doc.lineAt(range.to).number) return null;
  // A pair of brackets with nothing between them has nothing to hide, so there is nothing to say a count of.
  return doc.sliceString(range.from, range.to).trim() === '' ? null : range;
}

/**
 * The ranges that fold a file to `depth`: every container nested `depth` containers deep (the top container is 0) that
 * spans lines. Disjoint, in document order. `tree` is the whole file's tree.
 */
export function rangesAtDepth(state: EditorState, tree: Tree, depth: number): FoldRange[] {
  const kind = depthFoldKind(state);
  if (kind === null || !(depth >= 1)) return [];
  const containers = CONTAINERS[kind];
  const out: FoldRange[] = [];
  let level = 0;
  tree.iterate({
    enter(ref) {
      if (!containers.has(ref.name)) return;
      if (level === depth) {
        const range = foldRangeOf(kind, ref.node, state.doc);
        if (range) out.push(range);
        return false; // everything inside is out of sight; no need to read it
      }
      level += 1;
    },
    leave(ref) {
      if (containers.has(ref.name)) level -= 1;
    },
  });
  return out;
}

/**
 * How many lines a fold hides: every line that has text in the hidden range. The lines between its two ends all do; the
 * line it opens on and the line it closes on count only if something other than white space of theirs is hidden (`{x: 1,`
 * after a flow bracket does; the indent before a closing bracket does not). A fold that hides only a line break reads
 * "1 line".
 */
export function hiddenLines(doc: Text, from: number, to: number): number {
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  let lines = last.number - first.number - 1;
  if (doc.sliceString(from, first.to).trim() !== '') lines += 1;
  if (doc.sliceString(last.from, to).trim() !== '') lines += 1;
  return Math.max(1, lines);
}

/** How many lines the reader sees: the document's lines, less the line breaks each fold swallows. */
export function visibleLineCount(state: EditorState): number {
  let seen = state.doc.lines;
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    seen -= state.doc.lineAt(to).number - state.doc.lineAt(from).number;
  });
  return seen;
}

/** What a fold's placeholder says. */
export function foldLabel(lines: number): string {
  return `… ${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

/**
 * The placeholder: text in the flow, naming what it hides. A click unfolds it, as CodeMirror's own does. It is not a tab
 * stop (a file can hold thousands, and Tab must leave the editor): the keyboard unfolds with the caret on the folded line
 * (`unfoldCode`, bound below), or with *Unfold all* from the palette.
 */
function placeholderDOM(view: EditorView, onclick: (event: Event) => void, prepared: unknown): HTMLElement {
  const lines = typeof prepared === 'number' ? prepared : 1;
  const el = document.createElement('span');
  el.className = 'marxy-fold-placeholder';
  el.textContent = foldLabel(lines);
  el.title = 'Unfold';
  el.setAttribute('role', 'button');
  el.tabIndex = -1;
  el.setAttribute('aria-label', `${lines} ${lines === 1 ? 'line' : 'lines'} folded`);
  el.onclick = onclick;
  el.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onclick(event);
    view.focus();
  };
  return el;
}

/**
 * A fold whose placeholder was counted when it was made must be counted again when a change reaches into it (a
 * replace-all, an undo): this unfolds and folds the same range in the same transaction, so the count is read again. It
 * relabels the folds CodeMirror keeps; it never brings back one a deletion opened.
 */
const recountFolds = EditorState.transactionExtender.of((tr) => {
  // CodeMirror opens a fold a deletion touches, so that text is never deleted out of sight (commitment 4): leave it open.
  if (!tr.docChanged || tr.isUserEvent('delete')) return null;
  const effects: StateEffect<FoldRange>[] = [];
  foldedRanges(tr.startState).between(0, tr.startState.doc.length, (from, to) => {
    if (!tr.changes.touchesRange(from, to)) return;
    const mapped = { from: tr.changes.mapPos(from, 1), to: tr.changes.mapPos(to, -1) };
    if (mapped.from >= mapped.to) return;
    effects.push(unfoldEffect.of(mapped), foldEffect.of(mapped));
  });
  return effects.length ? { effects } : null;
});

/**
 * CodeMirror's own keys, fold and unfold the folds on the caret's line (Cmd-Alt-[ and ] on a Mac, Ctrl-Shift-[ and ]
 * elsewhere). Neither chord is a command's: `test/keys-table.test.mjs` reads this list into its collision check.
 */
export const FOLD_KEYS: readonly KeyBinding[] = [
  { key: 'Ctrl-Shift-[', mac: 'Cmd-Alt-[', run: foldCode },
  { key: 'Ctrl-Shift-]', mac: 'Cmd-Alt-]', run: unfoldCode },
];

/** Folding for Source: every fold says how many lines it hides ("… 42 lines"), and a click on it unfolds. */
export function countedFolding(): Extension[] {
  return [
    codeFolding({
      preparePlaceholder: (state, range) => hiddenLines(state.doc, range.from, range.to),
      placeholderDOM,
    }),
    recountFolds,
    keymap.of(FOLD_KEYS),
  ];
}

/**
 * Resolves once the editor has its language, or after `ms` without one. The grammar arrives after the text (commitment 5),
 * so a command run in the first moments of a file waits for it rather than refusing.
 */
export async function languageReady(view: EditorView, ms = 3000): Promise<boolean> {
  for (let waited = 0; depthFoldKind(view.state) === null; waited += 50) {
    if (waited >= ms) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

export type DepthFoldResult =
  | { readonly kind: 'folded'; readonly folds: number; readonly lines: number }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'unready'; readonly why: 'language' | 'tree' };

/** Every fold in the editor now. */
function currentFolds(state: EditorState): FoldRange[] {
  const out: FoldRange[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => void out.push({ from, to }));
  return out;
}

/**
 * Folds the file to `depth`, replacing any folds there are. Moves the caret to the opening line of a fold that would
 * hide it, and nothing else of the editor's state; the document is not touched. Needs the whole file's tree: if the
 * parse has not finished within a few seconds nothing changes and the result says why.
 */
export function foldToDepth(view: EditorView, depth: number): DepthFoldResult {
  const state = view.state;
  if (depthFoldKind(state) === null) return { kind: 'unready', why: 'language' };
  const tree = ensureSyntaxTree(state, state.doc.length, TREE_WAIT_MS);
  if (tree === null) return { kind: 'unready', why: 'tree' };
  const ranges = rangesAtDepth(state, tree, depth);
  const effects: StateEffect<FoldRange>[] = [
    ...currentFolds(state).map((r) => unfoldEffect.of(r)),
    ...ranges.map((r) => foldEffect.of(r)),
  ];
  if (!effects.length) return { kind: 'nothing' };
  const head = state.selection.main.head;
  const covering = ranges.find((r) => r.from < head && head < r.to);
  const lines = ranges.reduce((n, r) => n + hiddenLines(state.doc, r.from, r.to), 0);
  view.dispatch({
    effects,
    ...(covering ? { selection: { anchor: covering.from }, scrollIntoView: true } : {}),
  });
  return ranges.length ? { kind: 'folded', folds: ranges.length, lines } : { kind: 'nothing' };
}

/** Opens every fold. Returns how many were open. */
export function unfoldEverything(view: EditorView): number {
  const open = currentFolds(view.state);
  if (open.length) view.dispatch({ effects: open.map((r) => unfoldEffect.of(r)) });
  return open.length;
}
