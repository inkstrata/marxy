// A guard against the orchestration outgrowing the product: counts are printed either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The owner asked for presence checks and cleanup on 2026-11-27, so the limit went from 1,200 to 1,500.
const CODE_LIMIT = 1500;
const SKILL_LIMIT = 600;

function walk(dir, keep) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return names.flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, keep);
    return keep(e.name) ? [p] : [];
  });
}

const lines = (files) => files.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').length - 1, 0);
// Lines of code: blank lines and lines that are only a comment don't count, so explaining why stays free.
const COMMENT = /^\s*(\/\/|\/\*|\*|#|<#|#>|<!--)/;
const codeLines = (files) => files.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() && !COMMENT.test(l)).length, 0);

test('scripts/auto code stays small', () => {
  const files = walk(path.join(root, 'scripts', 'auto'), (n) => /\.(mjs|ps1|sh)$/.test(n) && !n.endsWith('.test.mjs'));
  const total = codeLines(files);
  console.log(`scripts/auto: ${total} lines of code in ${files.length} files (limit ${CODE_LIMIT})`);
  assert.ok(total <= CODE_LIMIT, `scripts/auto has ${total} lines, over ${CODE_LIMIT}`);
});

test('night, plan-week and review skills stay small', () => {
  const files = ['night', 'plan-week', 'review'].flatMap((s) => walk(path.join(root, '.claude', 'skills', s), (n) => n.endsWith('.md')));
  const total = lines(files);
  console.log(`skills: ${total} Markdown lines in ${files.length} files (limit ${SKILL_LIMIT})`);
  assert.ok(total <= SKILL_LIMIT, `the skills have ${total} lines, over ${SKILL_LIMIT}`);
});
