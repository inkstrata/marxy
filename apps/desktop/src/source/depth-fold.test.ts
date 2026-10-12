// The depth lens (K-10a), over a real CodeMirror state with no DOM: which ranges fold at each depth, what each fold
// says it hides, that nothing changes the document, and where the lens is not offered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteCharBackward } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { foldEffect, foldedRanges, ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { sourceViewCommands } from '../commands/source-view.ts';
import type { AppContext } from '../commands/registry.ts';
import { DEPTH_FOLD_MAX_BYTES, depthFoldOffered } from './depth-fold-gate.ts';
import { countedFolding, depthFoldKind, foldLabel, foldToDepth, hiddenLines, rangesAtDepth, unfoldEverything, visibleLineCount } from './depth-fold.ts';
import { LARGE_FILE_BYTES } from './language.ts';

/** The research's fixture (03-structured-output.md): 60 × `{id, name, tags: [a, b], ok}`, indent 2: 544 lines. */
const ITEMS = JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], ok: true })) }, null, 2);

const stateOf = (doc: string, lang: 'json' | 'yaml' = 'json') =>
  EditorState.create({ doc, extensions: [lang === 'json' ? json() : yaml(), ...countedFolding()] });

/** A view with just enough of one for the lens: `state` and `dispatch`. */
function fakeView(state: EditorState): EditorView & { readonly state: EditorState } {
  const view = {
    state,
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as unknown as EditorView & { readonly state: EditorState };
}

const visibleLines = visibleLineCount;

const fold = (view: ReturnType<typeof fakeView>, depth: number) => foldToDepth(view as unknown as EditorView, depth);

test('the fixture is 544 lines, and folds to 3, 64 and 364 at depths 1, 2 and 3 (the card and the research)', () => {
  const view = fakeView(stateOf(ITEMS));
  assert.equal(view.state.doc.lines, 544);
  const seen = [1, 2, 3, 4].map((depth) => {
    const result = fold(view, depth);
    return [depth, result.kind, visibleLines(view.state)] as const;
  });
  assert.deepEqual(seen, [[1, 'folded', 3], [2, 'folded', 64], [3, 'folded', 364], [4, 'nothing', 544]]);
});

test('folding to a depth leaves the document exactly as it was', () => {
  const view = fakeView(stateOf(ITEMS));
  for (const depth of [1, 2, 3, 4]) fold(view, depth);
  unfoldEverything(view as unknown as EditorView);
  assert.equal(view.state.doc.toString(), ITEMS);
  assert.equal(foldedRanges(view.state).size, 0);
});

test('every fold counts the lines it hides: the closing bracket stays, so an item of nine lines hides seven', () => {
  const state = stateOf(ITEMS);
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const ranges = rangesAtDepth(state, tree, 2);
  assert.equal(ranges.length, 60);
  for (const r of ranges) assert.equal(hiddenLines(state.doc, r.from, r.to), 7);
  const [items] = rangesAtDepth(state, tree, 1);
  assert.equal(hiddenLines(state.doc, items.from, items.to), 540); // sixty items of nine lines; the `]` line stays
  assert.equal(foldLabel(7), '… 7 lines');
  assert.equal(foldLabel(1), '… 1 line');
});

test('a fold hides the count it says: lines of the text between the lines the fold opens and closes on', () => {
  // Counted by hand from the text, not by the function under test.
  const doc = 'a: 1\nb:\n  c: 2\n  d: 3\n  e: 4\ne: 5\n';
  const state = stateOf(doc, 'yaml');
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const [only] = rangesAtDepth(state, tree, 1);
  const hidden = doc.slice(only.from, only.to);
  assert.equal(hidden, '\n  c: 2\n  d: 3\n  e: 4');
  assert.equal(hiddenLines(state.doc, only.from, only.to), hidden.split('\n').length - 1);
});

test('YAML folds the value of each key at depth 1, and a list of maps at depth 2', () => {
  const doc = [
    'name: pg16',
    'steps:',
    '  - id: one',
    '    run: a',
    '    env:',
    '      X: 1',
    '  - id: two',
    '    run: b',
    'owner: me',
    '',
  ].join('\n');
  const view = fakeView(stateOf(doc, 'yaml'));
  assert.equal(depthFoldKind(view.state), 'yaml');
  assert.equal(fold(view, 1).kind, 'folded');
  assert.equal(visibleLines(view.state), 4, 'name, steps (folded), owner and the final empty line');
  assert.equal(fold(view, 2).kind, 'folded');
  assert.equal(visibleLines(view.state), 6, 'each list item folds to its first line');
  assert.equal(fold(view, 3).kind, 'folded');
  assert.equal(visibleLines(view.state), 9, 'only env folds');
  assert.equal(fold(view, 4).kind, 'nothing');
  assert.equal(view.state.doc.toString(), doc);
});

test('a fold to a new depth replaces the folds there were; Unfold all opens them and says how many', () => {
  const view = fakeView(stateOf(ITEMS));
  fold(view, 2);
  fold(view, 1);
  assert.equal(foldedRanges(view.state).size, 1);
  assert.equal(unfoldEverything(view as unknown as EditorView), 1);
  assert.equal(unfoldEverything(view as unknown as EditorView), 0);
});

test('a caret inside what a fold hides moves to the line the fold opens on', () => {
  const view = fakeView(stateOf(ITEMS));
  const inside = ITEMS.indexOf('"id": 30');
  view.dispatch({ selection: { anchor: inside } });
  fold(view, 2);
  const head = view.state.selection.main.head;
  assert.equal(view.state.doc.lineAt(head).text, '    {');
  assert.equal(view.state.doc.toString(), ITEMS);
});

test('a file with no language, or one with no tree of containers, does not fold', () => {
  const view = fakeView(EditorState.create({ doc: '{\n  "a": [\n    1\n  ]\n}\n' }));
  assert.equal(depthFoldKind(view.state), null);
  assert.deepEqual(fold(view, 1), { kind: 'unready', why: 'language' });
  const scalar = fakeView(stateOf('42\n'));
  assert.equal(fold(scalar, 1).kind, 'nothing');
});

test('it is not offered for TOML, a file with no tree, or a file over the large-file limit', () => {
  assert.equal(DEPTH_FOLD_MAX_BYTES, LARGE_FILE_BYTES);
  assert.equal(depthFoldOffered('/r/data.json', 100), true);
  assert.equal(depthFoldOffered('/r/ci.yml', 100), true);
  assert.equal(depthFoldOffered('/r/ci.yaml', 100), true);
  assert.equal(depthFoldOffered('/r/Cargo.toml', 100), false);
  assert.equal(depthFoldOffered('/r/log.jsonl', 100), false);
  assert.equal(depthFoldOffered('/r/notes.md', 100), false);
  assert.equal(depthFoldOffered('/r/data.json', LARGE_FILE_BYTES), true);
  assert.equal(depthFoldOffered('/r/data.json', LARGE_FILE_BYTES + 1), false);
  assert.equal(depthFoldOffered('untitled', 10), false);
});

test('the five commands are offered by the file open in Source, and by nothing else', () => {
  const commands = sourceViewCommands().filter((c) => c.id.startsWith('source.fold-depth-') || c.id === 'source.unfold-all');
  assert.deepEqual(
    commands.map((c) => [c.id, c.title]),
    [
      ['source.fold-depth-1', 'Fold to depth 1'],
      ['source.fold-depth-2', 'Fold to depth 2'],
      ['source.fold-depth-3', 'Fold to depth 3'],
      ['source.fold-depth-4', 'Fold to depth 4'],
      ['source.unfold-all', 'Unfold all'],
    ],
  );
  for (const c of commands) assert.equal(c.key, undefined, 'no key until the menu bar checks conflicts (question 2)');
  const ctxOf = (path: string, bytes: number) =>
    ({ document: { snapshot: () => ({ buffer: { path, bytes: { length: bytes } } }) } }) as unknown as AppContext;
  const offered = (mode: string, path: string, bytes: number) => {
    (globalThis as { document?: unknown }).document = { body: { dataset: { marxyMode: mode } } };
    try {
      return commands.map((c) => c.when(ctxOf(path, bytes)));
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  };
  assert.deepEqual(offered('source', '/r/data.json', 544), [true, true, true, true, true]);
  assert.deepEqual(offered('source', '/r/Cargo.toml', 544), [false, false, false, false, false]);
  assert.deepEqual(offered('source', '/r/big.json', LARGE_FILE_BYTES + 1), [false, false, false, false, false]);
  assert.deepEqual(offered('rendered', '/r/data.json', 544), [false, false, false, false, false]);
});

/** What each fold's placeholder was prepared to say: the counts the widgets hold, in document order. */
function counts(state: EditorState): number[] {
  const out: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (_from, _to, deco) => void out.push((deco.spec.widget as { value: number }).value));
  return out;
}

test('a change inside a fold counts it again; an undo of it does too (the recount)', () => {
  const view = fakeView(stateOf('{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "b": 1\n}\n'));
  fold(view, 1);
  assert.deepEqual(counts(view.state), [2]);
  const at = view.state.doc.toString().indexOf('"y"');
  view.dispatch({ changes: { from: at, insert: '"w": 0,\n"v": 0,\n' } });
  assert.deepEqual(counts(view.state), [4], 'two lines went in');
  view.dispatch({ changes: { from: at, to: at + '"w": 0,\n"v": 0,\n'.length } });
  assert.deepEqual(counts(view.state), [2], 'and came out');
});

test('a deletion opens the fold it touches and does not bring it back (commitment 4: no text deleted out of sight)', () => {
  const doc = '{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "b": 1\n}\n';
  // JSON: Backspace with the caret at the end of the fold deletes hidden text, so the fold opens.
  const view = fakeView(stateOf(doc));
  fold(view, 1);
  let end = 0;
  foldedRanges(view.state).between(0, doc.length, (_from, to) => void (end = to));
  view.dispatch({ selection: { anchor: end } });
  assert.equal(deleteCharBackward({ state: view.state, dispatch: view.dispatch } as never), true);
  assert.equal(foldedRanges(view.state).size, 0, 'the fold is open');
  assert.ok(view.state.doc.length < doc.length, 'the hidden indent was deleted, and the reader can see the fold open');
  // A deletion that runs from visible text into a fold opens it too.
  const spanning = fakeView(stateOf(doc));
  fold(spanning, 1);
  const mid = doc.indexOf('"x"');
  spanning.dispatch({ changes: { from: doc.indexOf('"a"'), to: mid }, userEvent: 'delete.selection' });
  assert.equal(foldedRanges(spanning.state).size, 0, 'the rest of the fold is not left closed');
  // Markdown: the same, with a heading's fold.
  const md = '# Title\n\nbody one\nbody two\n\n## Next\n\ntext\n';
  const mdState = EditorState.create({ doc: md, extensions: [markdown(), ...countedFolding()] });
  ensureSyntaxTree(mdState, md.length, 5000);
  const from = md.indexOf('\n\nbody');
  const to = md.indexOf('\n\n## Next');
  const mdView = fakeView(mdState);
  mdView.dispatch({ effects: foldEffect.of({ from, to }), selection: { anchor: to } });
  assert.equal(foldedRanges(mdView.state).size, 1);
  assert.equal(deleteCharBackward({ state: mdView.state, dispatch: mdView.dispatch } as never), true);
  assert.equal(foldedRanges(mdView.state).size, 0, 'a Markdown fold opens on Backspace at its end');
});

test('YAML behind an anchor or a tag folds like any other, so a file of only those does not say "not nested"', () => {
  const doc = 'base: &b\n  x: 1\n  y: 2\nother:\n  z: 3\nlist: &l\n  - a\n  - b\ntagged: !!map\n  q: 1\n  r: 2\n';
  const view = fakeView(stateOf(doc, 'yaml'));
  const result = fold(view, 1);
  assert.deepEqual(result.kind === 'folded' ? [result.folds, result.lines] : result, [4, 2 + 1 + 2 + 2]);
  assert.equal(visibleLines(view.state), 5, 'four keys and the final empty line');
  const only = fakeView(stateOf('a: &a\n  x: 1\n  y: 2\nb: !!set\n  p: 1\n  q: 2\n', 'yaml'));
  assert.equal(fold(only, 1).kind, 'folded');
});

test('the count is the lines with hidden text: a flow map that opens on a line with content counts it', () => {
  const doc = 'a: {x: 1,\n  y: [1,\n   2]}\nb: 1\n';
  const state = stateOf(doc, 'yaml');
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const [only] = rangesAtDepth(state, tree, 1);
  assert.equal(hiddenLines(state.doc, only.from, only.to), 3);
  // Brackets with nothing between them hide nothing, so the lens leaves them.
  const empty = stateOf('{\n  "a": [\n  ],\n  "b": 1\n}\n');
  assert.deepEqual(rangesAtDepth(empty, ensureSyntaxTree(empty, empty.doc.length, 5000)!, 1), []);
});
