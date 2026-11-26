// Walks local imports of each Node-only desktop unit file and reports any that reach a browser starter.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { desktopUnitFiles } = await import(pathToFileURL(join(root, 'scripts/verify.mjs')).href);
const base = join(root, 'apps/desktop');
const { plain } = desktopUnitFiles(root);
const starts = /['"](?:playwright|playwright-core|@playwright\/test|vite)['"]|playwright-webkit\.mjs|support\/(?:two-pane|shared-vite|shared-browser|frame|split-same)\.mjs/;
const bare = /^(playwright|playwright-core|@playwright\/test|vite|webkit|puppeteer)/;
const spec = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|spawn\w*\(|exec\w*\(/g;
let hits = 0;
for (const f of plain) {
  const seen = new Set();
  const stack = [[join(base, f), [f]]];
  while (stack.length) {
    const [p, chain] = stack.pop();
    if (seen.has(p) || !existsSync(p)) continue;
    seen.add(p);
    const src = readFileSync(p, 'utf8');
    if (p !== join(base, f) && starts.test(src)) { console.log('DIRECT-PATTERN', chain.join(' -> ')); hits++; }
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const s = m[1];
      if (bare.test(s)) { console.log('BARE', s, chain.join(' -> ')); hits++; continue; }
      if (!s.startsWith('.')) continue;
      const t = resolve(dirname(p), s);
      stack.push([t, [...chain, relative(base, t)]]);
    }
  }
}
console.log('plain files', plain.length, 'hits', hits);
