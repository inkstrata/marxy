// Variants of the hook set; throws if a LINK label was pushed before a seeded hook's first run. Reports the throw (stderr) and diff summary.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const WT = 'C:/Dev/reader/worktrees/definitions-index';
const P = `${WT}/packages/core/src/parse/parse.ts`;
const orig = readFileSync(P, 'utf8');
const hooks = '{ document: { 91: hook }, contentInitial: { 91: hook }, text: { 91: hook, 93: hook } }';
const probe = 'if (parser === undefined) {\n        parser = this.parser;';
if (!orig.includes(hooks) || !orig.includes(probe)) { console.log('pattern'); process.exit(2); }
const V = {
  both: hooks,
  docOnly: '{ document: { 91: hook }, text: { 91: hook, 93: hook } }',
  contentOnly: '{ contentInitial: { 91: hook }, text: { 91: hook, 93: hook } }',
};
const id = process.argv[2];
const check = probe + "\n        if (seed !== undefined && parser.defined.length > 0) throw new Error('EARLYPUSH');";
writeFileSync(P, orig.replace(probe, check).replace(hooks, V[id]));
try {
  for (const [cases, seed, env] of [[4000, 5, {}], [4000, 6, {}], [4000, 8, { DENSE: '1' }]]) {
    const d = spawnSync('node', ['--experimental-strip-types', 'C:/Dev/reader/work/wave2/definitions-index/review-2/diff.mts', String(cases), String(seed)], { encoding: 'utf8', env: { ...process.env, ...env } });
    const err = (d.stderr || '').split('\n').filter((l) => /EARLYPUSH|Error/.test(l)).slice(0, 2).join(' / ');
    console.log(id, JSON.stringify(env), (d.stdout || '').split('\n')[0].slice(0, 110), err || 'no early push');
  }
} finally {
  execFileSync('git', ['-C', WT, 'checkout', '--', 'packages/core/src/parse/parse.ts']);
}
