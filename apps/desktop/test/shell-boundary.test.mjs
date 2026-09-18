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
