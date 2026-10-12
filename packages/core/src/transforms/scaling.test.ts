// Every transform's cost grows with the text, not with its square (J-03). The result sheet runs a transform on the
// whole document at once, so a step that rescans the text per list, table or heading freezes the window on a large file.
// The check is a ratio, not a time budget, so a slow machine does not fail it (ADR-0032): ten times the text may take
// at most thirty times as long. A quadratic step takes about a hundred times as long.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { parseText } from './prose.ts';
import { TRANSFORMS, runTransform } from './registry.ts';

// One of everything a transform reads structure from: lists of each kind, nested and side by side, tables, ATX and
// setext headings, code, math, footnotes, quotes, rules and prose with marks.
const BLOCK = [
  '## Section',
  '',
  'Some *prose* with **bold**, a [link](https://example.com), a citation [1], an emoji 🚀 and "quotes" -- here...',
  'Is this a question?',
  '',
  '* one',
  '* two',
  '  + nested',
  '+ three',
  '',
  '1. first',
  '2. second',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | =2 |',
  '',
  '```sh',
  '$ echo hi',
  '```',
  '',
  'Setext',
  '------',
  '',
  '> quoted `src/a.ts`',
  '',
  '$$',
  'x^2',
  '$$',
  '',
  '- [ ] a task[^n]',
  '',
  '[^n]: a note',
  '',
  '***',
  '',
].join('\n');

const textOf = (bytes: number): string => `---\ntitle: scaling\n---\n\n${BLOCK.repeat(Math.ceil(bytes / BLOCK.length))}`;
const SMALL = textOf(20_000);
const LARGE = textOf(200_000);

/** The fastest of `runs` calls of `f`, in ms, each after an untimed `before`. */
function best(runs: number, f: () => void, before = (): void => {}): number {
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    before();
    const start = performance.now();
    f();
    min = Math.min(min, performance.now() - start);
  }
  return min;
}

/** Ratios over thirty, where the large run took long enough (over `floor` ms) for the ratio to mean something. */
const superlinear = (rows: { id: string; small: number; large: number }[], floor: number): string[] =>
  rows
    .filter(({ small, large }) => large > floor && large > 30 * small)
    .map(({ id, small, large }) => `${id}: ${small.toFixed(1)} ms at 20 KB, ${large.toFixed(0)} ms at 200 KB`);

test('ten times as many list items take at most twenty times as long to parse', () => {
  // mdast-util-from-markdown before 2.1.0 spliced into its whole event list once per list item: 39 times as long here,
  // against 11 since. Lists alone, because that is where it was quadratic; the tighter ratio because the parse's fixed
  // cost hides some of the curve at these sizes.
  const enc = new TextEncoder();
  const lists = (bytes: number): Uint8Array => enc.encode('* one\n* two\n\npara\n\n'.repeat(bytes / 20));
  const small = best(3, () => parseMarkdown(lists(40_000)));
  const large = best(3, () => parseMarkdown(lists(400_000)));
  assert.ok(large < 20 * small, `parse: ${small.toFixed(0)} ms at 40 KB, ${large.toFixed(0)} ms at 400 KB`);
});

test('ten times the text takes at most thirty times as long, for every transform', () => {
  // The parse is checked above. Here it is done before the clock starts (prose.ts keeps the last one, and the text is LF
  // with no BOM, so the transform's own parseText finds it), so a step that rescans the text once per node is not hidden
  // behind it. Every transform runs on the small text first, then on the large one, so each is parsed only a few times.
  const time = (id: string, text: string, runs: number): number =>
    best(runs, () => runTransform(id, text, { lang: 'sh' }), () => parseText(text));
  // The fastest of several runs on each side, because a load spike only ever makes a run slower: a quadratic step is
  // slow on every run, so the minimum still shows it, while one unlucky run no longer fails the check (F-39).
  const small = new Map(TRANSFORMS.map(({ id }) => [id, time(id, SMALL, 5)]));
  const rows = TRANSFORMS.map(({ id }) => ({ id, small: small.get(id)!, large: time(id, LARGE, 5) }));
  // Under 20 ms the ratio is mostly noise, and nothing that fast freezes a window.
  assert.deepEqual(superlinear(rows, 20), [], 'superlinear transforms');
});
