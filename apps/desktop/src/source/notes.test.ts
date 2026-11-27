// The notes Source finds: a path is called missing at the place the prose names it, never inside a code fence.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findNotes } from './notes.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

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

test('a file that is not Markdown is not parsed as Markdown: a path in an indented comment is found, fast', async () => {
  const code = `const a = 1;\n\n    // see \`docs/gone.md\`\n    return 1;\n`;
  const notes = (await run(code, '/r/a.ts'))!;
  assert.deepEqual(notes.map((n) => [n.kind, n.line]), [['path', 3]], 'Markdown would have read the indented line as code');
  assert.deepEqual(await findNotes(code, { path: '/r/a.ts', current: () => true, checkPath: null }), []);
  const big = `${'    const x = [1, 2, 3]; // `a/b`\n'.repeat(100_000)}// \`docs/gone.md\`\n`;
  const t = cpuNow();
  assert.equal((await run(big, '/r/big.ts'))!.length, 1);
  assert.ok(cpuNow() - t < 500, `${Math.round(cpuNow() - t)} ms`);
});

test('a Markdown file still parses: a path inside a fence is not noted, a heading jump is', async () => {
  const md = '# a\n\n### b\n\n```\n`docs/gone.md`\n```\n';
  assert.deepEqual((await run(md, '/r/a.md'))!.map((n) => n.kind), ['heading']);
});
