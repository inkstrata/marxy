// The fleet's docs cannot drift from its code (ADR-0034). Every file, command, status and timing a
// live document or prompt names must exist and agree with the code; a rename that forgets a doc fails
// here instead of misleading the next agent that reads it. Historical records (plan deltas, task
// cards, CHANGELOG, accepted ADRs other than 0034) are left as written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATES, TIMING, unknownModelKeys } from './machine.mjs';
import { commands } from './fleet.mjs';
import { promptFor } from './runs.mjs';

const root = join(import.meta.dirname, '..');
const read = p => readFileSync(join(root, p), 'utf8');

/** Documents a reader or an agent is told to follow today. */
export const LIVE_DOCS = [
  'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'orchestration/README.md', 'docs/sdlc.md', 'docs/ci-contract.md',
  'docs/hygiene.md', 'docs/plan.md', 'docs/adr/0034-the-fleet-is-a-reconciler.md',
  ...readdirSync(join(root, 'orchestration/prompts')).map(f => `orchestration/prompts/${f}`),
  ...readdirSync(join(root, '.cursor/agents')).map(f => `.cursor/agents/${f}`),
].filter(p => existsSync(join(root, p)));

/** Generated or legacy paths a doc may name without their existing in the tree, and the worked example's name. */
const GENERATED = [/^orchestration\/results(\/|$)/, /^orchestration\/status\.md$/, /^orchestration\/state\.json$/, /^orchestration\/thing(\.test)?\.mjs$/];

test('every orchestration file a live doc names exists', () => {
  const missing = [];
  for (const doc of LIVE_DOCS) {
    for (const [, path] of read(doc).matchAll(/\b(orchestration\/[A-Za-z0-9_./-]+?\.(?:mjs|sh|json|md))\b/g)) {
      if (GENERATED.some(re => re.test(path))) continue;
      if (!existsSync(join(root, path))) missing.push(`${doc}: ${path}`);
    }
  }
  assert.deepEqual(missing, [], 'a document names a file that is not there');
});

test('every fleet.mjs command a live doc names is a real command', () => {
  const bad = [];
  for (const doc of LIVE_DOCS) {
    for (const [, cmd] of read(doc).matchAll(/fleet\.mjs\s+([a-z][a-z-]*)/g)) if (!commands[cmd]) bad.push(`${doc}: fleet.mjs ${cmd}`);
  }
  assert.deepEqual(bad, []);
});

test('fleet.mjs documents every command it has, and nothing else', () => {
  const header = read('orchestration/fleet.mjs').split('\n').filter(l => l.startsWith('//   node orchestration/fleet.mjs'));
  const documented = new Set(header.map(l => l.split(/\s+/)[3]));
  assert.deepEqual([...documented].sort(), Object.keys(commands).sort());
});

test('every loop.sh subcommand a live doc names exists', () => {
  const bad = [];
  for (const doc of LIVE_DOCS) {
    for (const [, sub] of read(doc).matchAll(/loop\.sh\s+(start|stop|status|run|[a-z]+)\b/g)) if (!['start', 'stop', 'status', 'run'].includes(sub)) bad.push(`${doc}: loop.sh ${sub}`);
  }
  assert.deepEqual(bad, []);
});

test('the README lists every status with its owner, and the timings with their real defaults', () => {
  const readme = read('orchestration/README.md');
  for (const status of Object.keys(STATES)) assert.match(readme, new RegExp(`\\| \\*\\*${status}\\*\\* \\|`), `README status table lists ${status}`);
  const listed = Object.fromEntries([...readme.matchAll(/`([a-zA-Z]+)` (\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  for (const [k, v] of Object.entries(TIMING)) assert.equal(listed[k], v, `README gives ${k} as ${listed[k]}, the code as ${v}`);
});

test('every prompt a run is given has its placeholders filled', () => {
  const row = { Key: 'MARXY-1', Summary: 's', Paths: 'a', Acceptance: 'c', Labels: 'ops' };
  for (const role of ['implement', 'review', 'resolve', 'plan']) {
    const text = promptFor(role, { key: 'MARXY-1', row, pr: 1, branch: 'feat/MARXY-1-s', minutes: 45 });
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, `${role} prompt left a placeholder`);
  }
});

test('models.json holds no setting the fleet does not read', () => {
  assert.deepEqual(unknownModelKeys(JSON.parse(read('orchestration/models.json'))), []);
  assert.deepEqual(unknownModelKeys({ stalMinutes: 5, _note: 'x' }), ['stalMinutes'], 'a misspelt timing is caught');
});

test('every ADR on disk is in the index', () => {
  const index = read('docs/adr/README.md');
  const files = readdirSync(join(root, 'docs/adr')).filter(f => /^\d{4}-.*\.md$/.test(f));
  for (const f of files) assert.ok(index.includes(`(${f})`), `docs/adr/README.md lists ${f}`);
});

test('no live doc tells anyone to run a module the reconciler replaced', () => {
  const gone = ['board-check.mjs', 'board-park.mjs', 'dispatch.mjs', 'reap.mjs', 'review-dispatch.mjs', 'conflict-dispatch.mjs', 'plan-dispatch.mjs'];
  const hits = [];
  for (const doc of LIVE_DOCS) for (const g of gone) if (new RegExp(`node orchestration/${g.replace('.', '\\.')}`).test(read(doc))) hits.push(`${doc}: ${g}`);
  assert.deepEqual(hits, []);
});
