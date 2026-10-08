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

/** Static chunk specifiers only (`from"./x"`, side-effect `import"./x"`): what loads before first paint. `import("./x")` is lazy and excluded. */
export function staticChunkSpecs(text) {
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{0,2}\/[^"']+)["']/g)].map((m) => m[1]);
}

/**
 * The JS an index.html loads at startup: its module scripts, its modulepreload links and their
 * static imports, transitively. A lazily imported chunk (KaTeX) is not in this set. Returns
 * `{ files, chunks }` as dist-relative paths and their text, or null when dist/index.html is absent.
 */
export function entryChunks(distDir) {
  const html = join(distDir, 'index.html');
  if (!existsSync(html)) return null;
  const text = readFileSync(html, 'utf8');
  const queue = [
    ...[...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/<link[^>]+rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/<link[^>]+href="([^"]+)"[^>]*rel="modulepreload"/g)].map((m) => m[1]),
  ].map((x) => x.replace(/^\.?\//, ''));
  const files = new Set();
  const chunks = {};
  while (queue.length) {
    const src = queue.pop();
    if (files.has(src)) continue;
    files.add(src);
    const file = join(distDir, src);
    if (!existsSync(file)) continue;
    const js = readFileSync(file, 'utf8');
    chunks[src] = js;
    for (const spec of staticChunkSpecs(js)) queue.push(decodeURIComponent(new URL(spec, `file:///${src}`).pathname).replace(/^\//, ''));
  }
  return { files: [...files], chunks };
}

/**
 * Entry chunks that are KaTeX or contain it: a chunk named katex, or one holding the library's own
 * "KaTeX parse error" message. The app's entry chunk legitimately mentions katex (the `.katex` class
 * it styles and the lazy loaders for KaTeX's chunk and fonts), so the word alone is not the signal.
 * KaTeX loads lazily (design 02-render section 6), so this should be empty.
 */
export function katexInEntry(distDir) {
  const entry = entryChunks(distDir);
  if (!entry) return null;
  if (Object.keys(entry.chunks).length === 0) return { error: 'no-entry-chunks', hits: [] };
  return { error: null, hits: Object.entries(entry.chunks).filter(([f, t]) => /katex/i.test(f) || t.includes('KaTeX parse error')).map(([f]) => f) };
}

/**
 * Strings that only the test harness holds (B-16): the memory shell, the harness entries and the hooks
 * tests drive, and the names of the removed mutation switches. A release bundle that contains one has
 * shipped test plumbing.
 */
export const TEST_ONLY_STRINGS = [
  'createMemoryShell',
  'marxyApp',
  'installTestHooks',
  'marxyHarness',
  'marxyRunCommand',
  'marxySelection',
  '__marxyOrigBytes',
  '__marxyOpenSynced',
  '__marxyTasksReady',
  'MARXY_8',
  'MARXY_19',
];

/** The test-only strings `bundle` contains. */
export function testOnlyStringsIn(bundle) {
  return TEST_ONLY_STRINGS.filter((s) => bundle.includes(s));
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
    const shipped = testOnlyStringsIn(bundle);
    if (shipped.length > 0) {
      console.error(`bundle gate: production index JS contains test-only strings: ${shipped.join(', ')}`);
      process.exit(1);
    }
    console.log('bundle gate: production index JS excludes createMemoryShell, the harness and the test hooks');
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
let fail = false;
{
  // (Runs before the no-installer exit: it needs only dist/.) Installers are compressed and legitimately hold KaTeX's lazy chunk and fonts, so the question
  // is whether KaTeX is in the startup path: the entry chunks index.html loads statically.
  const distDir = fileURLToPath(new URL('../apps/desktop/dist/', import.meta.url));
  const found = katexInEntry(distDir);
  if (found === null) {
    if (required) {
      console.error('bundle gate: MARXY_BUNDLE_REQUIRED is set but apps/desktop/dist/index.html is missing; run build:web first');
      fail = true;
    } else console.log('bundle gate: no vite dist; skipping katex-in-entry check');
  } else if (found.error) {
    console.error('bundle gate: dist/index.html loads no entry chunks; the katex check is broken');
    fail = true;
  } else if (found.hits.length > 0) {
    console.error(`bundle gate: KaTeX is in the startup path: ${found.hits.join(', ')} (it must be a lazy chunk)`);
    fail = true;
  } else console.log('bundle gate: entry chunks contain no katex (it loads lazily)');
}
if (bundleDirs.length === 0) {
  if (fail) {
    console.error('bundle gate failed');
    process.exit(1);
  }
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
for (const f of files) {
  const mb = statSync(f).size / 1048576;
  const limit = f.endsWith('.dmg') ? budgets.macos : budgets.linux;
  console.log(`${f.split('/').pop()}: ${mb.toFixed(1)} MB (limit ${limit})`);
  if (mb > limit) fail = true;
}
if (required && files.length === 0) {
  console.error('bundle gate: MARXY_BUNDLE_REQUIRED is set but the bundle holds no .dmg, .AppImage or .deb');
  process.exit(1);
}
if (fail) {
  console.error('bundle gate failed');
  process.exit(1);
}
console.log('bundle gate ok');
}
