import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineColumnAt, notesOf } from './notes.ts';

const words = (lf: string): string[] => notesOf(lf).map((n) => `${n.kind}@${n.line}:${n.column} ${n.words}`);

const CASES: readonly (readonly [name: string, text: string, want: string[]])[] = [
  ['an unclosed fence at EOF gives one note at its opener', 'Intro\n\n```js\nconst a = 1;\nmore\n', ['fence@3:1 Fence opened at 3:1 is never closed']],
  ['an opener alone on the last line is unclosed', 'x\n\n```', ['fence@3:1 Fence opened at 3:1 is never closed']],
  ['a tilde fence is unclosed by a backtick run', '~~~\ncode\n```\n', ['fence@1:1 Fence opened at 1:1 is never closed']],
  ['an unclosed fence inside a list names its place', '- a\n\n  ```\n  x\n', ['fence@3:3 Fence opened at 3:3 is never closed']],
  ['## then #### gives one note at the second heading', '## A\n\ntext\n\n#### B\n', ['heading@5:1 Heading at 5:1 jumps from level 2 to level 4']],
  ['a setext heading counts as a level', 'A\n=\n\n### B\n', ['heading@4:1 Heading at 4:1 jumps from level 1 to level 3']],
  ['# then ## gives none', '# A\n\n## B\n\n### C\n', []],
  ['going back up never counts', '# A\n\n## B\n\n### C\n\n#### D\n\n# E\n\n### F\n', ['heading@11:1 Heading at 11:1 jumps from level 1 to level 3']],
  ['a first heading that starts deep has nothing before it', '### A\n\n#### B\n', []],
  ['a fence closed by a longer run gives none', '```\ncode\n`````\n', []],
  ['a fence closed by its own run gives none', '```\ncode\n```\n', []],
  ['a block-quoted fence closed behind its marker gives none', '> ```\n> x\n> ```\n', []],
  ['a heading inside a fence is not a heading', '# A\n\n```\n#### not\n```\n', []],
  ['an indented block has no fence to close', '    indented\n    code\n', []],
  ['one of each', '# A\n\n### B\n\n```\nopen\n', ['heading@3:1 Heading at 3:1 jumps from level 1 to level 3', 'fence@5:1 Fence opened at 5:1 is never closed']],
];

for (const [name, text, want] of CASES) test(`notes: ${name}`, () => assert.deepEqual(words(text), want));

test('a note carries its range as UTF-16 offsets and as bytes', () => {
  const lf = 'é\n\n```\nx\n';
  const [note] = notesOf(lf);
  assert.ok(note);
  assert.equal(lf.slice(note.start, note.end), '```');
  assert.equal(note.start, 3);
  assert.equal(note.byteStart, 4, 'the é is two bytes');
});

test('lineColumnAt counts from 1 and is the editor position', () => {
  assert.deepEqual(lineColumnAt('a\nbc\nd', 0), { line: 1, column: 1 });
  assert.deepEqual(lineColumnAt('a\nbc\nd', 3), { line: 2, column: 2 });
  assert.deepEqual(lineColumnAt('a\nbc\nd', 5), { line: 3, column: 1 });
});

test('notes do not change the text they read', () => {
  const lf = '# A\n\n### B\n\n```\nopen\n';
  const before = lf.slice();
  notesOf(lf);
  assert.equal(lf, before);
});
