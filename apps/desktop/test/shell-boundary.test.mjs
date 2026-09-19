// Proves the shell-api boundary (ADR-0010, ADR-0020): Tauri invoke() and @tauri-apps imports exist
// only under apps/desktop/src/shell, so replacing the shell means rewriting that directory alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const shellDir = join('apps', 'desktop', 'src', 'shell');
const skipDirs = new Set(['node_modules', 'dist', 'target', '.git', 'results', 'screenshots']);
const sourceExt = /\.(m?[jt]sx?|svelte|vue|html)$/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...sourceFiles(full));
    } else if (sourceExt.test(entry.name) && statSync(full).size < 2_000_000) {
      out.push(full);
    }
  }
  return out;
}

// Comments are stripped so that prose about the rule — the shell-api contract's own header says
// "No invoke() calls anywhere else" — is not mistaken for a call.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = sourceFiles(repoRoot).map(f => ({
  rel: relative(repoRoot, f),
  text: stripComments(readFileSync(f, 'utf8')),
}));

test('the repository has source files to scan', () => {
  assert.ok(files.length > 3, `expected to scan several files, scanned ${files.length}`);
});

test('invoke( appears only under apps/desktop/src/shell', () => {
  const offenders = files
    .filter(f => !f.rel.startsWith(shellDir + sep) && !f.rel.startsWith('apps/desktop/test/'))
    .filter(f => /\binvoke\s*\(/.test(f.text))
    .map(f => f.rel);
  assert.deepEqual(offenders, [], `invoke( outside ${shellDir}: ${offenders.join(', ')}`);
});

test('@tauri-apps is imported only under apps/desktop/src/shell', () => {
  const offenders = files
    .filter(f => !f.rel.startsWith(shellDir + sep))
    .filter(f => /['"]@tauri-apps\//.test(f.text))
    .map(f => f.rel);
  assert.deepEqual(offenders, [], `@tauri-apps import outside ${shellDir}: ${offenders.join(', ')}`);
});

test('the shell directory is the one that does talk to Tauri', () => {
  const shellFiles = files.filter(f => f.rel.startsWith(shellDir + sep));
  assert.ok(shellFiles.some(f => /\binvoke\s*\(/.test(f.text)), 'no invoke() found in the shell directory');
});

/** Runtime (non-type) export names, plus the wildcard and default forms, which can re-export anything. */
function valueExports(text) {
  const names = [];
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)/.exec(spec);
      names.push(as ? as[1] : spec);
    }
  }
  if (/export\s+default\b/.test(text)) names.push('default');
  if (/export\s*\*/.test(text)) names.push('*');
  return names;
}

// The grep above checks how a call site is spelled, which a convenience wrapper defeats:
// `export const call = invoke` inside this directory, used from anywhere, is still a hole in the
// boundary. So the directory's runtime export surface is an allowlist — one shell object, nothing
// that hands a caller the raw IPC channel.
test('apps/desktop/src/shell exports only the shell object and the memory factory', () => {
  const allowed = ['shell', 'createMemoryShell'];
  const exported = files
    .filter(f => f.rel.startsWith(shellDir + sep))
    .flatMap(f => valueExports(f.text).map(name => ({ name, rel: f.rel })));
  assert.ok(exported.length > 0, `no exports found under ${shellDir}`);
  const offenders = exported.filter(e => !allowed.includes(e.name)).map(e => `${e.rel}:${e.name}`);
  assert.deepEqual(offenders, [], `${shellDir} may export only ${allowed.join(', ')}; found ${offenders.join(', ')}`);
});

test('app.ts never imports shell/tauri.ts', () => {
  const app = files.find(f => f.rel === join('apps', 'desktop', 'src', 'app.ts'));
  assert.ok(app, 'apps/desktop/src/app.ts is missing');
  assert.doesNotMatch(app.text, /shell\/tauri/);
});

test('memory.ts is never imported from main.ts', () => {
  const main = files.find(f => f.rel === join('apps', 'desktop', 'src', 'main.ts'));
  assert.ok(main, 'apps/desktop/src/main.ts is missing');
  assert.doesNotMatch(main.text, /memory\.ts|createMemoryShell|shell\/memory/);
});

test('main.ts is at most 30 lines and contains no parse or render call', () => {
  const raw = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'main.ts'), 'utf8');
  const lines = raw.replace(/\n$/, '').split('\n');
  assert.ok(lines.length <= 30, `main.ts is ${lines.length} lines; startApp must own startup`);
  assert.doesNotMatch(stripComments(raw), /parseMarkdown|renderDocumentSafeHtml|\.innerHTML\s*=/);
});
