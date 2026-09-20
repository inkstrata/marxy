// Asserts code blocks wrap with a hanging indent and never scroll horizontally (MARXY-27).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(join(root, 'packages/theme/src/base.css'), 'utf8');
const blocks = [...css.matchAll(/^pre\s*\{[^}]*\}/gms)].map((m) => m[0]);
const preBlock = blocks.find((b) => b.includes('white-space')) ?? blocks.at(-1) ?? '';

const need = [
  ['white-space: pre-wrap', 'long lines must soft-wrap'],
  ['text-indent:', 'hanging indent on wrapped continuation lines'],
  ['hanging', 'hanging indent keyword'],
];
const problems = need.filter(([token]) => !preBlock.includes(token)).map(([, msg]) => msg);
if (preBlock.includes('overflow-x: auto') || preBlock.includes('overflow-x:scroll')) {
  problems.push('pre must not scroll horizontally');
}

if (problems.length) {
  console.error(`code-block layout gate:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('code-block layout gate ok');
