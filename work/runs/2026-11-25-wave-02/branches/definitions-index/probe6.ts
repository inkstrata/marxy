// Scratch: reasons the structured documents with definitions go whole.
const root = 'C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(`file:///${root}parse.ts`);
const { reparseMarkdown, lastReparse } = await import(`file:///${root}reparse.ts`);
const { definitionIndex } = await import(`file:///${root}from-mdast.ts`);
const sig = (d: unknown) => { const i = definitionIndex(d); return i === 'unknown' ? 'unknown' : JSON.stringify(i.entries.map((e: any) => [e.kind, e.identifier, e.url, e.title])); };
let needless = 0;
const encode = (t: string) => new TextEncoder().encode(t);
function random(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/**
 * The structured generator (from the review of #467): documents built from block constructs that reach
 * across lines and blank lines (lists with wide content indents and empty items, nested quotes and
 * lists, HTML blocks of types 1 to 7 and custom elements, fences, math, tables, setext headings), with
 * zero to two blank lines between, and edits that mix fragments written at a line start with whole blocks.
 */
const BLOCKS: readonly string[] = [
  'para one\n', 'para two\nlazy line\n', '# H\n', 'Setext\n===\n', 'Setext2\n---\n', '---\n', '***\n',
  '```\ncode\n```\n', '~~~js\na\n\nb\n~~~\n', '    indented\n    code\n', '- a\n- b\n', '- a\n\n- b\n', '1. one\n2. two\n',
  '* x\n  cont\n', '> quote\nlazy\n', '> q\n>\n> q2\n', '| a | b |\n|---|---|\n| 1 | 2 |\n', '<div>\nhtml\n</div>\n',
  '<!--\ncomment\n\nstill\n-->\n', '<pre>\nx\n\ny\n</pre>\n', '<script>\na\n\nb\n</script>\n', '<?php\n\n?>\n', '<!X\n\n>\n',
  '<![CDATA[\n\n]]>\n', '<custom-el>\n', '$$\nx^2\n\ny\n$$\n', '- [ ] task\n- [x] done\n', 'text with $m$ and `c`\n',
  '- a\n  - b\n\n    c\n', '1) x\n\n   y\n', 'Term\n: def?\n', '\\\n', 'a  \nb\n', '<del>x</del>\n', 'www.example.com\n',
  '+ p\n+ q\n', '> - a\n> - b\n', '- > a\n  > b\n', '| x |\n|:-:|\n', 'a | b\n-|-\n',
  '1.   wide\n\n    under\n', '-\n\n    after empty\n', '2.\n', ' -    b\n',
];
const PIECES: readonly string[] = [
  '\n', '\n\n', '\r\n', '\r', ' ', '   ', '    ', '\t', 'x', '```', '```\n', '~~~\n', '- ', '* ', '+ ', '1. ', '> ', '>', '===', '---',
  '--\n', '# ', '|', '|---|\n', '<div>', '</div>', '<!--', '-->', '<pre>', '</pre>', '<script>', '</script>', '<?', '?>', '<!X', '>',
  '<![CDATA[', ']]>', '$$', '$$\n', '$', '`', '[', ']', '(', ')', '\\', 'lazy\n', '  - n\n', '\n    code\n', '\n\n- item\n', '\n> q\n',
  '<a>\n', '</a>\n', '<x-y>\n', '[^1]', 'if xs[0]:', ' ', 'é', '日', '﻿',
];

function generated(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 6 + Math.floor(next() * 30); count > 0; count--) text += BLOCKS[Math.floor(next() * BLOCKS.length)]! + blank();
  if (next() < 0.1) text = `---\na: 1\n---\n${text}`;
  if (next() < 0.05) text = `﻿${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}

function structuredEdit(text: string, next: () => number, blocks = BLOCKS, pieces = PIECES): string {
  let out = text;
  for (let count = 1 + Math.floor(next() * 2); count > 0; count--) {
    let at = Math.floor(next() * (out.length + 1));
    const kind = next();
    if (kind < 0.4) while (at > 0 && out[at - 1] !== '\n') at--;
    if (kind > 0.8 && kind < 0.9) {
      out = out.slice(0, at) + out.slice(at + Math.floor(next() * 20));
      continue;
    }
    const piece = next() < 0.3 ? blocks[Math.floor(next() * blocks.length)]! : pieces[Math.floor(next() * pieces.length)]!;
    out = out.slice(0, at) + piece + out.slice(at + (kind > 0.9 ? Math.floor(next() * 6) : 0));
  }
  return out;
}

/** The two parses as the same JSON, and the same line start at every byte. */


/** Forty short paragraphs, so a small case is a small part of its file and takes the region path. */
const PAD = Array.from({ length: 40 }, (_, n) => `p${n}\n`).join('\n');

/** Each case alone, after a long tail, and between two, all taking the region path. */




/** The reparse of `before` to `after` checked against the whole parse; the path it took. */



/** Link reference and footnote definitions in every place one can sit, and the references that use them. */
const DEFINITION_BLOCKS: readonly string[] = [
  '[foo]: http://f.example\n', '[Foo]: http://second.example "a duplicate, which loses"\n', "[ bar\tbaz ]: </b b> 't'\n",
  '[img]:\n  /i.png\n', '> [quoted]: /q\n', '- [listed]: /l\n', '- item\n\n  [inner]: /in\n', '1. [ordered]: /o "t"\n',
  '[^n]: a note\n', '[^N]: the same note in capitals, which loses\n', '[^m]: a note\n\n    with a second paragraph\n',
  '> [^q]: a quoted note\n', '- [^l]: a note in a list\n', '[^n]: a note again\n',
  'See [foo], [Foo][], [x][bar baz], ![i][img] and [quoted].\n', 'Notes[^n] and[^m] and [^q] and [^l] and [^missing].\n',
  '[listed] [inner] [ordered] [nope] [BAR   BAZ] ![img]\n', '# Heading [foo] with[^N]\n', '| [foo] | [^n] |\n|---|---|\n| ![img] | [x][foo] |\n',
  '> a quote with [foo] and[^q]\n', '- a list with [quoted][]\n', '[foo]\n===\n', 'text directly above\n[foo]: /never-a-definition\n',
  // Labels that fold or escape: `ß` folds to `SS`, an escaped bracket, a label over two lines, one inside a footnote.
  '[ß]: /sz\n', '[\\]]: /escaped\n', '[a\nb]: /two-lines\n', 'See [SS], [\\]], [a b] and[^ß].\n', '[^ß]: a folded note\n',
  '[^d]: [inside]: /in-a-note\n\n    see [inside]\n', '[foo]: /a\n===\n',
];
const DEFINITION_PIECES: readonly string[] = [
  ...PIECES, '[foo]', '[Foo][]', '[x][img]', '![a][foo]', '[^n]', '[^m]', '[^q]', ']:', ':', '^', 'foo', 'bar', '[foo]: /new\n',
  '[^n]: ', '\n[^z]: z\n', '[ref]: /r\n', '  ', '>',
];

/** `generated`, with definitions and references among the blocks and one definition at the top or the bottom. */
function generatedWithDefinitions(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 6 + Math.floor(next() * 30); count > 0; count--) {
    const pool = next() < 0.4 ? DEFINITION_BLOCKS : BLOCKS;
    text += pool[Math.floor(next() * pool.length)]! + blank();
  }
  if (next() < 0.5) text = `[foo]: http://top.example\n\n${text}`;
  else text = `${text}\n\n[^n]: a note at the bottom\n\n[bar baz]: /bottom\n`;
  if (next() < 0.1) text = `---\na: 1\n---\n${text}`;
  if (next() < 0.05) text = `﻿${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}


const reasons = new Map<string, number>();
let region = 0;
for (let seed = 1; seed <= 300; seed++) {
  const next = random(seed * 31 + 7);
  let text = generatedWithDefinitions(next);
  for (let n = 0; n < 25; n++) {
    const after = structuredEdit(text, next, DEFINITION_BLOCKS, DEFINITION_PIECES);
    const b = encode(text), a = encode(after);
    const pb = parseMarkdown(b, { file: '/s.md' });
    const pa = reparseMarkdown(pb, b, a, { file: '/s.md' });
    const s = lastReparse();
    if (s.reason?.startsWith('the change adds') && sig(pb) === sig(pa)) needless++;
    if (s.kind === 'region') region++; else reasons.set(s.reason!, (reasons.get(s.reason!) ?? 0) + 1);
    text = after;
  }
}
console.log('needless definition fallbacks', needless, 'region', region, Object.fromEntries(reasons));
