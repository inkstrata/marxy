// check-csp rejects a bad policy and runtime <style> creation (MARXY-250).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cspProblems,
  loadConfiguredCsp,
  loadRuntimeStyleSources,
  main,
  releaseStyleCsp,
  runtimeStyleProblems,
} from './check-csp.mjs';

test('configured CSP drops style-src unsafe-inline and allows KaTeX style attributes', () => {
  const problems = cspProblems(loadConfiguredCsp());
  assert.deepEqual(problems, []);
});

test('style-src unsafe-inline is refused', () => {
  assert.ok(cspProblems("default-src 'none'; style-src 'self' 'unsafe-inline'").some((p) => /unsafe-inline/.test(p)));
});

test('missing style-src-attr is refused', () => {
  assert.ok(cspProblems("default-src 'none'; style-src 'self'").some((p) => /style-src-attr/.test(p)));
});

test('runtime style paths do not create <style> elements', () => {
  assert.deepEqual(runtimeStyleProblems(loadRuntimeStyleSources()), []);
});

test('a planted createElement(style) fails the scanner', () => {
  const problems = runtimeStyleProblems({ 'x.ts': "doc.createElement('style')" });
  assert.equal(problems.length, 1);
});

test('release CSP adds a nonce to style-src', () => {
  const base = "default-src 'none'; style-src 'self'; style-src-attr 'unsafe-inline'";
  const served = releaseStyleCsp(base, 'abc');
  assert.match(served, /style-src 'self' 'nonce-abc'/);
  assert.doesNotMatch(served, /style-src 'self' 'unsafe-inline'/);
  assert.match(served, /style-src-attr 'unsafe-inline'/);
});

test('--selftest exits zero', () => {
  main(['--selftest']);
});

test('the runtime style scan walks every runtime source, including code added after it was written (MARXY-337)', () => {
  const sources = loadRuntimeStyleSources();
  assert.ok('apps/desktop/src/frontispiece/index.ts' in sources);
  assert.ok(!Object.keys(sources).some((rel) => /\.test\./.test(rel)));
  assert.deepEqual(runtimeStyleProblems(sources), []);
});
