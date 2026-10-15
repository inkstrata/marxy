// What each chunk of the desktop build holds, module by module (F-111). A report, never a gate: it builds
// the shipped entry in memory (nothing is written), reads rollup's own module list for every
// chunk and prints the entry chunks first, grouped by package or source folder with each group's rendered
// size before minification. Rendered sizes are rollup's `renderedLength` (after tree-shaking, before the
// minifier), so they rank the contents; the chunk's own minified size is printed beside them.
//   node scripts/bundle-report.mjs [--top N] [--json FILE]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps/desktop');

/** The group a module belongs to: its npm package, or its folder under a workspace's src/. */
export function groupOf(id) {
  const path = id.replace(/\0/g, '').split('?')[0];
  const nm = path.lastIndexOf('node_modules/');
  if (nm >= 0) {
    const rest = path.slice(nm + 'node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const rel = relative(root, path);
  if (rel.startsWith('..')) return path;
  const parts = rel.split('/');
  if (parts[0] === 'apps' || parts[0] === 'packages') {
    const src = parts.indexOf('src');
    const folder = src >= 0 && parts.length > src + 2 ? parts[src + 1] : parts.slice(2).join('/') ? '(top level)' : '';
    return `${parts[0]}/${parts[1]}/src/${folder}`.replace(/\/$/, '');
  }
  return rel;
}

/** Folds a chunk's modules into groups, largest first. */
export function summarise(chunk) {
  const groups = new Map();
  for (const [id, m] of Object.entries(chunk.modules)) {
    const g = groupOf(id);
    const row = groups.get(g) ?? { group: g, bytes: 0, modules: 0 };
    row.bytes += m.renderedLength;
    row.modules += 1;
    groups.set(g, row);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

async function build() {
  const require = createRequire(join(desktop, 'package.json'));
  const vite = await import(pathToFileURL(require.resolve('vite')).href);
  const chunks = [];
  const capture = {
    name: 'marxy-bundle-report',
    generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== 'chunk') continue;
        chunks.push({ file: f.fileName, entry: f.isEntry, dynamic: f.isDynamicEntry, bytes: Buffer.byteLength(f.code), modules: f.modules });
      }
    },
  };
  // outDir is the shipped dist/ so vite.config.ts drops the harness entry (shipIndexOnly) and the chunks are
  // the shipped ones; write: false means nothing is written there.
  await vite.build({ root: desktop, logLevel: 'silent', plugins: [capture], build: { outDir: join(desktop, 'dist'), write: false, emptyOutDir: false, reportCompressedSize: false } });
  return chunks;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const top = Number(args[args.indexOf('--top') + 1]) || 15;
  const jsonAt = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;
  const chunks = await build();
  const entries = chunks.filter((c) => c.entry).sort((a, b) => b.bytes - a.bytes);
  const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
  for (const c of entries) {
    console.log(`\n${c.file}  ${kb(c.bytes)} minified, ${Object.keys(c.modules).length} modules`);
    for (const r of summarise(c).slice(0, top)) console.log(`  ${kb(r.bytes).padStart(10)}  ${String(r.modules).padStart(4)}  ${r.group}`);
  }
  const rest = chunks.filter((c) => !c.entry).sort((a, b) => b.bytes - a.bytes).slice(0, top);
  console.log(`\nlargest other chunks (${chunks.length - entries.length} in all)`);
  for (const c of rest) console.log(`  ${kb(c.bytes).padStart(10)}  ${c.file}`);
  if (jsonAt) writeFileSync(jsonAt, JSON.stringify(chunks.map((c) => ({ ...c, modules: undefined, groups: summarise(c) })), null, 1));
}
