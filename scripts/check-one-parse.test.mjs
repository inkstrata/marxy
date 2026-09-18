// The one-parse check must be able to fail: leftover deps, leftover imports, or a plan.md
// that names markdown-it again are the regressions this story exists to keep out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  leftoverDependencyName,
  leftoverImportSpecifier,
  leftoverDependenciesInManifest,
  leftoverDependenciesInLockfile,
  leftoverImportsInSource,
  planNamesOneParse,
  check,
} from './check-one-parse.mjs';

test('leftover names include markdown-it, its plugins, DOMPurify and both @types packages', () => {
  assert.equal(leftoverDependencyName('markdown-it'), 'markdown-it');
  assert.equal(leftoverDependencyName('markdown-it-anchor'), 'markdown-it-anchor');
  assert.equal(leftoverDependencyName('dompurify'), 'dompurify');
  assert.equal(leftoverDependencyName('@types/markdown-it'), '@types/markdown-it');
  assert.equal(leftoverDependencyName('@types/dompurify'), '@types/dompurify');
  assert.equal(leftoverDependencyName('@marxy/core'), null);
  assert.equal(leftoverDependencyName('mdast-util-from-markdown'), null);
});

test('a manifest that still declares a leftover exits the check', () => {
  const hits = leftoverDependenciesInManifest({
    dependencies: { '@marxy/core': 'workspace:*', 'markdown-it': '^15.0.2' },
    devDependencies: { '@types/markdown-it': '^14.1.2', typescript: '^5.9.3' },
  });
  assert.deepEqual(hits.sort(), ['@types/markdown-it', 'markdown-it']);
});

test('a lockfile that still pins a leftover exits the check', () => {
  const lock = [
    'importers:',
    '  apps/desktop:',
    '    dependencies:',
    '      markdown-it:',
    '        specifier: ^15.0.2',
    '        version: 15.0.2',
    'packages:',
    '  markdown-it@15.0.2:',
    '    resolution: {integrity: sha512-deadbeef}',
    '  \'@types/dompurify@3.0.5\':',
    '    resolution: {integrity: sha512-deadbeef}',
  ].join('\n');
  assert.deepEqual(leftoverDependenciesInLockfile(lock).sort(), ['@types/dompurify', 'markdown-it']);
});

test('imports of leftover parsers/sanitisers fail; @marxy/core and core source paths do not', () => {
  assert.equal(leftoverImportSpecifier('markdown-it'), 'markdown-it');
  assert.equal(leftoverImportSpecifier('dompurify'), 'dompurify');
  assert.equal(leftoverImportSpecifier('@marxy/core'), null);
  assert.equal(leftoverImportSpecifier('@marxy/core/src/render/index.ts'), null);
  assert.equal(leftoverImportSpecifier('../packages/core/src/render/index.ts'), null);
  const hits = leftoverImportsInSource(`
    import MarkdownIt from 'markdown-it';
    import { renderSafeHtml } from '@marxy/core/src/render/index.ts';
    const other = await import('dompurify');
  `);
  assert.deepEqual(hits.sort(), ['dompurify', 'markdown-it']);
});

test('plan.md must name mdast/micromark and must not name markdown-it', () => {
  assert.equal(planNamesOneParse('parser (mdast/micromark, CommonMark + GFM — ADR-0021)'), true);
  assert.equal(planNamesOneParse('parser (markdown-it, CommonMark + GFM)'), false);
  assert.equal(planNamesOneParse('parser (something else)'), false);
});

test('the live tree has no leftover parser and the check exits 0', () => {
  assert.deepEqual(check(), []);
  const run = spawnSync(process.execPath, ['scripts/check-one-parse.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /one-parse ok/);
});
