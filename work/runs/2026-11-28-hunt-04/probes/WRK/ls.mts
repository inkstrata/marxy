import { parseMarkdown } from '../../../../../packages/core/src/parse/parse.ts';
import { handoffPieces, documentFromHandoff } from '../../../../../packages/core/src/parse/handoff.ts';
import { lineStartAt } from '../../../../../packages/core/src/sourcemap/line-starts.ts';
const B = (...a: (string|number[])[]) => new Uint8Array(a.flatMap(x => typeof x === 'string' ? [...new TextEncoder().encode(x)] : x));
const cases: Record<string, Uint8Array> = {
  dbl: B([0xef,0xbb,0xbf,0xef,0xbb,0xbf], '# a\n\n- b\n  > # c\n'),
  one: B([0xef,0xbb,0xbf], '# a\r\n\r\n- b\r  > # c\n'),
  bad: B('# a\n', [0xff,0xfe,0xc3], '\n\n- x\n  > # h\n'),
  u16: B([0xff,0xfe], '#\0 \0a\0\n\0\n\0-\0 \0b\0\n\0'.replace(/\0/g,'\0')),
  mid: B('x\n', [0xef,0xbb,0xbf], '# y\n\n- z\n  > # w\n'),
  lone: B('a\r\r- b\r  > # c\r'),
};
for (const [k, bytes] of Object.entries(cases)) {
  const here = parseMarkdown(bytes, { file: 'f' });
  let head: any; const blocks: any[] = []; let notes: any;
  for (const p of handoffPieces(here)) { const c: any = structuredClone(p); if ('head' in c) head = c.head; else if ('blocks' in c) blocks.push(...c.blocks); else notes = c.notes; }
  const there = documentFromHandoff(head, blocks, notes, bytes);
  const bad: number[] = [];
  for (let i = 0; i <= bytes.length; i++) if (lineStartAt(here, i) !== lineStartAt(there, i)) bad.push(i);
  console.log(k, bad.length ? 'DIFF at ' + bad.join(',') + ' here=' + bad.map(i => lineStartAt(here, i)) + ' there=' + bad.map(i => lineStartAt(there, i)) : 'same', JSON.stringify(here) === JSON.stringify(there));
}
