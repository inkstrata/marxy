// Rule 2: does any input make micromark's lists and the tree's definitions disagree?
// Whole parses: definitionIndex === 'unknown'. Regions: parseBlocksIn(...).agrees === false, over arbitrary line-aligned slices.
import { pathToFileURL } from 'node:url';
const WT = process.env.WT ?? 'C:/Dev/reader/worktrees/definitions-index';
const base = pathToFileURL(`${WT}/packages/core/src/parse/`).href;
const { parseMarkdown, parseBlocksIn } = await import(`${base}parse.ts`);
const fm = await import(`${base}from-mdast.ts`);

const N = Number(process.argv[2] ?? 20000);
let seed = Number(process.argv[3] ?? 7) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;
const toks = ['[', ']', '[a]', '[^a]', '[^a]:', '[a]:', ':', ' ', '  ', '    ', '\n', '\n', '\n\n', '>', '- ', '1. ', '"t"', '"', "'", '(', ')', '<u>', '<', '>', '/u', 'x', 'a', '!', '`', '```\n', '~~~\n', '===\n', '---\n', '|', '| - |', '\\', '*', '_', '$$\n', '<div>\n', '<!--', '-->', '#', '\t', '[a]: /u', '[^a]: x', '\n    ', '\n> ', '\n- '];
const enc = new TextEncoder();
let wholeUnknown = 0, regionDisagree = 0, wholes = 0, regions = 0, withDefs = 0;
const bad: string[] = [];
for (let i = 0; i < N; i++) {
  let s = '';
  const n = 1 + int(40);
  for (let k = 0; k < n; k++) s += pick(toks);
  const bytes = enc.encode(s);
  const doc = parseMarkdown(bytes, { file: '/t.md' });
  wholes++;
  const idx = fm.definitionIndex(doc);
  if (fm.definitionEntries(doc)?.length) withDefs++;
  if (idx === 'unknown') { wholeUnknown++; if (bad.length < 5) bad.push('WHOLE ' + JSON.stringify(s)); continue; }
  if (idx === undefined) continue;
  // line starts
  const starts = [0]; for (let k = 0; k < bytes.length; k++) if (bytes[k] === 10) starts.push(k + 1);
  for (let r = 0; r < 4; r++) {
    const a = starts[int(starts.length)]!; const b = starts[int(starts.length)]!;
    const [from, to] = a <= b ? [a, b] : [b, a];
    if (to === from) continue;
    const reg = parseBlocksIn(bytes, from, to, { file: '/t.md' }, idx);
    regions++;
    if (reg === null) continue;
    if (!reg.agrees) { regionDisagree++; if (bad.length < 5) bad.push(`REGION [${from},${to}) ` + JSON.stringify(s)); }
  }
}
console.log(JSON.stringify({ wholes, withDefs, wholeUnknown, regions, regionDisagree }), bad);
