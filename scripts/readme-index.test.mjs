// Each level's README lists that level's tools. A script in no list is one nobody will find; a list naming a file
// that is gone sends a reader nowhere. Both fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** A README and the tool folders it answers for. */
const LEVELS = [
  { readme: 'scripts/README.md', tools: 'scripts', deep: ['lib', 'allowlists'] },
  { readme: 'scripts/auto/README.md', tools: 'scripts/auto', deep: ['lib', 'eris', 'set'] },
  { readme: 'apps/desktop/README.md', tools: 'apps/desktop/scripts', deep: ['shots'] },
  { readme: 'packages/core/README.md', tools: 'packages/core/scripts', deep: [] },
  { readme: 'packages/theme/README.md', tools: 'packages/theme/scripts', deep: [] },
  { readme: 'packages/typeset/README.md', tools: 'packages/typeset/scripts', deep: [] },
];
const READMES = [...LEVELS.map(l => l.readme), 'packages/shell-api/README.md'];

/** Tests, type declarations for a script, and the README itself are not tools. */
const isTool = name => !/\.test\.[a-z]+$/.test(name) && !name.endsWith('.d.mts') && name !== 'README.md';

/** Every word inside backticks: a path, a command's parts, a file name. */
function named(text) {
  const out = new Set();
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) for (const word of span.split(/[\s,]+/)) if (word) out.add(word.replace(/[.:;)]+$/, ''));
  return out;
}

function toolsOf(level) {
  const files = [];
  const dir = join(ROOT, level.tools);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && isTool(e.name)) files.push(e.name);
    else if (e.isDirectory() && level.deep.includes(e.name)) for (const f of readdirSync(join(dir, e.name))) if (isTool(f)) files.push(`${e.name}/${f}`);
  }
  return files.sort();
}

for (const level of LEVELS) {
  test(`${level.readme} lists every tool in ${level.tools}`, () => {
    const words = named(readFileSync(join(ROOT, level.readme), 'utf8'));
    const listed = f => words.has(f) || [...words].some(w => w.endsWith(`/${f}`));
    const missing = toolsOf(level).filter(f => !listed(f));
    assert.deepEqual(missing, [], `add to ${level.readme}: ${missing.join(', ')}`);
  });
}

test('every script and folder a README names is there', () => {
  const gone = [];
  for (const readme of READMES) {
    const here = dirname(join(ROOT, readme));
    const level = LEVELS.find(l => l.readme === readme);
    const bases = [here, ROOT, ...(level ? [join(ROOT, level.tools)] : [])];
    for (const word of named(readFileSync(join(ROOT, readme), 'utf8'))) {
      if (/[<>*{}$=]/.test(word) || word.startsWith('-')) continue;
      const isScript = /\.(mjs|ts|ps1|css)$/.test(word);
      const isFolder = /^[\w.@-]+(\/[\w.@-]+)*\/$/.test(word);
      if (!isScript && !isFolder) continue;
      const found = bases.some(b => {
        const p = join(b, word);
        return existsSync(p) && statSync(p).isDirectory() === isFolder;
      });
      if (!found) gone.push(`${readme}: ${word}`);
    }
  }
  assert.deepEqual(gone, []);
});

test('the docs index and the root README link every document and every level README', () => {
  const docs = readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md') && f !== 'README.md');
  const index = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
  const root = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const d of docs) {
    assert.ok(index.includes(`(${d})`), `docs/README.md links ${d}`);
    assert.ok(root.includes(`(docs/${d})`), `README.md links docs/${d}`);
  }
  for (const r of READMES) assert.ok(index.includes(`(../${r})`), `docs/README.md links ${r}`);
});
