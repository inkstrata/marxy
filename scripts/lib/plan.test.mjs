import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planFrom, readPlan, readPlanAt, toCsv, parseCsv, HEADERS, storyRows } from './plan.mjs';
import { exportCsv } from '../plan-export.mjs';
import { planAt, rowOnBranch } from '../../orchestration/plan.mjs';
import { defaultRowsOf } from '../../orchestration/worktrees.mjs';
import { stories, deps, phaseOf } from '../../orchestration/lib.mjs';

// One plan, in both forms. The CSV quotes what needs it, including a multi-line acceptance.
const EPIC = { key: 'MARXY-4', type: 'Epic', summary: 'Phase 0', epic: 'Phase 0', parent: '', labels: [], paths: [], description: 'Foundations, "quoted"', acceptance: '' };
const S5 = { key: 'MARXY-5', type: 'Story', summary: 'Freeze, the contracts', epic: '', parent: 'MARXY-4', labels: ['phase-0', 'agent-loop'], paths: ['packages/core', 'package.json'], description: '', acceptance: '1. one\n2. two "quoted"', phase: '0', depends: [] };
const S10 = { key: 'MARXY-10', type: 'Story', summary: 'Second', epic: '', parent: 'MARXY-4', labels: ['phase-1'], paths: ['a/*/b'], description: 'd', acceptance: 'ok', phase: '1', depends: ['MARXY-5'] };
const SOPS = { key: 'MARXY-77', type: 'Story', summary: 'Ops', epic: '', parent: 'MARXY-4', labels: [], paths: ['x'], description: '', acceptance: 'y', phase: 'ops', depends: [] };
const PLACEHOLDER = { key: 'MARXY-NEW-later', type: 'Story', summary: 'Later', epic: '', parent: 'MARXY-4', labels: [], paths: [], description: '', acceptance: 'z' };
const STORIES = [S5, S10, SOPS, PLACEHOLDER];
const csvOf = () => toCsv([EPIC, ...STORIES].map(o => ({ Key: o.key, Type: o.type, Summary: o.summary, Epic: o.epic, Parent: o.parent, Labels: o.labels.join(','), Paths: o.paths.join(', '), Description: o.description, Acceptance: o.acceptance })));
const depsOf = () => ({ _note: 'n', phases: { 0: ['MARXY-5'], 1: ['MARXY-10'], ops: ['MARXY-77'] }, deps: { 'MARXY-10': ['MARXY-5'] }, research: {} });

function checkout({ withStories = true, csv = false, edit } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plan-'));
  const put = (p, t) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), t); };
  if (withStories) {
    for (const s of edit ? edit(STORIES) : STORIES) put(`docs/plan/stories/${s.key}.json`, JSON.stringify(s, null, 2) + '\n');
    put('docs/plan/stories/README.md', '# not a story\n');
    put('docs/plan/epics.json', JSON.stringify([EPIC], null, 2) + '\n');
  }
  if (csv) { put('docs/plan/jira-issues.csv', csvOf()); put('orchestration/deps.json', JSON.stringify(depsOf(), null, 2) + '\n'); }
  return root;
}
const git = (root, ...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' });
const committed = root => { git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'plan'); return root; };

test('toCsv and parseCsv round-trip commas, quotes and newlines', () => {
  const rows = parseCsv(csvOf());
  assert.equal(rows.length, 5);
  assert.equal(rows[1].Acceptance, S5.acceptance);
  assert.equal(toCsv(rows), csvOf());
});

test('story files give the same rows, deps and phases as the CSV and deps.json', () => {
  const a = readPlan({ root: checkout({ withStories: false, csv: true }) });
  const b = readPlan({ root: checkout({ withStories: true, csv: false }) });
  assert.equal(a.form, 'csv'); assert.equal(b.form, 'stories');
  assert.deepEqual(b.all, a.all);
  assert.deepEqual(b.deps.phases, a.deps.phases);
  assert.deepEqual(b.deps.deps, a.deps.deps);
  assert.deepEqual(storyRows(b.all, b.deps.research).map(r => r.Key), ['MARXY-5', 'MARXY-10', 'MARXY-77']);
});

test('the same holds from git objects at a ref, in both forms', () => {
  const csvRepo = committed(checkout({ withStories: false, csv: true }));
  const fileRepo = committed(checkout({ withStories: true, csv: false }));
  const a = readPlanAt('HEAD', { cwd: csvRepo }), b = readPlanAt('HEAD', { cwd: fileRepo });
  assert.equal(b.form, 'stories');
  assert.deepEqual(b.all, a.all);
  assert.deepEqual(b.deps.phases, a.deps.phases);
  assert.deepEqual(b.deps.deps, a.deps.deps);
  assert.equal(readPlanAt('nope', { cwd: fileRepo }), null);
});

test('planAt, rowOnBranch and defaultRowsOf give the same answer for either form', () => {
  const csvRepo = committed(checkout({ withStories: false, csv: true }));
  const fileRepo = committed(checkout({ withStories: true, csv: false }));
  for (const repo of [csvRepo, fileRepo]) git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const reader = repo => (ref, p) => { try { return execFileSync('git', ['show', `${ref}:${p}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const lister = repo => (ref, dir) => { try { return execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', dir], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };
  const a = planAt('origin/main', { read: reader(csvRepo), list: lister(csvRepo) });
  const b = planAt('origin/main', { read: reader(fileRepo), list: lister(fileRepo) });
  assert.deepEqual(b.rows, a.rows);
  assert.deepEqual(b.deps, a.deps);
  assert.equal(rowOnBranch('main', 'MARXY-10', { read: reader(fileRepo), list: lister(fileRepo) }).Summary, 'Second');
  assert.equal(rowOnBranch('main', 'MARXY-NEW-later', { read: reader(fileRepo), list: lister(fileRepo) }), null);
  const row = defaultRowsOf([])('MARXY-10', fileRepo);
  assert.deepEqual(row, defaultRowsOf([])('MARXY-10', csvRepo));
  assert.equal(row.Paths, 'a/*/b');
});

test('the git reader answers with the tree it was given, not the working tree', () => {
  const repo = committed(checkout());
  writeFileSync(join(repo, 'docs/plan/stories/MARXY-5.json'), JSON.stringify({ ...S5, summary: 'edited after commit' }));
  assert.equal(readPlanAt('HEAD', { cwd: repo }).all.find(r => r.Key === 'MARXY-5').Summary, S5.summary);
  assert.equal(readPlan({ root: repo }).all.find(r => r.Key === 'MARXY-5').Summary, 'edited after commit');
});

test('both forms present and equal is fine; a mismatch names the key and field', () => {
  assert.equal(readPlan({ root: checkout({ csv: true }) }).form, 'stories');
  assert.throws(() => readPlan({ root: checkout({ csv: true, edit: l => l.map(s => (s.key === 'MARXY-10' ? { ...s, summary: 'Changed' } : s)) }) }), /MARXY-10, field Summary/);
  assert.throws(() => readPlan({ root: checkout({ csv: true, edit: l => l.map(s => (s.key === 'MARXY-10' ? { ...s, depends: [] } : s)) }) }), /MARXY-10, field depends/);
  assert.throws(() => readPlan({ root: checkout({ csv: true, edit: l => l.map(s => (s.key === 'MARXY-5' ? { ...s, phase: '1' } : s)) }) }), /MARXY-5, field phase/);
  assert.throws(() => readPlan({ root: checkout({ csv: true, edit: l => l.filter(s => s.key !== 'MARXY-77') }) }), /MARXY-77: it has a row in .* but no story file/);
  assert.throws(() => readPlan({ root: checkout({ csv: true, edit: l => [...l, { ...S5, key: 'MARXY-99' }] }) }), /MARXY-99: it has a story file but no row/);
});

test('a story file must be named for its key and be valid JSON', () => {
  const root = checkout();
  writeFileSync(join(root, 'docs/plan/stories/MARXY-6.json'), JSON.stringify({ ...S5, key: 'MARXY-7' }));
  assert.throws(() => readPlan({ root }), /MARXY-6\.json: the file name must be its key/);
  writeFileSync(join(root, 'docs/plan/stories/MARXY-6.json'), '{nope');
  assert.throws(() => readPlan({ root }), /MARXY-6\.json: not valid JSON/);
});

test('no plan at all is null, and phases come out in numeric key order', () => {
  assert.equal(planFrom({ read: () => null }), null);
  const p = readPlan({ root: checkout() });
  assert.deepEqual(Object.keys(p.deps.phases), ['0', '1', 'ops']);
});

test('lib.mjs stories, deps and phaseOf read the CSV form on this repository', () => {
  assert.ok(stories().length > 100);
  assert.equal(phaseOf('MARXY-5'), 0);
  assert.ok(deps().phases['0'].includes('MARXY-5'));
});

test('plan-export --csv is byte-identical to the committed CSV, and generates one from story files', () => {
  const out = execFileSync('node', [new URL('../plan-export.mjs', import.meta.url).pathname, '--csv'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(out, readFileSync(new URL('../../docs/plan/jira-issues.csv', import.meta.url), 'utf8'));
  assert.equal(exportCsv(readPlan({ root: checkout() })), csvOf());
  assert.deepEqual(parseCsv(csvOf())[0], Object.fromEntries(HEADERS.map(h => [h, h === 'Key' ? 'MARXY-4' : h === 'Type' ? 'Epic' : h === 'Summary' || h === 'Epic' ? 'Phase 0' : h === 'Description' ? 'Foundations, "quoted"' : ''])));
});
