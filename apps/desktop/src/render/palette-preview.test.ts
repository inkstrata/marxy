// W-13: what the palette's preview reads, shows and waits for. The pure half of render/palette-preview.ts under Node:
// the bound on a read, the cut at forty lines, the section of a heading, the transform's 1,400 characters, and the pause
// that keeps a held arrow key from reading anything. Drawing into the column is the WebKit test's (test/palette-preview.test.mjs).
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { MEASURE_READ_BYTES } from '../library/measure.ts';
import { LARGE_FILE_BYTES } from '../source/language.ts';
import {
  commandPreview,
  createPreviewFollower,
  filePreview,
  firstLines,
  lineCount,
  looksBinary,
  PREVIEW_LINES,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_CHARS,
  PREVIEW_PAUSE_MS,
  PREVIEW_READ_BYTES,
  previewReadBytes,
  sectionPreview,
  sectionRange,
  setAs,
  sizeLabel,
  TRANSFORM_INPUT_CHARS,
  transformPreview,
  withoutFrontMatter,
  type PreviewData,
} from './palette-preview.ts';

const enc = new TextEncoder();
const entry = (path: string, text: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({
  path,
  root: '/r',
  title: path.slice(path.lastIndexOf('/') + 1),
  headings: [],
  mtimeMs: 1,
  size: enc.encode(text).length,
  kind: 'markdown',
  ...extra,
});

test('the bounds are the shell cap and the large-file limit, not numbers of their own', () => {
  assert.equal(PREVIEW_READ_BYTES, MEASURE_READ_BYTES, 'one readHead cap for the library and the preview');
  assert.equal(PREVIEW_READ_BYTES, 256 * 1024);
  assert.equal(PREVIEW_MAX_BYTES, LARGE_FILE_BYTES, 'a file Source calls large is not previewed');
  assert.equal(PREVIEW_LINES, 40);
  assert.equal(TRANSFORM_INPUT_CHARS, 1_400);
  assert.equal(PREVIEW_PAUSE_MS, 200);
});

test('a preview reads at most 256 KB, and nothing for a file over the large-file limit', () => {
  assert.equal(previewReadBytes({ size: 1_200 }), PREVIEW_READ_BYTES);
  assert.equal(previewReadBytes({ size: LARGE_FILE_BYTES }), PREVIEW_READ_BYTES);
  assert.equal(previewReadBytes({ size: LARGE_FILE_BYTES + 1 }), 0);
  assert.equal(previewReadBytes({ size: 900 * 1024 * 1024 }), 0);
});

test('a file over the large-file limit says what the index knows, and "Too large to preview"', () => {
  const big = entry('/r/dump.log', '', { size: 9 * 1024 * 1024, kind: 'source', readerKind: 'log' });
  const p = filePreview(big, null);
  assert.deepEqual(p.chips, ['Log', '9.0 MB']);
  assert.equal(p.notice, 'Too large to preview');
  assert.equal(p.body, undefined);
});

test('the first forty lines are cut at the line, and one very long line is cut at the characters', () => {
  const text = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`).join('\n');
  const shown = firstLines(text, PREVIEW_LINES, PREVIEW_MAX_CHARS);
  assert.equal(shown.text.trimEnd().split('\n').length, 40);
  assert.ok(shown.text.endsWith('line 40'.concat('\n')) || shown.text.endsWith('line 40'));
  assert.equal(shown.cut, true);
  assert.equal(firstLines('a\nb\n', 40, 100).cut, false);
  const crlf = firstLines('a\r\nb\r\nc\r\n', 2, 100);
  assert.equal(crlf.text, 'a\r\nb\r\n');
  const one = firstLines('x'.repeat(250_000), PREVIEW_LINES, PREVIEW_MAX_CHARS);
  assert.equal(one.text.length, PREVIEW_MAX_CHARS);
  assert.equal(one.cut, true);
  // Never between the halves of a surrogate pair.
  const emoji = firstLines('\u{1F600}'.repeat(10), 5, 5);
  assert.equal(emoji.text.length, 4);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount(''), 0);
});

test('a Markdown file: its kind, its words, its size, near copies when the library found some', () => {
  const text = '# Plan\n\nOne two three four five.\n\nSix seven.\n';
  const e = entry('/r/plan.md', text, { readerKind: 'report' });
  const p = filePreview(e, enc.encode(text), 0);
  assert.equal(p.chips[0], 'Report');
  assert.match(p.chips[1]!, /^\d+ words$/);
  assert.ok(!p.chips.some((c) => /near/.test(c)), 'no chip unless the check found some');
  assert.equal(p.body?.as, 'markdown');
  assert.equal(filePreview(e, enc.encode(text), 2).chips.at(-1), '2 near copies');
  assert.equal(filePreview(e, enc.encode(text), 1).chips.at(-1), '1 near copy');
});

test('a read that stopped short says so: words and lines are a floor, with a plus', () => {
  const e = entry('/r/long.md', '', { size: 400_000 });
  const p = filePreview(e, enc.encode('alpha beta gamma\n'), 0);
  assert.match(p.chips[1]!, /^3\+ words$/);
  assert.equal(p.body?.cut, true);
});

test('a log is set as a log and code as code in its language; a lines chip, not words', () => {
  const log = 'ERROR 2026-10-12 12:00:01 boom\nINFO next\n';
  const lp = filePreview(entry('/r/build.log', log, { kind: 'source', readerKind: 'log' }), enc.encode(log));
  assert.equal(lp.body?.as, 'code');
  assert.equal(lp.body?.lang, 'log');
  assert.equal(lp.chips[1], '2 lines');
  const py = 'def f():\n    return 1\n';
  const cp = filePreview(entry('/r/x.py', py, { kind: 'source', readerKind: 'code' }), enc.encode(py));
  assert.equal(cp.body?.as, 'code');
  assert.equal(cp.body?.lang, 'python');
  assert.deepEqual(setAs('/r/a.csv', 'data'), { as: 'code' });
  assert.deepEqual(setAs('/r/a.html', 'html'), { as: 'code', lang: 'html' });
  assert.deepEqual(setAs('/r/a.txt', 'article'), { as: 'markdown' });
});

test('a binary file shows no text, and an empty one says so', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]);
  assert.equal(looksBinary(bytes), true);
  const p = filePreview(entry('/r/pic.md', '', { size: 8 }), bytes);
  assert.equal(p.body, undefined);
  assert.match(p.notice!, /Not text/);
  assert.equal(filePreview(entry('/r/empty.md', '', { size: 0 }), new Uint8Array(0)).notice, 'Empty file');
});

test('front matter is set aside and named, not shown', () => {
  const text = '---\ntitle: A\nstatus: draft\n---\n# Body\n';
  assert.deepEqual(withoutFrontMatter(text), { text: '# Body\n', note: 'Front matter · 2 keys' });
  assert.deepEqual(withoutFrontMatter('# No front matter\n'), { text: '# No front matter\n' });
  const p = filePreview(entry('/r/a.md', text), enc.encode(text));
  assert.equal(p.frontMatter, 'Front matter · 2 keys');
  assert.equal(p.body?.text, '# Body\n');
});

test('a heading\'s section runs to the next heading of its level or above', () => {
  const text = '# Guide\n\nintro\n\n## Install\n\nrun it\n\n### Flags\n\n-f\n\n## Use\n\nuse it\n';
  const at = (s: string) => enc.encode(text.slice(0, text.indexOf(s))).length;
  const headings = [
    { level: 1, text: 'Guide', byteOffset: at('# Guide') },
    { level: 2, text: 'Install', byteOffset: at('## Install') },
    { level: 3, text: 'Flags', byteOffset: at('### Flags') },
    { level: 2, text: 'Use', byteOffset: at('## Use') },
  ];
  const e = entry('/r/guide.md', text, { title: 'Guide', headings });
  assert.deepEqual(sectionRange(headings, 1, e.size), { start: at('## Install'), end: at('## Use') });
  assert.deepEqual(sectionRange(headings, 3, e.size), { start: at('## Use'), end: e.size });
  const p = sectionPreview(e, 1, enc.encode(text));
  assert.equal(p.type, 'section');
  assert.equal(p.title, 'Install');
  assert.equal(p.document, 'Guide');
  assert.equal(p.body?.text, '## Install\n\nrun it\n\n### Flags\n\n-f\n\n');
  assert.equal(p.body?.as, 'markdown');
});

test('a section past the 256 KB read says so instead of showing something else', () => {
  const headings = [{ level: 2, text: 'Far', byteOffset: 300_000 }];
  const e = entry('/r/far.md', '', { size: 400_000, headings });
  const p = sectionPreview(e, 0, enc.encode('# x\n'));
  assert.equal(p.body, undefined);
  assert.match(p.notice!, /past the first 256 KB/);
  assert.equal(sectionPreview(entry('/r/big.md', '', { size: LARGE_FILE_BYTES + 1, headings }), 0, null).notice, 'Too large to preview');
});

test('a command shows its group and key; a transform shows its result on at most 1,400 characters', () => {
  const c = commandPreview({ id: 'view.find', title: 'Find in this pane' }, 'Navigate', '⌘F');
  assert.deepEqual(c, { type: 'command', title: 'Find in this pane', group: 'Navigate', description: 'Enter runs it.', key: '⌘F' });
  const text = `${'a\n\n\n\nb\n'.repeat(1_000)}`;
  const t = transformPreview('collapse-blank', { text, scope: 'document' });
  assert.ok(t !== null);
  assert.equal(t.inputCut, true);
  assert.equal(t.inputChars, TRANSFORM_INPUT_CHARS);
  assert.ok(!t.output.includes('\n\n\n'), 'the transform ran on the cut input');
  assert.ok(t.output.length < TRANSFORM_INPUT_CHARS);
  const same = transformPreview('collapse-blank', { text: 'a\n\nb', scope: 'selection' });
  assert.equal(same?.unchanged, true);
  assert.equal(same?.inputCut, false);
  assert.equal(transformPreview('no-such-transform', { text: 'x', scope: 'selection' }), null);
});

test('a transform that would fill the column is cut, not sent whole', () => {
  const t = transformPreview('to-html', { text: '# a\n\n'.repeat(400), scope: 'document' });
  assert.ok(t !== null);
  assert.ok(t.output.length <= 2_800);
});

test('sizes are said by powers of 1,024', () => {
  assert.equal(sizeLabel(900), '900 B');
  assert.equal(sizeLabel(3_100), '3.0 KB');
  assert.equal(sizeLabel(250 * 1024), '250 KB');
  assert.equal(sizeLabel(5 * 1024 * 1024), '5.0 MB');
});

test('holding a key down reads nothing: fifty moves in a row make one preview, after the pause, for the last row', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const shown: (PreviewData | null)[] = [];
    const pending: boolean[] = [];
    const loads: string[] = [];
    const f = createPreviewFollower({ show: (d) => void shown.push(d), pending: (on) => void pending.push(on) });
    const load = (key: string) => async (): Promise<PreviewData | null> => {
      loads.push(key);
      return { type: 'command', title: key, group: 'View', description: '' };
    };
    for (let i = 0; i < 50; i++) {
      f.follow(`row ${i}`, load(`row ${i}`));
      mock.timers.tick(30); // a key repeats faster than the pause
    }
    assert.deepEqual(loads, [], 'no row was read while the key was held');
    assert.deepEqual(shown, []);
    mock.timers.tick(PREVIEW_PAUSE_MS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(loads, ['row 49']);
    assert.equal((shown[0] as { title: string }).title, 'row 49');
    assert.equal(pending.at(0), true);
    assert.equal(pending.at(-1), false);
    // The same row again changes nothing; moving off and back to the drawn one needs no new read.
    f.follow('row 49', load('row 49'));
    f.follow('row 1', load('row 1'));
    f.follow('row 49', load('row 49'));
    mock.timers.tick(PREVIEW_PAUSE_MS * 2);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(loads, ['row 49']);
    // No row to preview empties the column at once; closing forgets what was drawn.
    f.follow(null, load('none'));
    assert.equal(shown.at(-1), null);
    f.follow('row 49', load('row 49'));
    mock.timers.tick(PREVIEW_PAUSE_MS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(loads, ['row 49', 'row 49']);
  } finally {
    mock.timers.reset();
  }
});

test('an answer that arrives after the highlight moved on is dropped', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const shown: string[] = [];
    const f = createPreviewFollower({ show: (d) => void shown.push(d === null ? 'none' : (d as { title: string }).title) });
    let release!: () => void;
    const slow = new Promise<PreviewData>((resolve) => {
      release = () => resolve({ type: 'command', title: 'slow', group: 'View', description: '' });
    });
    f.follow('slow', () => slow);
    mock.timers.tick(PREVIEW_PAUSE_MS);
    f.follow('next', async () => ({ type: 'command', title: 'next', group: 'View', description: '' }));
    release();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(shown, [], 'the slow read finished but the highlight had moved');
    mock.timers.tick(PREVIEW_PAUSE_MS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(shown, ['next']);
    // A failed read leaves the column empty, never half drawn.
    f.follow('bad', () => Promise.reject(new Error('gone')));
    mock.timers.tick(PREVIEW_PAUSE_MS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(shown, ['next', 'none']);
  } finally {
    mock.timers.reset();
  }
});
