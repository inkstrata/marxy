// Ensures no copyleft Shiki grammars are imported and the desktop bundle does not embed them (MARXY-27).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const forbidden = JSON.parse(readFileSync(join(root, 'scripts/allowlists/shiki-languages.json'), 'utf8')).forbiddenGrammars;
const highlightDir = join(root, 'packages/core/src/highlight');
const sources = readdirSync(highlightDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(highlightDir, f), 'utf8')).join('\n');

for (const id of forbidden) {
  if (sources.includes(`'@shikijs/langs/${id}'`) || sources.includes(`"@shikijs/langs/${id}"`)) {
    console.error(`highlight bundle gate: forbidden grammar import ${id} in packages/core/src/highlight`);
    process.exit(1);
  }
}

const dist = join(root, 'apps/desktop/dist');
if (existsSync(dist)) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const chunks = walk(dist).filter((f) => f.endsWith('.js'));
  const bundle = chunks.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const id of forbidden) {
    const needles = [`@shikijs/langs/${id}`, `langs/${id}.mjs`, `langs/${id}.js`];
    if (needles.some((needle) => bundle.includes(needle))) {
      console.error(`highlight bundle gate: dist embeds forbidden grammar "${id}"`);
      process.exit(1);
    }
  }
  console.log(`highlight bundle gate: dist scanned (${chunks.length} chunks), forbidden grammars absent`);
} else {
  console.log('highlight bundle gate: no apps/desktop/dist; source import check only');
}

console.log('highlight bundle gate ok');
