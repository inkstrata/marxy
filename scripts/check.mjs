// The hygiene checks, run as one command: `pnpm check`. Each check is its own script, spawned as a
// child process and reported in one line; a failure prints the last six lines of its output, which
// end with the script's own `fix:` line (the shape of scripts/precheck.mjs). CI runs this, so a check
// is added here and nowhere else. usage: node scripts/check.mjs [--staged] [--only name[,name]]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const staged = argv.includes('--staged');
const only = argv.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',') ?? null;

/** In the order they run; `--staged` goes only to the registry check. */
export const CHECKS = [
  { name: 'check-boundaries', script: 'check-boundaries.mjs' },
  { name: 'check-registry', script: 'check-registry.mjs', args: staged ? ['--staged'] : [] },
  { name: 'check-deps', script: 'check-deps.mjs' },
  { name: 'check-deferrals', script: 'check-deferrals.mjs' },
  { name: 'check-one-parse', script: 'check-one-parse.mjs' },
  { name: 'check-tokens', script: 'check-tokens.mjs' },
  { name: 'gate-font-attrs', script: 'gate-font-attrs.mjs' },
  { name: 'gate-contrast', script: 'gate-contrast.mjs' },
  { name: 'check-workflows', script: 'check-workflows.mjs' },
];

/** Runs each check as a child process; returns [{ name, ok, tail }]. */
export function runChecks(checks, { cwd = ROOT, dir = HERE, log = console.log } = {}) {
  const results = [];
  for (const c of checks) {
    const r = spawnSync(process.execPath, [join(dir, c.script), ...(c.args ?? [])], { cwd, encoding: 'utf8' });
    const ok = r.status === 0;
    const tail = `${r.stdout}${r.stderr}`.trim().split('\n').filter(Boolean).slice(-6).join('\n      ');
    results.push({ name: c.name, ok, tail });
    log(`${ok ? '✓' : '✗'} ${c.name}${ok ? '' : `\n      ${tail}`}`);
  }
  return results;
}

if (import.meta.main) {
  const unknown = (only ?? []).filter(n => !CHECKS.some(c => c.name === n));
  if (unknown.length) { console.error(`check: unknown check ${unknown.join(', ')}\n    fix: one of ${CHECKS.map(c => c.name).join(', ')}`); process.exit(2); }
  const results = runChecks(CHECKS.filter(c => !only || only.includes(c.name)));
  const failed = results.filter(r => !r.ok);
  console.log(`\ncheck: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('fix: each ✗ above ends with its own "fix:" line; run the script alone for full output'); process.exit(1); }
}
