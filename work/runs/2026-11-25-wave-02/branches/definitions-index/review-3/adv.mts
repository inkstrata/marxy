// Adversarial differential for the seeded region reparse: node --experimental-strip-types adv.mts <seeds> [firstSeed]
// Chains edits like a live reload (each reparse is the next previous) and holds every step to parseMarkdown,
// both the tree and the carried definition index.
import { writeFileSync } from 'node:fs';
const W = 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(W + 'parse.ts');
const { reparseMarkdown, lastReparse } = await import(W + 'reparse.ts');
const { definitionIndex } = await import(W + 'from-mdast.ts');

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = ['a', 'A', 'ẞ', 'ss', 'SS', 'ß', 'a b', 'a  b', 'A\tB', 'a\nb', 'Foo', 'foo', 'ǅ', 'Ǆ', 'İ', 'i̇', 'K', 'k', 'Ω', 'ω', 'x', 'σ', 'ς', 'Σ', 'ﬀ', 'FF'];
const FN = ['1', 'n', 'N', 'ẞ', 'ss', 'a b', 'A  B'];
const URLS = ['/u', '/v', '<a b>', '/u "t"', "/u 't'", '/u (t)', '/v "t"', '/u\n"t"', "/u 'line\nbreak'", '\n/u', '/u "t" x', '<>', '/u ""'];

function gen(r: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const L = () => pick(LABELS);
  const F = () => pick(FN);
  const linkDef = () => `[${L()}]: ${pick(URLS)}`;
  const ref = () => pick([`[${L()}]`, `[${L()}][]`, `[t][${L()}]`, `![${L()}]`, `[^${F()}]`, `[${L()}](/inline)`, `[^${F()}]: not`, '[', ']']);
  const para = () => {
    const n = 1 + Math.floor(r() * 3);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) lines.push(pick(['text ', 'see ', '', 'x ']) + ref() + pick(['', ' end', ' ' + ref()]));
    return lines.join('\n');
  };
  const prefixes = ['', '', '', '> ', '- ', '1. ', '   ', ' ', '> - ', '- > ', '\t', '>\t'];
  const pieces: (() => string)[] = [
    linkDef, linkDef, linkDef, para, para, para,
    () => `[^${F()}]: ${para()}`,
    () => `[^${F()}]: x\n    ${linkDef()}`,
    () => `[^${F()}]:\n    ${para()}\n\n    ${pick([linkDef(), para()])}`,
    () => `# ${ref()}`,
    () => `${para()}\n${pick(['===', '---', '-', '='])}`,
    () => `${linkDef()}\n${pick(['===', '---', 'lazy', '"t"', '  "t"'])}`,
    () => `| ${ref()} | b |\n|---|---|\n| ${ref()} | c |`,
    () => '```\n' + linkDef() + '\n```',
    () => `    ${linkDef()}`,
    () => `<div>\n${linkDef()}\n</div>`,
    () => `- ${para()}\n\n  ${linkDef()}`,
    () => `> ${para()}\n${pick(['lazy ' + ref(), '> ' + linkDef(), linkDef()])}`,
    () => `${pick(prefixes)}${linkDef()}`,
    () => `${pick(prefixes)}${para()}`,
  ];
  const n = 2 + Math.floor(r() * 9);
  let out = '';
  for (let i = 0; i < n; i++) out += pick(pieces)() + pick(['\n\n', '\n\n', '\n', '\n\n\n']);
  const eol = r();
  if (eol < 0.15) out = out.replace(/\n/g, '\r\n');
  else if (eol < 0.2) out = out.replace(/\n/g, () => (r() < 0.5 ? '\r\n' : '\n'));
  else if (eol < 0.22) out = out.replace(/\n/g, '\r');
  if (r() < 0.08) out = '\ufeff' + out;
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function edit(r: () => number, text: string): string {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] !== '\n')) lineStarts.push(i + 1);
  const at = Math.floor(r() * (text.length + 1));
  const line = pick(lineStarts);
  const k = r();
  if (k < 0.18) {
    // swap one label occurrence for another
    const opens = [...text.matchAll(/\[\^?([^\]\[]{0,6})\]/g)];
    if (opens.length) {
      const m = pick(opens);
      const s = m.index! + (m[0][1] === '^' ? 2 : 1);
      return text.slice(0, s) + pick([...LABELS, ...FN]) + text.slice(s + m[1]!.length);
    }
  }
  if (k < 0.3) {
    // toggle a blank line at a line start
    if (line > 0 && (text[line - 1] === '\n') && (text[line - 2] === '\n')) return text.slice(0, line - 1) + text.slice(line);
    return text.slice(0, line) + '\n' + text.slice(line);
  }
  if (k < 0.45) {
    // add or drop a container prefix / indentation at a line start
    const p = pick(['> ', '- ', '  ', '    ', ' ', '\t', '1. ', '[^n]: ', '===\n', '---\n', '"t"\n', 'lazy\n', '[a]: /u\n', '[A]: /u\n', '[ss]: /u\n', '[^n]: x\n', '\n']);
    const rest = text.slice(line);
    for (const d of ['> ', '- ', '    ', '  ', ' ', '\t', '1. ']) if (r() < 0.3 && rest.startsWith(d)) return text.slice(0, line) + rest.slice(d.length);
    return text.slice(0, line) + p + rest;
  }
  if (k < 0.65) {
    const f = pick(['x', ' ', '\n', '\r\n', '[', ']', ':', ']:', '[a]', '[ss]', '[^n]', '"', "'", '(', ')', '<', '>', '\t', '\\', '`', '!', 'ẞ', '\ufeff', '[x]: /x\n', '\n\n', '- ', '> ', '|']);
    return text.slice(0, at) + f + text.slice(at);
  }
  if (k < 0.85) {
    const len = 1 + Math.floor(r() * 6);
    return text.slice(0, at) + text.slice(at + len);
  }
  // replace a character
  return text.slice(0, at) + pick(['x', ' ', '\n', ']', '[', ':', '"']) + text.slice(at + 1);
}

const strip = (d: unknown) => JSON.stringify(d);
function idx(d: object) {
  const i = definitionIndex(d);
  if (i === undefined || i === 'unknown') return String(i);
  return JSON.stringify({
    e: i.entries.map((e: any) => [e.kind, e.identifier, e.url, e.title, e.start, e.end]),
    t: [...i.targets.entries()],
    l: [...i.links].map((s: string) => s.toLowerCase()).sort(),
    f: [...new Set([...i.footnotes].map((s: string) => s.toLowerCase()))].sort(),
  });
}

const seeds = Number(process.argv[2] ?? 200);
const first = Number(process.argv[3] ?? 1);
const steps = Number(process.argv[4] ?? 20);
let cases = 0, region = 0, fails = 0, idxFails = 0, unknown = 0;
const reasons = new Map<string, number>();
for (let s = first; s < first + seeds; s++) {
  const r = rng(s);
  let text = gen(r);
  let bytes = enc.encode(text);
  let prev = parseMarkdown(bytes, { file: 'f.md' });
  for (let step = 0; step < steps; step++) {
    const nextText = edit(r, text);
    if (nextText === text) continue;
    const after = enc.encode(nextText);
    const got = reparseMarkdown(prev, bytes, after, { file: 'f.md' });
    const stats = lastReparse();
    const want = parseMarkdown(after, { file: 'f.md' });
    cases++;
    if (stats.kind === 'region') region++;
    else reasons.set(stats.reason ?? '?', (reasons.get(stats.reason ?? '?') ?? 0) + 1);
    if (definitionIndex(want) === 'unknown') unknown++;
    if (strip(got) !== strip(want)) {
      fails++;
      if (fails <= 5) {
        writeFileSync(`C:/Dev/reader/work/wave2/definitions-index/review-3/fail-${s}-${step}.json`, JSON.stringify({ before: text, after: nextText, kind: stats.kind }));
        console.log('MISMATCH seed', s, 'step', step, stats.kind, JSON.stringify(text), '=>', JSON.stringify(nextText));
      }
      prev = want;
    } else if (stats.kind === 'region' && idx(got) !== idx(want)) {
      idxFails++;
      if (idxFails <= 5) {
        writeFileSync(`C:/Dev/reader/work/wave2/definitions-index/review-3/idx-${s}-${step}.json`, JSON.stringify({ before: text, after: nextText, got: idx(got), want: idx(want) }));
        console.log('INDEX MISMATCH seed', s, 'step', step, JSON.stringify(text), '=>', JSON.stringify(nextText));
      }
      prev = got;
    } else prev = got;
    text = nextText;
    bytes = after;
  }
}
console.log(JSON.stringify({ seeds, cases, region, fails, idxFails, unknownWhole: unknown, reasons: Object.fromEntries(reasons) }));
void dec;
