// node mut.mjs <id>: apply one mutation, run my two differentials, restore with git checkout.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const T = 'C:/Dev/reader/worktrees/definitions-index';
const P = `${T}/packages/core/src/parse/parse.ts`;
const R = `${T}/packages/core/src/parse/reparse.ts`;
const D = 'C:/Dev/reader/work/wave2/definitions-index/review-3';
const M = {
  noHookContent: [P, 'contentInitial: { 91: hook }, ', ''],
  agreesAlways: [P, 'agrees: known === undefined || probe === undefined || regionAgrees(known, entries, probe.lists(), gfm),', 'agrees: true,'],
  noSeedLinks: [P, 'for (const label of seed.links) parser.defined.push(label);', ''],
  freshPlain: [R, 'const between = entriesIn(entries, prior.src.end, at);\n  if (between.length === 0) return fresh(bytes, prior, at);', 'const between = entriesIn(entries, prior.src.end, at);\n  return fresh(bytes, prior, at);'],
  noCodeGuard: [R, "  if (prior.type === 'codeBlock' && !fenced(bytes, prior)) return false;\n  return fresh(bytes, { ...prior", '  return fresh(bytes, { ...prior'],
};
const id = process.argv[2];
const [file, from, to] = M[id];
const src = readFileSync(file, 'utf8');
if (!src.includes(from)) { console.log(id, 'PATTERN NOT FOUND'); process.exit(2); }
writeFileSync(file, src.replace(from, to));
try {
  for (const args of [[`${D}/adv.mts`, '400', '1', '20'], [`${D}/exhaustive.mts`]]) {
    const r = spawnSync('node', ['--experimental-strip-types', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const lines = (r.stdout + r.stderr).trim().split('\n');
    console.log(id, args[0].split('/').pop(), lines.at(-1).slice(0, 300), lines.length > 1 ? '| first: ' + lines[0].slice(0, 300) : '');
  }
} finally {
  execFileSync('git', ['-C', T, 'checkout', '--', file.replace(`${T}/`, '')]);
}
