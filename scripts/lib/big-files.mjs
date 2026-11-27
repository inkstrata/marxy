// Big files of every shape a reader opens, at any size, deterministic and never shorter than asked: for growth
// probes, `measure-scale.mjs` and any test that must see how a feature behaves on a file of 1 to 5 MB
// (docs/big-files.md). Each shape stresses a different path: prose and transcripts the page, tables and fences the
// blocks, references and footnotes the whole-file parse, headings the Outline, one unbroken line the layout.
//
//   import { bigFile, KINDS } from './lib/big-files.mjs';
//   const { name, text } = await bigFile('md-transcript', 2_000_000);   // name: 'big-md-transcript-2000k.md'
//
//   node scripts/lib/big-files.mjs <out dir> <bytes> [kind,kind]   writes the files (keep them out of the repository)
//
// The lines threshold matters: from 5 MiB (5,242,880 bytes, `LINES_FROM` in packages/core/src/reading/lines.ts) Markdown,
// text, code and logs are read as lines, so 5.2m (5,200,000 bytes) is about the biggest whole page and 5.3m the smallest
// lines reading.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateProse, generateTranscript, generateLarge } from '../perf-harness.mjs';

const CORPUS = new URL('../../fixtures/corpus/', import.meta.url);
const seed = (f) => readFileSync(new URL(f, CORPUS), 'utf8');
const utf8 = (u8) => Buffer.from(u8).toString('utf8');

/** Repeat `unit(i)` until `bytes` is reached; `head` and `tail` wrap the whole. */
function fill(bytes, unit, head = '', tail = '') {
  const parts = [head];
  let n = Buffer.byteLength(head) + Buffer.byteLength(tail);
  for (let i = 0; n < bytes; i++) {
    const u = unit(i);
    parts.push(u);
    n += Buffer.byteLength(u);
  }
  parts.push(tail);
  return parts.join('');
}

const WORDS = 'the reader keeps every byte as written and draws only what the page asks for while the rest waits'.split(' ');
const words = (i, n) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');

export const KINDS = {
  // Markdown, full page below 5 MB
  'md-prose': { ext: 'md', make: (b) => utf8(generateProse(b)) },
  'md-transcript': { ext: 'md', make: (b) => utf8(generateTranscript(b)) },
  'md-technical': { ext: 'md', make: (b) => utf8(generateLarge(b)) },
  'md-dense': {
    ext: 'md',
    make: async (b) => {
      const { generateDense } = await import('../perf-harness.mjs');
      return utf8(await generateDense(b));
    },
  },
  // Footnotes and reference links: a file that may hold a definition is parsed whole, never in slices.
  'md-references': {
    ext: 'md',
    make: (b) => {
      const body = fill(b * 0.85, (i) => `Paragraph ${i} cites [a source][ref-${i}] and a note.[^n${i}] ${words(i, 30)}.\n\n`);
      const defs = fill(b * 0.15, (i) => `[ref-${i}]: https://example.org/${i}\n[^n${i}]: Note ${i}, ${words(i, 8)}.\n`);
      return `# References\n\n${body}\n${defs}`;
    },
  },
  'md-headings': { ext: 'md', make: (b) => fill(b, (i) => `${'#'.repeat(1 + (i % 4))} Heading ${i}\n\n${words(i, 12)}.\n\n`) },
  'md-tables': {
    ext: 'md',
    make: (b) => fill(b, (i) => `| id | name | value | note |\n| --- | --- | --- | --- |\n${Array.from({ length: 20 }, (_, r) => `| ${i * 20 + r} | ${WORDS[r % WORDS.length]} | ${r * 3.5} | ${words(r, 4)} |`).join('\n')}\n\n`),
  },
  'md-code-fences': { ext: 'md', make: (b) => fill(b, (i) => `Step ${i}.\n\n\`\`\`ts\n${seed('04-source.ts').slice(0, 1200)}\n\`\`\`\n\n`) },
  // Text and code
  txt: { ext: 'txt', make: (b) => fill(b, (i) => `${words(i, 13)}\n`) },
  'code-ts': { ext: 'ts', make: (b) => fill(b, (i) => `// part ${i}\n${seed('04-source.ts')}\n`) },
  // Data
  'json-pretty': {
    ext: 'json',
    make: (b) => {
      const rec = (i) => JSON.stringify({ id: i, name: words(i, 3), tags: [WORDS[i % 9], WORDS[(i + 3) % 9]], nested: { a: i, b: { c: words(i, 2) } } }, null, 2);
      return fill(b, (i) => `${i ? ',\n' : ''}${rec(i)}`, '[\n', '\n]\n');
    },
  },
  'json-minified': {
    ext: 'json',
    make: (b) => fill(b, (i) => `${i ? ',' : ''}${JSON.stringify({ id: i, name: words(i, 3), v: [i, i * 2, i * 3] })}`, '[', ']'),
  },
  'json-deep': { ext: 'json', make: (b) => { const n = Math.floor(b / 12); return `${'{"a":['.repeat(n)}1${']}'.repeat(n)}`; } },
  csv: { ext: 'csv', make: (b) => fill(b, (i) => `${i},${WORDS[i % 19]},${i * 1.5},"${words(i, 5)}",${i % 2 ? 'yes' : 'no'},2026-11-${String(1 + (i % 27)).padStart(2, '0')}\n`, 'id,word,value,phrase,flag,date\n') },
  'csv-quoted-newlines': { ext: 'csv', make: (b) => fill(b, (i) => `${i},"line one\nline two of ${i}",${i * 2}\n`, 'id,text,n\n') },
  jsonl: { ext: 'jsonl', make: (b) => fill(b, (i) => `${JSON.stringify({ t: 1764200000 + i, level: ['info', 'warn', 'error'][i % 3], msg: words(i, 9) })}\n`) },
  log: { ext: 'log', make: (b) => fill(b, (i) => `2026-11-27T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${String(i % 1000).padStart(3, '0')}Z ${['INFO', 'WARN', 'ERROR', 'DEBUG'][i % 4]} worker-${i % 8} ${words(i, 10)}\n`) },
  diff: { ext: 'diff', make: (b) => fill(b, (i) => `diff --git a/f${i}.ts b/f${i}.ts\n--- a/f${i}.ts\n+++ b/f${i}.ts\n@@ -1,3 +1,3 @@\n ${words(i, 6)}\n-${words(i + 1, 6)}\n+${words(i + 2, 6)}\n ${words(i + 3, 6)}\n`) },
  html: { ext: 'html', make: (b) => fill(b, (i) => `<h2>Part ${i}</h2>\n<p>${words(i, 40)}</p>\n<ul><li>${words(i, 4)}</li><li>${words(i + 1, 4)}</li></ul>\n`, '<!doctype html><html><head><title>Big</title></head><body>\n', '</body></html>\n') },
  yaml: { ext: 'yaml', make: (b) => fill(b, (i) => `- id: ${i}\n  name: ${words(i, 3)}\n  tags: [${WORDS[i % 9]}, ${WORDS[(i + 2) % 9]}]\n`) },
  // One unbroken line (minified bundles and data are often one line)
  'one-line-md': { ext: 'md', make: (b) => fill(b, (i) => `${WORDS[i % WORDS.length]} `) },
};

export async function bigFile(kind, bytes) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown kind ${kind}: ${Object.keys(KINDS).join(', ')}`);
  const text = await k.make(bytes);
  return { name: `big-${kind}-${Math.round(bytes / 1000)}k.${k.ext}`, text, bytes: Buffer.byteLength(text) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, size, only] = process.argv.slice(2);
  if (!out || !size) {
    console.error('usage: node gen.mjs <out dir> <bytes> [kind,kind]');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  for (const kind of only ? only.split(',') : Object.keys(KINDS)) {
    const f = await bigFile(kind, Number(size));
    writeFileSync(join(out, f.name), f.text);
    console.log(`${f.name}\t${f.bytes}`);
  }
}
