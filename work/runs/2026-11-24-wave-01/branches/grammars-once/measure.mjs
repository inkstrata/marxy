// node measure.mjs <dist dir>: js chunk count and bytes under assets, grammar names emitted twice, katex fonts.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
const assets = join(dist, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const bytes = js.reduce((n, f) => n + statSync(join(assets, f)).size, 0);
const names = new Map();
for (const f of js) {
  const m = /^(.+)-[\w-]{8}\.js$/.exec(f);
  if (m) names.set(m[1], (names.get(m[1]) ?? 0) + 1);
}
const dup = [...names].filter(([, n]) => n > 1);
console.log(`dist/assets js: ${js.length} files, ${bytes} bytes`);
console.log(`names appearing more than once: ${dup.length}`, dup.slice(0, 5).map(([k]) => k).join(','));
const fonts = {};
for (const f of files.filter((f) => /KaTeX/.test(f))) {
  const ext = f.split('.').pop();
  const e = (fonts[ext] ??= { n: 0, bytes: 0 });
  e.n++;
  e.bytes += statSync(join(assets, f)).size;
}
console.log('katex fonts', JSON.stringify(fonts));
