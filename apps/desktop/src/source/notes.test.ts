// The notes Source finds (V-04.1): a path is called missing at the place the prose names it, never inside a code fence.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findNotes } from './notes.ts';

const gone = async (): Promise<'not-found'> => 'not-found';
const run = (text: string, path = '/r/a.md') => findNotes(text, { path, current: () => true, checkPath: gone });

test('a missing path is noted where the prose names it, not at an earlier mention inside a fence', async () => {
  const text = '```\n`docs/gone.md`\n```\n\nSee `docs/gone.md`.\n';
  const notes = (await run(text))!;
  assert.equal(notes.length, 1);
  assert.equal(text.slice(notes[0]!.start, notes[0]!.end), 'docs/gone.md');
  assert.equal(notes[0]!.line, 5, 'the prose line, not the fence');
});

test('a path named only inside a fence, or inside an unclosed one, gets no note', async () => {
  assert.deepEqual(await run('```\n`docs/gone.md`\n```\n'), []);
  assert.deepEqual((await run('```\n`docs/gone.md`\n'))!.map((n) => n.kind), ['fence']);
  assert.deepEqual(await run('~~~\n`docs/gone.md`\n~~~\n'), []);
});
