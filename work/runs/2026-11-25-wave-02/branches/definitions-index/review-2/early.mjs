// Instrumented variants: throw if any label was pushed before the hook first ran (region or whole parse).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const WT = 'C:/Dev/reader/worktrees/definitions-index';
const P = `${WT}/packages/core/src/parse/parse.ts`;
const orig = readFileSync(P, 'utf8');
const check = "if (parser === undefined) {\n        parser = this.parser;\n        if ((parser.defined.length > 0 || (parser.gfmFootnotes?.length ?? 0) > 0)) throw new Error('EARLYPUSH');";
const base = orig.replace("if (parser === undefined) {\n        parser = this.parser;", check);
if (base === orig) { console.log('pattern'); process.exit(2); }
const hooks = "{ document: { 91: hook }, contentInitial: { 91: hook }, text: { 91: hook, 93: hook } }";
const V = {
  both: hooks,
  docOnly: "{ document: { 91: hook }, text: { 91: hook, 93: hook } }",
  contentOnly: "{ contentInitial: { 91: hook }, text: { 91: hook, 93: hook } }",
  textOnly: "{ text: { 91: hook, 93: hook } }",
};
const id = process.argv[2];
if (!orig.includes(hooks)) { console.log('hooks pattern'); process.exit(2); }
writeFileSync(P, base.replace(hooks, V[id]));
try {
  for (const [cases, seed, env] of [[4000, 5, {}], [4000, 7, { DENSE: '1' }], [60, 9, { EXH: "1" }]]) {
    const d = spawnSync('node', ['--experimental-strip-types', 'C:/Dev/reader/work/wave2/definitions-index/review-2/diff.mts', String(cases), String(seed)], { encoding: 'utf8', env: { ...process.env, ...env } });
    console.log(id, JSON.stringify(env), (d.stdout || '').split('\n')[0].slice(0, 120), (d.stderr || '').split('\n').find((l) => l.includes('EARLYPUSH')) ? 'EARLYPUSH THROWN' : 'no early push');
  }
} finally {
  execFileSync('git', ['-C', WT, 'checkout', '--', 'packages/core/src/parse/parse.ts']);
}
