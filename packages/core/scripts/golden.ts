// Golden-file gate: parse every markdown fixture in the corpus, serialise the AST with its byte
// provenance, and diff it against the committed file in ../goldens. Run with `--update` to rewrite
// them; a diff in CI means the parser changed what a reader sees, which belongs in a review.
// The goldens are parser-independent by design (ADR-0021): swapping the parser must not move them.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkInvariants } from '../src/parse/invariants.ts';
import { parseMarkdown } from '../src/parse/parse.ts';
import type { Node } from '../src/contracts/ast.ts';

const corpus = new URL('../../../fixtures/corpus/', import.meta.url);
const goldens = new URL('../goldens/', import.meta.url);
const update = process.argv.includes('--update');

/** One line per node: indented type, byte range, and the fields a reader would notice. */
function serialise(node: Node, depth = 0): string[] {
  const lines = [`${'  '.repeat(depth)}${node.type} [${node.src.start},${node.src.end})${details(node)}`];
  for (const child of node.children ?? []) lines.push(...serialise(child, depth + 1));
  return lines;
}

function details(node: Node): string {
  const fields: string[] = [];
  switch (node.type) {
    case 'heading': fields.push(`level=${node.level}`); break;
    case 'list': fields.push(`ordered=${node.ordered}`, `tight=${node.tight}`); if (node.start !== undefined) fields.push(`start=${node.start}`); break;
    case 'listItem': if (node.task) fields.push(`task=${node.task}`); break;
    case 'codeBlock':
      if (node.lang) fields.push(`lang=${node.lang}`);
      if (node.info) fields.push(`info=${quote(node.info)}`);
      fields.push(`content=[${node.content.start},${node.content.end})`, `value=${quote(node.value)}`);
      break;
    case 'table': fields.push(`align=${node.align.map((a) => a ?? '-').join(',')}`); break;
    case 'tableRow': fields.push(`header=${node.header}`); break;
    case 'link': fields.push(`url=${quote(node.url)}`); if (node.title !== undefined) fields.push(`title=${quote(node.title)}`); break;
    case 'image': fields.push(`url=${quote(node.url)}`, `alt=${quote(node.alt)}`); if (node.title !== undefined) fields.push(`title=${quote(node.title)}`); break;
    case 'footnoteDefinition': case 'footnoteReference': fields.push(`label=${quote(node.label)}`); break;
    case 'taskMarker': fields.push(`checked=${node.checked}`); break;
    case 'text': case 'code': case 'html': case 'htmlBlock': case 'mathBlock': case 'mathInline': case 'frontmatter':
      fields.push(`value=${quote(node.value)}`);
      break;
    default: break;
  }
  return fields.length > 0 ? ` ${fields.join(' ')}` : '';
}

const quote = (value: string): string => JSON.stringify(value.length > 120 ? `${value.slice(0, 120)}…` : value);

const fixtures = readdirSync(corpus).filter((name) => name.endsWith('.md')).sort();
if (fixtures.length < 12) {
  console.error(`golden: only ${fixtures.length} markdown fixtures in the corpus`);
  process.exit(1);
}

let failed = 0;
mkdirSync(fileURLToPath(goldens), { recursive: true });
for (const name of fixtures) {
  const bytes = new Uint8Array(readFileSync(new URL(name, corpus)));
  const document = parseMarkdown(bytes, { file: name });
  const violations = checkInvariants(document, bytes);
  if (violations.length > 0) {
    failed++;
    console.error(`golden: ${name} violates the AST invariants:`);
    for (const violation of violations.slice(0, 5)) console.error(`  - ${violation.invariant}: ${violation.detail}`);
    continue;
  }
  const expected = `${serialise(document).join('\n')}\n`;
  const file = new URL(`${name.replace(/\.md$/, '')}.ast.txt`, goldens);
  if (update) {
    writeFileSync(file, expected);
    continue;
  }
  let actual: string;
  try {
    actual = readFileSync(file, 'utf8');
  } catch {
    failed++;
    console.error(`golden: no golden file for ${name}; run pnpm --filter @marxy/core test:golden -- --update`);
    continue;
  }
  if (actual !== expected) {
    failed++;
    console.error(`golden: ${name} differs from its golden file:`);
    for (const line of firstDifference(actual, expected)) console.error(`  ${line}`);
  }
}

function firstDifference(actual: string, expected: string): string[] {
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return [`line ${i + 1}`, `- golden: ${a[i] ?? '<end of file>'}`, `+ parsed: ${b[i] ?? '<end of file>'}`];
  }
  return [];
}

if (failed > 0) {
  console.error(`golden gate failed: ${failed} of ${fixtures.length} fixtures`);
  process.exit(1);
}
console.log(`golden: ${fixtures.length} corpus fixtures ${update ? 'written' : 'match their golden AST files'}, invariants hold`);
