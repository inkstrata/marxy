// MARXY-308: Cargo.toml dependency extraction must cover inline and [dependencies.crate] table headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { cargoDependencyProblems } from './check-deps.mjs';

const allow = JSON.parse(readFileSync(join(ROOT, 'scripts/allowlists/dependencies.json'), 'utf8'));

test('MARXY-308: inline [dependencies] crate = "1.0" form is checked', () => {
  const toml = `[dependencies]\nreqwest = "0.11"\n`;
  const problems = cargoDependencyProblems('fixture/Cargo.toml', toml, allow);
  assert.ok(problems.some((p) => p.includes('reqwest') && p.includes('forbidden')));
});

test('MARXY-308: [dependencies.crate-name] table form flags a forbidden crate', () => {
  const toml = `[dependencies.comrak]\nversion = "0.22"\nfeatures = ["simd"]\n`;
  const problems = cargoDependencyProblems('fixture/Cargo.toml', toml, allow);
  // The pre-fix parser never extracted `comrak` from the header, so this assert would have failed (0 matches).
  assert.equal(problems.filter((p) => p.includes('comrak')).length, 1);
  assert.match(problems[0], /forbidden/);
});

test('MARXY-308: table form does not treat version/features as crate names', () => {
  const toml = `[dependencies.serde]\nversion = "1"\nfeatures = ["derive"]\n`;
  const problems = cargoDependencyProblems('fixture/Cargo.toml', toml, allow);
  assert.deepEqual(problems, []);
});

test('MARXY-308: dev-dependencies and build-dependencies table headers are recognized', () => {
  const toml = `[dev-dependencies.pulldown-cmark]\nversion = "0.9"\n\n[build-dependencies.hyper]\nversion = "1"\n`;
  const problems = cargoDependencyProblems('fixture/Cargo.toml', toml, allow);
  assert.ok(problems.some((p) => p.includes('pulldown-cmark')));
  assert.ok(problems.some((p) => p.includes('hyper')));
});

test('MARXY-308: target-specific dependencies table headers are recognized', () => {
  const toml = `[target.'cfg(windows)'.dependencies.sentry]\nversion = "0.34"\n`;
  const problems = cargoDependencyProblems('fixture/Cargo.toml', toml, allow);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sentry/);
});
