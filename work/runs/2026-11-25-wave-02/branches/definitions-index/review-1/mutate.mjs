// node mutate.mjs <id>: applies one mutation to the worktree, runs reparse.test.ts and my differential, restores.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const W = 'C:/Dev/reader/worktrees/definitions-index/packages/core';
const P = `${W}/src/parse/parse.ts`;
const R = `${W}/src/parse/reparse.ts`;
const M = {
  noSeedLinks: [P, 'for (const label of seed.links) parser.defined.push(label);', ''],
  noSeedFootnotes: [P, 'for (const label of seed.footnotes) parser.gfmFootnotes.push(label);', ''],
  noTargets: [P, 'documentFromMdast(tree, { file, text, offsets }, known?.targets)', 'documentFromMdast(tree, { file, text, offsets })'],
  sameAlways: [R, 'if (x.kind !== y.kind || x.identifier !== y.identifier || x.url !== y.url || x.title !== y.title) return false;', ''],
  sameNoOrderOrUrl: [R, 'x.kind !== y.kind || x.identifier !== y.identifier || x.url !== y.url || x.title !== y.title', 'x.kind !== y.kind || x.identifier !== y.identifier'],
  hookLast: [P, '[...extensions, probe.extension] : extensions', '[probe.extension, ...extensions] : extensions'],
  noHook93: [P, 'text: { 91: hook, 93: hook }', 'text: { 91: hook }'],
  noHookText91: [P, 'text: { 91: hook, 93: hook }', 'text: { 93: hook }'],
  noHookContent: [P, 'contentInitial: { 91: hook }, ', ''],
  noHookDoc: [P, 'document: { 91: hook }, ', ''],
  agreesAlways: [P, 'agrees: known === undefined || probe === undefined || regionAgrees(known, entries, probe.lists(), gfm),', 'agrees: true,'],
  freshPlain: [R, 'const between = entriesIn(entries, prior.src.end, at);\n  if (between.length === 0) return fresh(bytes, prior, at);', 'const between = entriesIn(entries, prior.src.end, at);\n  return fresh(bytes, prior, at);'],
  indexNotMoved: [R, '.map((e) => (delta === 0 ? e : { ...e, start: e.start + delta, end: e.end + delta }))', ''],
  noEntriesHead: [R, 'const head = entriesIn(index.entries, 0, restart);', 'const head = [] as DefinitionEntry[];'],
  oldEndAt: [R, 'if (!sameDefinitions(entriesIn(entries, restart, oldEnd), replacing)) return', 'if (!sameDefinitions(entriesIn(entries, restart, blocks[k]!.src.start + 1), replacing)) return'],
  tailCheckSkipped: [R, "if (!sameDefinitions(entriesIn(entries, restart, oldEnd), region.entries)) return 'definition';", ''],
  footnoteSetNoSeed: [P, 'parser.gfmFootnotes ??= [];', 'parser.gfmFootnotes ??= []; if (seed.footnotes.length) return nok;'],
  chunkedNoDefs: [`${W}/src/parse/chunked.ts`, 'return documentOf(file, bytes, blocks, NO_DEFINITIONS);', 'return documentOf(file, bytes, blocks, NO_DEFINITIONS); '],
};
const id = process.argv[2];
const [file, from, to] = M[id];
const src = readFileSync(file, 'utf8');
if (!src.includes(from)) { console.log(id, 'PATTERN NOT FOUND'); process.exit(2); }
writeFileSync(file, src.replace(from, to));
try {
  const t = spawnSync('node', ['--test', '--experimental-strip-types', 'src/parse/reparse.test.ts'], { cwd: W, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = t.stdout + t.stderr;
  const failed = [...out.matchAll(/^✖ (.*?) \(/gm)].map((m) => m[1]);
  console.log(id, 'TESTS', failed.length ? 'FAIL: ' + [...new Set(failed)].join(' | ') : 'pass', (out.match(/ℹ pass (\d+)/) ?? [])[1]);
  const d = spawnSync('node', ['--experimental-strip-types', 'C:/Dev/reader/work/wave2/definitions-index/review-1/diff.mts', '4000', '5'], { encoding: 'utf8' });
  console.log(id, 'MYDIFF', (d.stdout || d.stderr).split('\n')[0].slice(0, 200));
} finally {
  execFileSync('git', ['-C', 'C:/Dev/reader/worktrees/definitions-index', 'checkout', '--', file.replace('C:/Dev/reader/worktrees/definitions-index/', '')]);
}
