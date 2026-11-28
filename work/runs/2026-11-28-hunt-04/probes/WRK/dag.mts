import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from '../../../../../packages/core/src/parse/parse.ts';
import { handoffPieces, documentFromHandoff } from '../../../../../packages/core/src/parse/handoff.ts';
function walk(d: string, out: string[] = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.md$/.test(f)) out.push(p); } return out; }
let shared = 0, diff = 0;
for (const f of walk('fixtures')) {
  const bytes = new Uint8Array(readFileSync(f));
  const doc = parseMarkdown(bytes, { file: f });
  const seen = new Set<object>(); let dup = '';
  (function v(o: any, path: string) { if (o && typeof o === 'object') { if (seen.has(o)) { dup ||= path; return; } seen.add(o); for (const k of Object.keys(o)) v(o[k], path + '.' + k); } })(doc, 'doc');
  if (dup) { shared++; if (shared < 6) console.log('shared', f, dup); }
  let head: any; const blocks: any[] = []; let notes: any;
  for (const p of handoffPieces(doc, 2000)) { const c: any = structuredClone(p); if ('head' in c) head = c.head; else if ('blocks' in c) blocks.push(...c.blocks); else notes = c.notes; }
  const d2 = documentFromHandoff(head, blocks, notes, bytes);
  if (JSON.stringify(d2) !== JSON.stringify(doc)) { diff++; console.log('DIFF', f); }
}
console.log({ shared, diff });
