// Keeps the package's runtime surface honest: production code must not reach into `parse/testing/`,
// and every package it does import at runtime must be a declared runtime dependency. The HTML renderer
// under `testing/` is the reason this matters — it is the only user of `micromark-util-sanitize-uri`,
// and `packages/core` never emits HTML (ADR-0007).

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const srcDir = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function sourceFiles(directory: URL, prefix = ''): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...sourceFiles(new URL(`${entry.name}/`, directory), `${name}/`));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    files.push({ path: name, text: readFileSync(new URL(entry.name, directory), 'utf8') });
  }
  return files;
}

const all = sourceFiles(srcDir);
const production = all.filter((file) => !file.path.endsWith('.test.ts') && !file.path.includes('parse/testing/'));
/** Value imports only: a `import type` is erased before anything runs, so it is not a runtime edge. */
const imports = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"\n]*from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);

test('production code does not import test-support code', () => {
  const offenders = production
    .filter((file) => imports(file.text).some((specifier) => specifier.includes('/testing/')))
    .map((file) => file.path);
  assert.deepEqual(offenders, [], 'test-support code must stay out of the runtime surface');
});

test('production code imports only declared runtime dependencies', () => {
  const runtime = new Set(Object.keys(manifest.dependencies ?? {}));
  const offenders: string[] = [];
  for (const file of production) {
    for (const specifier of imports(file.text)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      if (!runtime.has(specifier)) offenders.push(`${file.path} imports ${specifier}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the HTML renderer is the only user of the URI helper, and it is a dev dependency', () => {
  const users = all.filter((file) => imports(file.text).includes('micromark-util-sanitize-uri')).map((file) => file.path);
  assert.deepEqual(users, ['parse/testing/reference-html.ts']);
  assert.ok(manifest.devDependencies?.['micromark-util-sanitize-uri'], 'the URI helper must be a devDependency');
  assert.equal(manifest.dependencies?.['micromark-util-sanitize-uri'], undefined);
});

test('production code runs in a browser: no node: imports outside tests and scripts', () => {
  const offenders: string[] = [];
  for (const file of production) {
    for (const specifier of imports(file.text)) {
      if (specifier.startsWith('node:')) offenders.push(`${file.path} imports ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], 'packages/core must run in Node and in a browser (AGENTS.md module map)');
});
