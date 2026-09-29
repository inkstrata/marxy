// Bundle size budget (ADR-0013). Also fails if importing the parser resolves katex (MARXY-60).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importSpecs, stripCommentsAst } from './lib/imports.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

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

/** Relative import specifiers reachable from a production source file, read from the AST. */
export function relativeImportSpecs(text) {
  return importSpecs(text).filter((s) => s.startsWith('.'));
}

/** Where a relative specifier lands on disk: .js names a .ts source, and a bare path may be a .ts, .tsx or /index.ts. */
export function resolveRelativeModule(fromFile, spec) {
  const base = join(fromFile, '..', spec);
  const candidates = /\.[mc]?js$/.test(base)
    ? [base.replace(/\.([mc]?)js$/, '.$1ts'), base.replace(/\.js$/, '.tsx'), base]
    : [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? (/\.[mc]?[jt]sx?$/.test(base) ? base : `${base}.ts`);
}

/** Relative chunk specifiers in built JS: `from"./x"`, `import("./x")` and side-effect `import"./x"`. */
export function distChunkSpecs(text) {
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{0,2}\/[^"']+)["']/g)].map((m) => m[1]);
}

/** Walk main.ts's relative import graph; returns absolute paths of memory shell / harness hits. */
export function memoryShellReachableFromMain(desktop) {
  const main = join(desktop, 'src', 'main.ts');
  if (!existsSync(main)) return { error: 'missing-main', memory: [] };
  const seen = new Set();
  const queue = [main];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = stripCommentsAst(readFileSync(file, 'utf8'), file);
    for (const spec of relativeImportSpecs(text)) queue.push(resolveRelativeModule(file, spec));
  }
  const memory = [...seen].filter((f) => /src\/shell\/memory\.tsx?$/.test(f) || /src\/harness\//.test(f));
  return { error: null, memory, moduleCount: seen.size };
}

/**
 * The memory shell and the app harness must not ship in the production entry. The import-graph
 * walk from main.ts always runs (including pre-build precheck); CI's gates job runs `build:web`
 * before this gate so the dist/index.html bundle grep runs there as a second backstop.
 */
function assertProductionExcludesMemoryShell() {
  const desktop = join(root, 'apps', 'desktop');
  const { error, memory, moduleCount } = memoryShellReachableFromMain(desktop);
  if (error === 'missing-main') {
    console.error('bundle gate: apps/desktop/src/main.ts is missing');
    process.exit(1);
  }
  const rel = (f) => f.slice(desktop.length + 1);
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
      for (const spec of distChunkSpecs(text)) {
        queue.push(decodeURIComponent(new URL(spec, `file:///${src}`).pathname).replace(/^\//, ''));
      }
    }
    const bundle = chunks.join('\n');
    if (bundle.includes('createMemoryShell') || bundle.includes('marxyApp')) {
      console.error('bundle gate: production index JS contains createMemoryShell or the harness entry');
      process.exit(1);
    }
    console.log('bundle gate: production index JS excludes createMemoryShell and the harness');
  } else {
    console.log('bundle gate: no vite dist; dist bundle string check skipped (import graph ran)');
  }
  console.log(`bundle gate: main.ts import graph excludes memory.ts (${moduleCount} modules)`);
}

if (isMain) {
assertParserDoesNotResolveKatex();
assertProductionExcludesMemoryShell();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8')).bundle_installed_mb;
// `tauri build` writes installers to target/release/bundle, or target/<triple>/release/bundle when
// the release workflow passes --target. PR CI builds with `cargo build --profile ci` and has neither,
// so the size half runs only where installers exist; MARXY_BUNDLE_REQUIRED (the release workflow)
// makes their absence a failure rather than a skip, so the budget cannot pass by measuring nothing.
const target = fileURLToPath(new URL('../apps/desktop/src-tauri/target/', import.meta.url));
const bundleDirs = [join(target, 'release/bundle'), ...(existsSync(target) ? readdirSync(target).map((t) => join(target, t, 'release/bundle')) : [])].filter((d, i, all) => existsSync(d) && all.indexOf(d) === i);
const required = process.env.MARXY_BUNDLE_REQUIRED === '1';
if (bundleDirs.length === 0) {
  if (required) {
    console.error('bundle gate: MARXY_BUNDLE_REQUIRED is set but no installer bundle was built under src-tauri/target');
    process.exit(1);
  }
  console.log('bundle gate: no bundle built; skipping size and katex-in-bundle checks (they run in the release workflow)');
  process.exit(0);
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
));
const files = bundleDirs.flatMap(walk).filter((f) => /\.(dmg|AppImage|deb)$/.test(f));
let fail = false;
for (const f of files) {
  const mb = statSync(f).size / 1048576;
  const limit = f.endsWith('.dmg') ? budgets.macos : budgets.linux;
  console.log(`${f.split('/').pop()}: ${mb.toFixed(1)} MB (limit ${limit})`);
  if (mb > limit) fail = true;
}
if (files.length === 0) {
  if (required) {
    console.error('bundle gate: MARXY_BUNDLE_REQUIRED is set but the bundle holds no .dmg, .AppImage or .deb');
    process.exit(1);
  }
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
}
