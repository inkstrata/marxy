// Scratch: is every corpus file's definition index trusted, and which reasons send reparses whole.
import { readFileSync, readdirSync } from 'node:fs';
const root = 'C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(`file:///${root}parse.ts`);
const { definitionIndex } = await import(`file:///${root}from-mdast.ts`);
const { reparseMarkdown, lastReparse } = await import(`file:///${root}reparse.ts`);

const dir = 'C:/Dev/reader/worktrees/definitions-index/fixtures/corpus/';
for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const bytes = new Uint8Array(readFileSync(dir + name));
  const index = definitionIndex(parseMarkdown(bytes, { file: name }));
  if (index === 'unknown' || index.entries.length > 0) console.log(name, index === 'unknown' ? 'UNKNOWN' : `${index.entries.length} entries, ${index.links.length} link labels, ${index.footnotes.length} footnote labels`);
}

// One-line edits at every paragraph start of the long reference: how many take the region path, and why not.
const name = '32-long-reference.md';
const before = new Uint8Array(readFileSync(dir + name));
const previous = parseMarkdown(before, { file: name });
const text = new TextDecoder().decode(before);
const reasons = new Map<string, number>();
let region = 0;
let total = 0;
for (let at = text.indexOf('\n\n'); at !== -1 && total < 400; at = text.indexOf('\n\n', at + 2000)) {
  const cut = new TextEncoder().encode(text.slice(0, at + 2)).length;
  const insert = new TextEncoder().encode('A line an outside editor wrote.\n\n');
  const after = new Uint8Array(before.length + insert.length);
  after.set(before.subarray(0, cut));
  after.set(insert, cut);
  after.set(before.subarray(cut), cut + insert.length);
  const t0 = performance.now();
  reparseMarkdown(previous, before, after, { file: name });
  const ms = performance.now() - t0;
  total++;
  const s = lastReparse();
  if (s.kind === 'region') region++;
  else reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  if (total % 20 === 1) console.log(`at ${cut}: ${s.kind} parsed ${s.parsed} in ${ms.toFixed(1)} ms`);
}
console.log(`${name}: ${total} one-line edits, region ${region}`, Object.fromEntries(reasons));
