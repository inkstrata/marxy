// One command before a PR: runs typecheck/lint/test for the packages you touched, the gates mapped to
// your paths, and the hygiene checks. Prints a table with a fix line per failure. usage: pnpm precheck [--all]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, changedFiles } from './lib/repo.mjs';
const all = process.argv.includes('--all');
const map = JSON.parse(readFileSync(join(ROOT, 'scripts/gates-by-path.json'), 'utf8'));
const files = all ? ['packages/', 'apps/', 'fixtures/corpus/', 'package.json'] : changedFiles();
const pkgs = new Set(); const gates = new Set(map.always);
for (const f of files) {
  const p = /^(packages\/[^/]+|apps\/[^/]+)/.exec(f); if (p) pkgs.add(p[1]);
  for (const [prefix, g] of Object.entries(map)) if (prefix !== '_note' && prefix !== 'always' && (f === prefix || f.startsWith(prefix.replace(/\/$/, '') + '/') || f.startsWith(prefix))) g.forEach(x => gates.add(x));
  if (/^(package\.json|pnpm-workspace\.yaml|tsconfig|scripts\/)/.test(f)) ['packages/core', 'packages/theme', 'packages/typeset', 'packages/shell-api', 'apps/desktop'].forEach(x => pkgs.add(x));
}
const steps = [{ name: 'check:cards', cmd: ['node', ['scripts/check-cards.mjs']] }];
for (const p of pkgs) for (const s of ['typecheck', 'lint', 'test']) steps.push({ name: `${p} ${s}`, cmd: ['pnpm', ['--filter', `./${p}`, s]] });
for (const g of gates) steps.push({ name: g, cmd: ['pnpm', ['run', '-s', g]] });
if (steps.length === 1) { console.log('precheck: only board/card check (no package changes)'); }
const results = [];
for (const s of steps) {
  const r = spawnSync(s.cmd[0], s.cmd[1], { cwd: ROOT, encoding: 'utf8' });
  const ok = r.status === 0; const tail = (r.stdout + r.stderr).trim().split('\n').filter(Boolean).slice(-6).join('\n      ');
  results.push({ name: s.name, ok, tail });
  console.log(`${ok ? '✓' : '✗'} ${s.name}${ok ? '' : `\n      ${tail}`}`);
}
const failed = results.filter(r => !r.ok);
console.log(`\nprecheck: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('fix: each ✗ above prints its own "fix:" line; run the command alone for full output'); process.exit(1); }
