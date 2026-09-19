// Bundle size budget (ADR-0013). Also fails if importing the parser resolves katex (MARXY-60).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * A fresh process so the resolve hook sees the real import graph, not this gate's own modules.
 * Vacuous if the hook observes nothing — that would be a broken check, not a pass.
 */
function assertParserDoesNotResolveKatex() {
  const parser = new URL('../packages/core/src/index.ts', import.meta.url).href;
  const probe = `
import { registerHooks } from 'node:module';
const resolved = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    resolved.push({ specifier, url: result.url });
    return result;
  },
});
await import(${JSON.stringify(parser)});
if (resolved.length === 0) {
  console.error('bundle gate: resolve hook observed nothing; the katex check is broken');
  process.exit(1);
}
const hits = resolved.filter((entry) => (
  entry.specifier === 'katex' || /(?:^|\\/)katex(?:\\/|$)/.test(entry.url)
));
if (hits.length > 0) {
  console.error('bundle gate: importing the parser resolved katex');
  for (const hit of hits) console.error('  ' + hit.specifier + ' -> ' + hit.url);
  process.exit(1);
}
console.log('bundle gate: parser import graph does not resolve katex (' + resolved.length + ' modules)');
`;
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', probe],
    { encoding: 'utf8', cwd: root },
  );
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) process.exit(child.status === null ? 1 : child.status);
}

assertParserDoesNotResolveKatex();

/**
 * The memory shell and the app harness must not ship in the production entry. A walk of main.ts's
 * relative imports fails when memory.ts is imported from it; the built index JS is grepped when
 * dist exists so a bundler rewrite cannot hide the marker.
 */
function assertProductionExcludesMemoryShell() {
  const desktop = join(root, 'apps', 'desktop');
  const main = join(desktop, 'src', 'main.ts');
  if (!existsSync(main)) {
    console.error('bundle gate: apps/desktop/src/main.ts is missing');
    process.exit(1);
  }
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const seen = new Set();
  const queue = [main];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = strip(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1].endsWith('.ts') || m[1].endsWith('.mjs') || m[1].endsWith('.js') ? m[1] : `${m[1]}.ts`;
      queue.push(join(file, '..', spec));
    }
  }
  const rel = (f) => f.slice(desktop.length + 1);
  const memory = [...seen].filter((f) => /src\/shell\/memory\.ts$/.test(f) || /src\/harness\//.test(f));
  if (memory.length > 0) {
    console.error('bundle gate: production entry reaches the memory shell or harness:');
    for (const f of memory) console.error('  ' + rel(f));
    process.exit(1);
  }
  const distHtml = join(desktop, 'dist', 'index.html');
  if (existsSync(distHtml)) {
    const html = readFileSync(distHtml, 'utf8');
    const queue = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ''));
    if (queue.length === 0) {
      console.error('bundle gate: dist/index.html has no script; the production check is broken');
      process.exit(1);
    }
    const walked = new Set();
    const chunks = [];
    while (queue.length) {
      const src = queue.pop();
      if (walked.has(src)) continue;
      walked.add(src);
      const file = join(desktop, 'dist', src);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      chunks.push(text);
      for (const m of text.matchAll(/from\s*["'](\.?\.?\/[^"']+)["']/g)) {
        queue.push(new URL(m[1], `file:///${src}`).pathname.replace(/^\//, ''));
      }
    }
    const bundle = chunks.join('\n');
    if (bundle.includes('createMemoryShell') || bundle.includes('marxyApp')) {
      console.error('bundle gate: production index JS contains createMemoryShell or the harness entry');
      process.exit(1);
    }
    console.log('bundle gate: production index JS excludes createMemoryShell and the harness');
  } else {
    console.log('bundle gate: no vite dist; production JS string check skipped (import graph is clean)');
  }
  console.log(`bundle gate: main.ts import graph excludes memory.ts (${seen.size} modules)`);
}

assertProductionExcludesMemoryShell();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8')).bundle_installed_mb;
const dir = new URL('../apps/desktop/src-tauri/target/release/bundle/', import.meta.url).pathname;
if (!existsSync(dir)) {
  console.log('bundle gate: no bundle built; skipping size and katex-in-bundle checks');
  process.exit(0);
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
));
const files = walk(dir).filter((f) => /\.(dmg|AppImage|deb)$/.test(f));
let fail = false;
for (const f of files) {
  const mb = statSync(f).size / 1048576;
  const limit = f.endsWith('.dmg') ? budgets.macos : budgets.linux;
  console.log(`${f.split('/').pop()}: ${mb.toFixed(1)} MB (limit ${limit})`);
  if (mb > limit) fail = true;
}
if (files.length === 0) {
  console.log('bundle gate: no installer artefacts; skipping katex-in-bundle check');
} else {
  const needle = Buffer.from('katex');
  for (const f of files) {
    if (readFileSync(f).includes(needle)) {
      console.error(`bundle gate: ${f.split('/').pop()} contains katex`);
      fail = true;
    } else {
      console.log(`${f.split('/').pop()}: katex absent`);
    }
  }
}
if (fail) {
  console.error('bundle gate failed');
  process.exit(1);
}
console.log('bundle gate ok');
