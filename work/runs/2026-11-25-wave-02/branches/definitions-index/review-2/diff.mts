// Differential: region reparse vs whole parse, aimed at definitions. Usage: node --experimental-strip-types diff.mts [cases] [seed]
import { pathToFileURL } from 'node:url';

const WT = process.env.WT ?? 'C:/Dev/reader/worktrees/definitions-index';
const base = pathToFileURL(`${WT}/packages/core/src/parse/`).href;
const { parseMarkdown } = await import(`${base}parse.ts`);
const { reparseMarkdown, lastReparse } = await import(`${base}reparse.ts`);
const fm = await import(`${base}from-mdast.ts`);

const CASES = Number(process.argv[2] ?? 20000);
let seed = Number(process.argv[3] ?? 1) >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;

const long = 'x'.repeat(998);
const labels = ['a', 'A', 'a b', 'a  b', 'a\tb', 'a\n b', 'ẞ', 'ss', 'SS', 'İ', 'i̇', 'a\\]', 'a\\*', 'b', 'c d', 'é', 'É', long, long + 'y', 'a]b', 'a[b', '^', ' a ', 'x\\\\'];
const fnLabels = ['1', 'n', 'N', 'a', 'A', 'ẞ', 'ss', 'a\\]', 'a-b', long.slice(0, 990)];
const dense = process.env.DENSE === '1';
const label = () => pick(dense ? ['a', 'A', 'b', 'a  b', 'ẞ', 'ss'] : labels);
const fnl = () => pick(dense ? ['1', 'n', 'N'] : fnLabels);
const urls = ['/u', '<a b>', 'http://x.y', '/v', '<>', '/w "t"'];
const titles = ['', ' "t"', " 't'", ' (t)', '\n  "t"', '\n"t2"', ' "unclosed', '\n  "t\n\nu"'];
const def = () => `[${label()}]: ${pick(urls)}${pick(titles)}`;
const refs = (): string => {
  const l = label();
  return pick([`[${l}]`, `[${l}][]`, `[x][${l}]`, `![${l}]`, `![x][${l}]`, `[${l}][b]`, `[a][${l}]`, `[${l}] text`, `see [${l}] and [${label()}][]`, `[^${fnl()}]`, `![^${fnl()}]`, `x[^${fnl()}]y [${l}]`, `[^${fnl()}]`, `a[^${fnl()}] b[^${fnl()}]`]);
};
const para = (): string => `${pick(['', 'Some ', '*em* '])}${refs()}${pick(['', ' tail', ' ' + refs()])}`;
const fndef = (): string =>
  pick([
    `[^${fnl()}]: body ${refs()}`,
    `[^${fnl()}]: first\n\n    second ${refs()}`,
    `[^${fnl()}]: first [^${fnl()}]\n    cont\n\n    third\n\n    fourth`,
    `[^${fnl()}]:\n    ${refs()}`,
    `[^${fnl()}]: ${refs()}\n\n    ${def()}`,
  ]);
const piece = (): string =>
  pick([
    para, para, para, def, def, def, fndef, fndef,
    () => `> ${def()}\n> ${refs()}`,
    () => `> ${refs()}\n>\n> ${def()}`,
    () => `- ${def()}\n- ${refs()}`,
    () => `- item\n\n  ${def()}`,
    () => `1. ${def()}\n\n   ${para()}`,
    () => `${para()}\n${def()}`,
    () => `${def()}\n${def()}\n${para()}`,
    () => `${para()}\n===`,
    () => `${def()}\n===`,
    () => `${def()}\n---`,
    () => `| ${refs()} | b |\n| - | - |\n| ${refs()} | d |`,
    () => `${def()}\n| h | h |\n| - | - |\n| c | c |`,
    () => '```\n' + def() + '\n```',
    () => '    ' + def(),
    () => `# ${refs()}`,
    () => `<div>\n${def()}\n</div>`,
    () => `> - ${def()}\n>   ${refs()}`,
    () => `[^${fnl()}]: a\n> [^${fnl()}]: nested ${refs()}`,
  ])();
const doc = (): string => {
  const n = 2 + int(14);
  let s = '';
  for (let i = 0; i < n; i++) s += piece() + pick(['\n\n', '\n\n', '\n\n', '\n\n\n', '\n']);
  return s;
};
const inserts = ['\n\n', '\n', ' ', '[', ']', '>', '- ', '    ', '[x]: /u', '[^q]: z', ': /u', '\\', '\n[a]: /u\n', '\n\n[a]: /u\n\n', 'a', 'A', '\n===\n', '"', '[a]', '[^1]', '!', '|', '    \n'];
const enc = new TextEncoder();
const dec = new TextDecoder();
function edit(src: Uint8Array): Uint8Array {
  const text = dec.decode(src);
  const lines = text.split(/(?<=\n)/);
  const mode = int(10);
  let out: string;
  if (mode === 0 && lines.length > 1) { const i = int(lines.length); out = lines.filter((_, k) => k !== i).join(''); } // delete line
  else if (mode === 1) { const i = int(lines.length + 1); out = [...lines.slice(0, i), pick(['\n', def() + '\n', refs() + '\n', fndef() + '\n\n']), ...lines.slice(i)].join(''); }
  else if (mode === 2 && lines.length > 1) { const i = int(lines.length - 1); const c = [...lines]; [c[i], c[i + 1]] = [c[i + 1]!, c[i]!]; out = c.join(''); }
  else if (mode === 3) { const i = int(lines.length); const c = [...lines]; c[i] = c[i]!.replace(/^\n$/, '') || pick(['\n', 'x\n']); if (c[i] === lines[i]) c[i] = '\n' + lines[i]; out = c.join(''); } // toggle blank
  else if (mode === 4) { const i = int(lines.length); const c = [...lines]; c[i] = pick(['', '> ', '- ', '    ', '  ']) + c[i]; out = c.join(''); }
  else if (mode === 5) { const i = int(lines.length); const c = [...lines]; c[i] = c[i]!.replace(/^(?:> |- |\s+)/, ''); out = c.join(''); }
  else {
    const p = int(text.length + 1);
    const del = pick([0, 0, 1, 1, 2, 5, 12]);
    out = text.slice(0, p) + (rnd() < 0.85 ? pick(inserts) : label()) + text.slice(Math.min(text.length, p + del));
  }
  return enc.encode(out);
}
function variant(src: Uint8Array): Uint8Array {
  const r = int(12);
  let t = dec.decode(src);
  if (r === 0) return enc.encode(t.replace(/\n/g, '\r\n'));
  if (r === 1) return enc.encode(t.replace(/\n/g, '\r'));
  if (r === 2) return enc.encode('\uFEFF' + t);
  if (r === 3) { // invalid UTF-8 near a definition
    const b = enc.encode(t);
    const at = t.indexOf(']:');
    if (at < 0) return b;
    const o = enc.encode(t.slice(0, at)).length;
    const bad = pick([[0xff], [0xc3], [0xe2, 0x82], [0xc3, 0x28]]);
    const out = new Uint8Array(b.length + bad.length);
    out.set(b.subarray(0, o)); out.set(bad, o); out.set(b.subarray(o), o + bad.length);
    return out;
  }
  if (r === 4) return enc.encode(t.replace(/\n\n/g, '\r\n\r\n'));
  return src;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (xs: readonly string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].sort();
function indexDiff(re: any, wh: any): string | undefined {
  const a = fm.definitionIndex(re), b = fm.definitionIndex(wh);
  if (a === undefined || b === undefined) return 'no index';
  if (a === 'unknown' || b === 'unknown') return a === b ? undefined : `unknown mismatch ${a} vs ${b}`;
  const ea = a.entries.map((e: any) => [e.kind, e.identifier, e.url, e.title, e.start, e.end].join('|'));
  const eb = b.entries.map((e: any) => [e.kind, e.identifier, e.url, e.title, e.start, e.end].join('|'));
  if (!same(ea, eb)) return 'entries differ';
  if (!same([...a.targets], [...b.targets])) return 'targets differ';
  if (!same(sorted(a.links), sorted(b.links))) return 'links differ';
  if (!same(sorted(a.footnotes), sorted(b.footnotes))) return 'footnotes differ';
  return undefined;
}

let cases = 0, region = 0, regionWithDefs = 0, failures = 0, indexFailures = 0;
const reasons = new Map<string, number>();
const found: { bytes: string; edited: string; why: string }[] = [];
const options = { file: '/t.md' };
const t0 = Date.now();
if (process.env.EXH === '1') {
  // Every single-byte-position edit of small documents: delete 1..3 chars, insert from a small set.
  const ins = ['\n', '\n\n', ' ', '[', ']', ':', '>', '\\', '    ', '- ', 'a'];
  const total = CASES; // documents
  for (let d = 0; d < total; d++) {
    let t = '';
    const n = 2 + int(6);
    for (let i = 0; i < n; i++) t += piece() + pick(['\n\n', '\n\n', '\n']);
    const before = enc.encode(t);
    const prev = parseMarkdown(before, options);
    const afters: Uint8Array[] = [];
    const bs = dec.decode(before);
    for (let p = 0; p <= bs.length; p++) {
      for (const k of [1, 2, 3]) if (p + k <= bs.length) afters.push(enc.encode(bs.slice(0, p) + bs.slice(p + k)));
      for (const x of ins) afters.push(enc.encode(bs.slice(0, p) + x + bs.slice(p)));
    }
    for (const after of afters) {
      const re = reparseMarkdown(prev, before, after, options);
      const stats = lastReparse();
      const wh = parseMarkdown(after, options);
      cases++;
      if (stats.kind === 'region') { region++; if (fm.definitionEntries(wh)?.length) regionWithDefs++; }
      let why: string | undefined;
      if (!same(re, wh)) why = `AST differs (${stats.kind})`;
      else if (stats.kind === 'region') { const dd = indexDiff(re, wh); if (dd) { why = 'INDEX ' + dd; indexFailures++; } }
      if (why) { failures++; if (found.length < 400) found.push({ bytes: JSON.stringify(bs), edited: JSON.stringify(dec.decode(after)), why }); }
    }
  }
  found.sort((a, b) => a.bytes.length + a.edited.length - (b.bytes.length + b.edited.length));
  console.log(JSON.stringify({ mode: 'exhaustive', docs: total, cases, region, regionWithDefs, failures, indexFailures, ms: Date.now() - t0 }));
  for (const f of found.slice(0, 5)) console.log(f.why, '\n  before:', f.bytes.slice(0, 600), '\n  after: ', f.edited.slice(0, 600));
  process.exit(0);
}
while (cases < CASES) {
  let before = variant(enc.encode(doc()));
  let prev = parseMarkdown(before, options);
  const chain = 1 + int(3);
  for (let c = 0; c < chain && cases < CASES; c++) {
    const after = rnd() < 0.15 ? variant(edit(before)) : edit(before);
    const re = reparseMarkdown(prev, before, after, options);
    const stats = lastReparse();
    const wh = parseMarkdown(after, options);
    cases++;
    if (stats.kind === 'region') { region++; if (fm.definitionEntries(wh)?.length) regionWithDefs++; }
    else reasons.set(stats.reason ?? '?', (reasons.get(stats.reason ?? '?') ?? 0) + 1);
    let why: string | undefined;
    if (!same(re, wh)) why = `AST differs (${stats.kind})`;
    else if (stats.kind === 'region') { const d = indexDiff(re, wh); if (d) { why = 'INDEX ' + d; indexFailures++; } }
    if (why) {
      failures++;
      if (found.length < 400) found.push({ bytes: JSON.stringify(dec.decode(before)), edited: JSON.stringify(dec.decode(after)), why });
    }
    before = after;
    prev = re;
  }
}
found.sort((a, b) => a.bytes.length + a.edited.length - (b.bytes.length + b.edited.length));
console.log(JSON.stringify({ cases, region, regionWithDefs, failures, indexFailures, ms: Date.now() - t0, reasons: Object.fromEntries(reasons) }));
for (const f of found.slice(0, 5)) console.log(f.why, '\n  before:', f.bytes.slice(0, 600), '\n  after: ', f.edited.slice(0, 600));
