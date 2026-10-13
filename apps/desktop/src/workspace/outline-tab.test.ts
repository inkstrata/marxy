// The Outline tab's pure parts (W-10): the rows `outlineModelOf` gives (levels, the words of each section, tables under their
// section), the Markdown `outlineMarkdown` copies, and the actions `applyOutlineAction` runs on a real store: a move is the reference
// splice byte for byte over random Markdown, is one undo step, is refused with the file untouched when it would change the blocks
// of the document or the range holds bytes that are not text. What the reader sees is outline-tab.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer, parseMarkdown, sectionRange } from '@marxy/core';
import { blockKeys } from '@marxy/core/src/operations/move-section.ts';
import { corpusDocuments } from '@marxy/core/src/operations/testing/corpus.ts';
import { generate, reference, sectionIndexAfterDown, sectionIndexAfterUp } from '@marxy/core/src/operations/testing/sections.ts';
import { openDocumentStore } from '../document/store.ts';
import { countsAsMarkdown, countWords, createWordCounter, statusItems, wordsLabel } from './status-facts.ts';
import {
  applyOutlineAction,
  availableActions,
  currentRow,
  type HeadingRow,
  type OutlineAction,
  outlineMarkdown,
  outlineModelFor,
  outlineModelOf,
  tableLabel,
} from './outline-tab.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const modelOf = (md: string | Uint8Array) => {
  const bytes = typeof md === 'string' ? enc.encode(md) : md;
  return outlineModelOf(parseMarkdown(bytes, { file: 'o.md' }), createBuffer('o.md', bytes));
};
const headings = (md: string) => modelOf(md).rows.filter((r): r is HeadingRow => r.kind === 'heading');
const storeOf = (md: string, path = '/o.md') => openDocumentStore({ writeFileAtomic: async () => {} }, path, enc.encode(md));
const textOfStore = (store: ReturnType<typeof storeOf>) => dec.decode(store.snapshot().buffer.bytes);

// ---- the rows ---------------------------------------------------------------------------------------------------------

test('outlineModelOf: headings in order with their levels, indented from the shallowest, and the words of each section including its sub-sections', () => {
  const md = '## Method\n\nHow it was done.\n\n### Detail\n\nOne two three.\n\n## Results\n\nFour five.\n';
  const rows = headings(md);
  assert.deepEqual(rows.map((r) => [r.text, r.level, r.depth, r.words]), [
    ['Method', 2, 0, 9],
    ['Detail', 3, 1, 4],
    ['Results', 2, 0, 3],
  ]);
});

test('outlineModelOf: a heading in a fence or in front matter is not a row; one in a quote or a list item is, as the folded outline lists it; a title held only by front matter is not a heading', () => {
  const md = '---\ntitle: Held by front matter\n# nor this\n---\n\n# Real\n\n```md\n# in a fence\n```\n\n> ## Quoted\n\n- ### Listed\n';
  const rows = headings(md);
  assert.deepEqual(rows.map((r) => r.text), ['Real', 'Quoted', 'Listed']);
});

test('outlineModelOf: a table is listed under the section that holds it, as "Table: its first header cells"', () => {
  const md = '| Intro | Cell |\n|---|---|\n| 1 | 2 |\n\n# A\n\n| Place | Count | `code` | [link](x) | five |\n|---|---|---|---|---|\n| n | 1 | | | |\n\n## B\n\n|  | x |\n|--|--|\n| 1 | 2 |\n';
  const rows = modelOf(md).rows;
  assert.deepEqual(rows.map((r) => (r.kind === 'heading' ? `#${r.text}` : r.kind === 'table' ? r.label : `title ${r.text}`)), [
    'Table: Intro, Cell',
    '#A',
    'Table: Place, Count, code, link, …',
    '#B',
    'Table: (empty), x',
  ]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 0, 1, 1, 2], 'a table sits one step in from its section');
  const table = parseMarkdown('| a |\n|---|\n', { file: 't.md' }).children[0]!;
  assert.equal(tableLabel(table as never), 'Table: a');
});

test('outlineModelOf: a title that only front matter holds is the top row, so "where you are" has a row to mark; with an h1 there is none', () => {
  const md = '---\ntitle: Front title\n---\n\nIntro words.\n\n## Section\n\ntext\n';
  const rows = modelOf(md).rows;
  assert.deepEqual(rows.map((r) => [r.kind, r.kind === 'table' ? r.label : r.text]), [['title', 'Front title'], ['heading', 'Section']]);
  assert.equal(modelOf(md).headings, 1, 'a title is not a heading');
  // The preamble is the title\'s, as the status bar says: the title row is marked above the first heading.
  assert.equal(currentRow(rows, md.indexOf('Intro')), 0);
  assert.equal(currentRow(rows, md.indexOf('text\n')), 1);
  assert.deepEqual(modelOf('---\ntitle: Front title\n---\n\n# Real h1\n').rows.map((r) => r.kind), ['heading']);
  assert.equal(outlineMarkdown(rows), '- Front title\n  - Section\n');
});

test('outlineModelOf: the sections of a large outline end where the card says, and the model is made once per buffer', () => {
  const md = Array.from({ length: 4000 }, (_, i) => `${'#'.repeat(1 + (i % 3))} H${i}\n\nword ${i}\n`).join('\n');
  const bytes = enc.encode(md);
  const ast = parseMarkdown(bytes, { file: 'o.md' });
  const buffer = createBuffer('o.md', bytes);
  const t0 = performance.now();
  const model = outlineModelOf(ast, buffer);
  const took = performance.now() - t0;
  assert.ok(took < 400, `${took.toFixed(0)} ms for 4,000 headings`);
  // Each section's end is `sectionRange`'s.
  const heads = ast.children.filter((b) => b.type === 'heading');
  const rows = model.rows.filter((r): r is HeadingRow => r.kind === 'heading');
  heads.forEach((h, i) => assert.equal(rows[i]!.end, sectionRange(ast, h as never).end, `heading ${i}`));
  assert.equal(outlineModelFor(ast, buffer), outlineModelFor(ast, buffer));
});

test('outlineModelOf: a document with no heading has no heading rows', () => {
  assert.deepEqual(modelOf('Just a paragraph.\n').rows, []);
  assert.equal(modelOf('').headings, 0);
});

test('words per section are the status bar\'s count over the section\'s bytes, for every heading of every corpus file', () => {
  let checked = 0;
  for (const { file, bytes, document } of corpusDocuments()) {
    const buffer = createBuffer(file, bytes);
    const model = outlineModelOf(document, buffer);
    const rows = model.rows.filter((r): r is HeadingRow => r.kind === 'heading');
    for (const row of rows) {
      const section = dec.decode(bytes.subarray(row.start, row.end));
      assert.equal(row.words, countWords(section, { markdown: countsAsMarkdown(file) }), `${file}: ${row.text}`);
      checked++;
    }
    // The sections that no other section holds, with the text before the first, are the whole text: no word is counted twice or dropped.
    if (rows.length > 0) {
      const outer = rows.filter((r) => !rows.some((o) => o !== r && o.start <= r.start && r.end <= o.end && (o.start < r.start || r.end < o.end)));
      const before = countWords(dec.decode(bytes.subarray(0, outer[0]!.start)), { markdown: countsAsMarkdown(file) });
      assert.equal(before + outer.reduce((n, r) => n + r.words, 0), countWords(buffer.text, { markdown: countsAsMarkdown(file) }), `${file}: the sections tile the text`);
    }
  }
  assert.ok(checked > 200, `${checked} sections checked`);
});

test('currentRow: the last heading that starts at or before the byte; none above the first heading', () => {
  const rows = headings('Intro.\n\n# A\n\na\n\n## B\n\nb\n\n# C\n\nc\n');
  assert.equal(currentRow(rows, 0), -1);
  assert.equal(currentRow(rows, rows[0]!.start), 0);
  assert.equal(currentRow(rows, rows[1]!.start - 1), 0);
  assert.equal(currentRow(rows, rows[1]!.start), 1);
  assert.equal(currentRow(rows, 10_000), 2);
});

test('outlineMarkdown: the headings as a nested list; a skipped level is not a skipped indent', () => {
  assert.equal(outlineMarkdown(modelOf('# A\n\n### B\n\n#### C\n\n## D\n\n# E\n').rows), '- A\n  - B\n    - C\n  - D\n- E\n');
  assert.equal(outlineMarkdown(modelOf('## Only\n').rows), '- Only\n');
  assert.equal(outlineMarkdown(modelOf('text\n').rows), '');
  assert.equal(outlineMarkdown(modelOf('# \n').rows), '- (untitled)\n');
});

// ---- the actions ------------------------------------------------------------------------------------------------------

const startOf = (md: string, title: string): number => headings(md).find((r) => r.text === title)!.start;

test('Move up and Move down: the other section is the other way round, in one undo step, and undo gives the exact bytes back', async () => {
  const md = '# Intro\n\ni\n\n## One\n\n1\n\n## Two\n\n2\n\n## Three\n\n3\n';
  const store = storeOf(md);
  const before = store.snapshot();
  const up = await applyOutlineAction(store, startOf(md, 'Two'), 'move-up');
  assert.deepEqual(up.applied, true);
  const after = textOfStore(store);
  assert.equal(after, '# Intro\n\ni\n\n## Two\n\n2\n\n## One\n\n1\n\n## Three\n\n3\n');
  assert.equal(up.applied && startOf(after, 'Two'), up.applied && up.start, 'the result says where the heading is now');
  assert.equal(store.snapshot().version, before.version + 1, 'one transition');
  await store.undo();
  assert.equal(textOfStore(store), md, 'one undo gives the original bytes');
  assert.equal(store.snapshot().canUndo, false);
  const down = await applyOutlineAction(store, startOf(md, 'One'), 'move-down');
  assert.equal(textOfStore(store), after, 'down from the other side is the same swap');
  assert.equal(down.applied && down.start, startOf(after, 'One'));
  // The first section has nowhere to go up, the last none to go down; the document is untouched and the reason is in words.
  const first = await applyOutlineAction(store, startOf(after, 'Two'), 'move-up');
  assert.equal(first.applied, false);
  assert.match(first.applied ? '' : first.why, /first section at its level/);
  const last = await applyOutlineAction(store, startOf(after, 'Three'), 'move-down');
  assert.match(last.applied ? '' : last.why, /last section at its level/);
  assert.equal(textOfStore(store), after);
});

test('Promote and Demote are E-07\'s: the # runs of the section move one level, and a setext heading is declined in words', async () => {
  const store = storeOf('# A\n\n## B\n\n### C\n\n## D\n');
  const demote = await applyOutlineAction(store, startOf(textOfStore(store), 'B'), 'demote');
  assert.equal(demote.applied, true);
  assert.equal(textOfStore(store), '# A\n\n### B\n\n#### C\n\n## D\n');
  await store.undo();
  const promote = await applyOutlineAction(store, startOf(textOfStore(store), 'B'), 'promote');
  assert.equal(promote.applied, true);
  assert.equal(textOfStore(store), '# A\n\n# B\n\n## C\n\n## D\n');
  const refused = await applyOutlineAction(storeOf('# A\n\nSub\n---\n'), startOf('# A\n\nSub\n---\n', 'A'), 'demote');
  assert.equal(refused.applied, false);
  assert.match(refused.applied ? '' : refused.why, /setext/);
});

test('a setext section moves like any other, because a move does not rewrite a heading', async () => {
  const md = 'One\n===\n\nfirst\n\nTwo\n===\n\nsecond\n\n';
  const store = storeOf(md);
  assert.equal((await applyOutlineAction(store, startOf(md, 'Two'), 'move-up')).applied, true);
  assert.equal(textOfStore(store), 'Two\n===\n\nsecond\n\nOne\n===\n\nfirst\n\n');
  // With one line ending after the last paragraph and a setext heading to sit above, the paragraph would join the heading: refused.
  const tight = 'One\n===\n\nfirst\n\nTwo\n===\n\nsecond\n';
  const other = storeOf(tight);
  const refused = await applyOutlineAction(other, startOf(tight, 'Two'), 'move-up');
  assert.equal(refused.applied, false);
  assert.equal(textOfStore(other), tight);
});

test('the last section with no final line ending: moved up the file still has none, and moved back the bytes return', async () => {
  const md = '# A\n\na\n\n# B\n\nb';
  const store = storeOf(md);
  assert.equal((await applyOutlineAction(store, startOf(md, 'B'), 'move-up')).applied, true);
  assert.equal(textOfStore(store), '# B\n\nb\n\n# A\n\na');
  assert.equal((await applyOutlineAction(store, startOf(textOfStore(store), 'B'), 'move-down')).applied, true);
  assert.equal(textOfStore(store), md);
});

test('a move that would run a paragraph into a setext heading is refused, with the file untouched', async () => {
  const md = '# A\na\n\nB\n===\nb\n# C\nc';
  const store = storeOf(md);
  const result = await applyOutlineAction(store, startOf(md, 'C'), 'move-up');
  assert.equal(result.applied, false);
  assert.match(result.applied ? '' : result.why, /code or a heading/);
  assert.equal(textOfStore(store), md);
  assert.equal(store.snapshot().canUndo, false);
});

test('a move that flips a fence\'s parity is refused: code would become a heading and a heading code (commitment 4)', async () => {
  for (const md of ['# A\n~~~\n# H\n~~~\n# B\n~~~\ny\n', '# A\n```\n# H\n```\n# B\n```\ny\n']) {
    const store = storeOf(md);
    const result = await applyOutlineAction(store, startOf(md, 'B'), 'move-up');
    assert.equal(result.applied, false, md);
    assert.equal(result.applied ? '' : result.why, 'Not moved · the file is unchanged · moving it would change what is code or a heading here');
    assert.equal(textOfStore(store), md);
    assert.equal(store.snapshot().canUndo, false);
  }
});

test('a move that would draw a link reference definition into a setext heading is refused', async () => {
  const md = 'x\n\n[ref]: http://x.example\n# P\n\nTitle\n===\n';
  const store = storeOf(md);
  const result = await applyOutlineAction(store, startOf(md, 'Title'), 'move-up');
  assert.equal(result.applied, false);
  assert.match(result.applied ? '' : result.why, /code or a heading/);
  assert.equal(textOfStore(store), md);
});

test('a heading in a quote or a list item is not moved, and the reason says so', async () => {
  const md = '# A\n\n> ## Q\n> text\n\n- ### L\n\n# B\n';
  const store = storeOf(md);
  for (const [title, action] of [['Q', 'move-up'], ['Q', 'move-down'], ['L', 'move-up'], ['L', 'move-down']] as const) {
    const result = await applyOutlineAction(store, startOf(md, title), action);
    assert.equal(result.applied, false);
    assert.match(result.applied ? '' : result.why, /inside a quote or a list item/, `${title} ${action}`);
  }
  assert.equal(textOfStore(store), md);
});

test('a range that holds a byte that is not UTF-8 is not moved: the splice would write U+FFFD over it', async () => {
  const bytes = new Uint8Array([...enc.encode('# A\n\n'), 0xff, ...enc.encode('\n\n# B\n\nb\n')]);
  const store = openDocumentStore({ writeFileAtomic: async () => {} }, '/o.md', bytes);
  const start = store.snapshot().ast.children.filter((b) => b.type === 'heading')[1]!.src.start;
  const before = [...store.snapshot().buffer.bytes];
  const result = await applyOutlineAction(store, start, 'move-up');
  assert.equal(result.applied, false);
  assert.match(result.applied ? '' : result.why, /not text/);
  assert.deepEqual([...store.snapshot().buffer.bytes], before);
  assert.equal(availableActions(store.snapshot().ast, store.snapshot().buffer, start)['move-up'].ok, false);
});

test('a heading that is no longer there, and a file that is not Markdown, are refused', async () => {
  const store = storeOf('# A\n\n# B\n');
  const gone = await applyOutlineAction(store, 999, 'move-up');
  assert.equal(gone.applied, false);
  assert.match(gone.applied ? '' : gone.why, /no longer there/);
  const code = openDocumentStore({ writeFileAtomic: async () => {} }, '/x.py', enc.encode('# not a heading\n\n# nor this\n'), undefined, { lazy: true });
  const refused = await applyOutlineAction(code, 0, 'move-down');
  assert.equal(refused.applied, false);
});

test('availableActions says which of the four would change the document', () => {
  const md = '# A\n\n## B\n\n## C\n\nSub\n---\n';
  const store = storeOf(md);
  const snap = store.snapshot();
  const can = (title: string) => availableActions(snap.ast, snap.buffer, startOf(md, title));
  assert.deepEqual(Object.fromEntries(Object.entries(can('B')).map(([k, v]) => [k, v.ok])), { 'move-up': false, 'move-down': true, promote: true, demote: true });
  assert.equal(can('B')['move-up'].why.length > 0, true);
  assert.equal(can('A').promote.ok, false, 'h1 cannot be promoted');
  assert.equal(can('C').demote.ok, true, 'Sub is C\'s sibling, not inside it, so C\'s section holds no setext heading');
  assert.equal(can('Sub').demote.ok, false, 'a setext heading is declined by E-07');
  assert.equal(can('Sub').demote.why.includes('setext'), true);
});

// ---- the differential: the app's move against the reference splice -----------------------------------------------------

test('differential: over random Markdown the app\'s move is the reference splice byte for byte, one undo step restores the file, and a refusal is one the reparse justifies', async () => {
  let moves = 0;
  let refused = 0;
  const actions: [OutlineAction, 'up' | 'down'][] = [['move-up', 'up'], ['move-down', 'down']];
  for (let seed = 1; seed <= 300; seed++) {
    const { text, gen } = generate(seed);
    const top = parseMarkdown(enc.encode(text), { file: 'o.md' }).children.filter((b) => b.type === 'heading');
    assert.equal(top.length, gen.sections.length, `seed ${seed}: the parse and the generator agree on the sections`);
    // The list holds those and the headings the generator hid in a quote and a list item, and nothing from a fence or front matter.
    const listed = headings(text).length;
    assert.ok(listed >= top.length && listed <= top.length + 2 * gen.sections.length, `seed ${seed}: ${listed} rows for ${top.length} sections`);
    for (let at = 0; at < gen.sections.length; at++) {
      for (const [action, direction] of actions) {
        const want = reference(text, gen, at, direction);
        const store = storeOf(text);
        const where = `seed ${seed}, ${action} section ${at}: ${JSON.stringify(text)}`;
        const result = await applyOutlineAction(store, top[at]!.src.start, action);
        if (want === null) {
          assert.equal(result.applied, false, `moved where the reference has no move: ${where}`);
          assert.equal(textOfStore(store), text, where);
          continue;
        }
        if (!result.applied) {
          // Only the shape check may refuse a move the reference makes: the reference's bytes must really have changed the blocks.
          assert.match(result.why, /code or a heading/, where);
          const keys = (t: string) => { const b = enc.encode(t); return blockKeys(parseMarkdown(b, { file: 'o.md' }), b).sort().join('\n'); };
          assert.notEqual(keys(want), keys(text), `refused a move that keeps the blocks: ${where}`);
          assert.equal(textOfStore(store), text, where);
          refused++;
          continue;
        }
        assert.equal(textOfStore(store), want, where);
        assert.equal(store.snapshot().version, 1, 'one transition');
        const to = direction === 'up' ? sectionIndexAfterUp(gen, at) : sectionIndexAfterDown(gen, at);
        const landed = parseMarkdown(store.snapshot().buffer.bytes, { file: 'o.md' }).children.filter((b) => b.type === 'heading')[to]!;
        assert.equal(landed.src.start, result.start, `the heading is where the result says: ${where}`);
        await store.undo();
        assert.equal(textOfStore(store), text, `one undo restores the bytes: ${where}`);
        moves++;
      }
    }
  }
  assert.ok(moves > 400, `${moves} moves were compared`);
  assert.ok(refused < moves / 5, `${refused} refusals against ${moves} moves`);
});

test('the Outline\'s sections add up to the status bar\'s total on a file with front matter, a fence, a comment and Chinese (F-86)', () => {
  const fence = Array.from({ length: 10 }, (_, i) => `code${i}`).join(' ');
  const md = `---\ntitle: Front matter words\ntags: a b c\n---\n\nIntro before any heading.\n\n# One\n\nAlpha beta gamma.\n\n\`\`\`js\n# not a heading\n${fence}\n\`\`\`\n\n## Two\n\n<!-- a note\nhidden words -->\n\n我们今天去公园 epsilon.\n\n    indented code here\n`;
  const bytes = enc.encode(md);
  const model = outlineModelOf(parseMarkdown(bytes, { file: 'o.md' }), createBuffer('o.md', bytes));
  const rows = model.rows.filter((r): r is HeadingRow => r.kind === 'heading');
  assert.equal(rows.length, 2);
  // The bar: fed in small pieces as it does, then read through its own item.
  const counter = createWordCounter({ markdown: countsAsMarkdown('o.md') });
  for (let i = 0; i < md.length; i += 7) counter.feed(md.slice(i, i + 7));
  const bar = counter.done();
  const item = statusItems({
    document: {
      kind: 'article', path: 'o.md', words: bar, lines: 1, caret: null, heading: null, eol: 'lf', rows: 1,
      encoding: { label: 'UTF-8', title: '' },
    },
    theme: 'Paper', textSize: 20, indexing: false,
  }).find((i) => i.id === 'measure')!;
  const before = countWords(dec.decode(bytes.subarray(0, rows[0]!.start)), { markdown: true });
  const outer = rows.filter((r) => r.depth === 0);
  assert.equal(item.text, wordsLabel(before + outer.reduce((n, r) => n + r.words, 0)));
  assert.equal(rows[0]!.words, 1 + 3 + 1 + 4 + 1, 'One, Alpha beta gamma, Two, 我们今天去公园 as 4 words, epsilon');
});
