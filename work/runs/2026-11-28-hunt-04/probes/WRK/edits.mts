import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from '../../../../../packages/core/src/parse/parse.ts';
import { reparseMarkdown } from '../../../../../packages/core/src/parse/reparse.ts';
import { handoffPieces, documentFromHandoff } from '../../../../../packages/core/src/parse/handoff.ts';
import * as core from '../../../../../packages/core/src/index.ts';
function walk(d: string, out: string[] = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.md$/.test(f)) out.push(p); } return out; }
const hand = (doc: any, bytes: Uint8Array) => { let head: any; const blocks: any[] = []; let notes: any; for (const p of handoffPieces(doc, 1500)) { const c: any = structuredClone(p); if ('head' in c) head = c.head; else if ('blocks' in c) blocks.push(...c.blocks); else notes = c.notes; } return documentFromHandoff(head, blocks, notes, bytes); };
const inputs: [string, Uint8Array][] = walk('fixtures').map(f => [f, new Uint8Array(readFileSync(f))]);
const enc = new TextEncoder();
inputs.push(['defs', enc.encode('[a]: http://x\n\ntext [a]\n\n```js\ncode\n```\n\n> q\n\n[^1]: n\n\nx[^1]\n')], ['deep', enc.encode('> '.repeat(80) + 'x\n')], ['unclosed', enc.encode('```\nabc\n\n- [x\n\n> `a\n')]);
let seed = 7; const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
let bad = 0, n = 0;
const ins = ['```\n', '\n\n', '[z]: u\n', '`', '[', '\n> ', '\u00e9\u{1F600}', '~~~', '    '];
for (const [f, bytes] of inputs) {
  if (bytes.length > 60000) continue;
  const page = parseMarkdown(bytes, { file: f }); const w = hand(parseMarkdown(bytes, { file: f }), bytes);
  for (let i = 0; i < 12; i++) {
    const at = rnd(bytes.length + 1); const del = rnd(4); const add = enc.encode(ins[rnd(ins.length)]!);
    const after = new Uint8Array([...bytes.subarray(0, at), ...add, ...bytes.subarray(Math.min(bytes.length, at + del))]);
    const a = reparseMarkdown(page, bytes, after, { file: f }); const b = reparseMarkdown(w, bytes, after, { file: f });
    n++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; if (bad < 5) console.log('EDIT DIFF', f, at, del); }
    if (JSON.stringify(a) !== JSON.stringify(parseMarkdown(after, { file: f }))) { console.log('reparse != parse (not axis)', f); }
  }
  // index/notes
  if (JSON.stringify(core.definitionIndex?.(page)) !== JSON.stringify(core.definitionIndex?.(w))) console.log('index differs', f);
}
console.log({ n, bad });
