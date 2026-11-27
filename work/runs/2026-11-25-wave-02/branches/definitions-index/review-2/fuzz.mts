// Independent differential: character-level fuzz over definition-heavy text and over corpus files.
// node --experimental-strip-types fuzz.mts <docs> <seed> [corpus]
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WT = 'C:/Dev/reader/worktrees/definitions-index';
const base = pathToFileURL(`${WT}/packages/core/src/parse/`).href;
const { parseMarkdown } = await import(`${base}parse.ts`);
const { reparseMarkdown, lastReparse } = await import(`${base}reparse.ts`);

const DOCS = Number(process.argv[2] ?? 300);
let s = Number(process.argv[3] ?? 1) >>> 0;
const rnd = () => { s = (s + 0x9e3779b9) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 16), 0x85ebca6b); t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T,>(a: readonly T[]) => a[int(a.length)]!;
const enc = new TextEncoder(); const dec = new TextDecoder();

// Alphabet for single-character edits: every character that matters to labels, definitions and containers.
const alpha = ['[', ']', '^', ':', ' ', '\n', '>', '-', '1', '.', '!', '(', ')', '"', "'", '<', '>', '\\', '\t', 'a', 'A', 'b', '*', '`', '|', '#', '=', '\r', '&', 'ß'];
const lines = [
  '[a]: /u', '[A]: /v "t"', '[b]: <x y> (t)', '[a b]: /w', '[a  B]: /x', '[^1]: note one', '[^N]: note', '    indented continuation', '> [a]: /q', '> [^1]: quoted note',
  '- [b]: /l', '- item [a]', '  [^2]: nested', 'Text with [a] and [b][] and [x][a] and ![a] and [^1] and [^N] and [^zz].', 'See [a b].', '## Head [a]',
  '', '', '', '> quote [b]', '1. one [^1]', '```', '[a]: /in-fence', '| h [a] | h |', '| - | - |', '| c [^1] | d |', '[a]:', '/on-next-line', '"title-next"', 'plain', '---', '===',
];
const gen = () => { const n = 4 + int(30); const out: string[] = []; for (let i = 0; i < n; i++) out.push(pick(lines)); return out.join('\n') + '\n'; };
const mutate = (t: string): string => {
  const ops = 1 + (rnd() < 0.25 ? int(3) : 0);
  for (let k = 0; k < ops; k++) {
    const p = int(t.length + 1);
    const m = int(6);
    if (m === 0) t = t.slice(0, p) + t.slice(p + 1 + int(3));
    else if (m === 1) t = t.slice(0, p) + pick(alpha) + t.slice(p);
    else if (m === 2) t = t.slice(0, p) + pick(alpha) + t.slice(p + 1);
    else if (m === 3) { const ls = t.split('\n'); const i = int(ls.length); ls.splice(i, 0, pick(lines)); t = ls.join('\n'); }
    else if (m === 4) { const ls = t.split('\n'); if (ls.length > 1) ls.splice(int(ls.length), 1); t = ls.join('\n'); }
    else { const ls = t.split('\n'); const i = int(ls.length); const j = int(ls.length); [ls[i], ls[j]] = [ls[j]!, ls[i]!]; t = ls.join('\n'); }
  }
  return t;
};

const options = { file: '/f.md' };
let cases = 0, region = 0, regionDefs = 0, bad = 0;
const found: string[] = [];
const run = (seedText: string, chain: number) => {
  let before = enc.encode(seedText);
  let prev = parseMarkdown(before, options);
  for (let c = 0; c < chain; c++) {
    const after = enc.encode(mutate(dec.decode(before)));
    const re = reparseMarkdown(prev, before, after, options);
    const st = lastReparse();
    const wh = parseMarkdown(after, options);
    cases++;
    if (st.kind === 'region') { region++; if (/\]:/.test(dec.decode(after))) regionDefs++; }
    if (JSON.stringify(re) !== JSON.stringify(wh)) {
      bad++;
      if (found.length < 5) found.push(JSON.stringify(dec.decode(before)) + '\n  ->' + JSON.stringify(dec.decode(after)) + '  [' + st.kind + ']');
    }
    before = after; prev = re;
  }
};
if (process.argv[4] === 'corpus') {
  const dir = `${WT}/fixtures/corpus/`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(dir + f, 'utf8');
    if (!/^\[[^\]]+\]:/m.test(text) && !/^\[\^/m.test(text)) continue;
    for (let d = 0; d < DOCS; d++) {
      const ls = text.split('\n');
      // edit only a window, as a reload after a small edit does
      const i = int(ls.length);
      const w = ls.slice(Math.max(0, i - 3), i + 3).join('\n');
      const edited = mutate(w);
      const after = ls.slice(0, Math.max(0, i - 3)).concat(edited.split('\n'), ls.slice(i + 3)).join('\n');
      const before = enc.encode(text);
      const prev = parseMarkdown(before, options);
      const a = enc.encode(after);
      const re = reparseMarkdown(prev, before, a, options);
      const st = lastReparse();
      const wh = parseMarkdown(a, options);
      cases++;
      if (st.kind === 'region') region++;
      if (JSON.stringify(re) !== JSON.stringify(wh)) { bad++; if (found.length < 5) found.push(f + ' ' + JSON.stringify(edited)); }
    }
  }
} else {
  for (let d = 0; d < DOCS; d++) run(gen(), 1 + int(5));
}
console.log(JSON.stringify({ cases, region, regionDefs, bad }));
for (const f of found) console.log(f);
