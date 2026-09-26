// Out-of-plan work carries its own row (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { outOfPlanRow, upsertRow, withDeps } from './out-of-plan.mjs';
import { parseCsv, here, ROOT } from './lib.mjs';

const HEAD = 'Key,Type,Summary,Epic,Parent,Labels,Paths,Description,Acceptance\n';
const base = `${HEAD}MARXY-1,Story,one,,MARXY-4,ops,a,"multi\nline, with comma",x\nMARXY-2,Story,two,,MARXY-4,ops,b,d,y\n`;
const opts = { key: 'MARXY-9', summary: 'nine, "quoted"', paths: 'orchestration/x.mjs,  docs/y.md', acceptance: '1. it works' };

test('the row is an ops-lane no-dispatch Story labelled out-of-plan, and round-trips through the CSV parser', () => {
  const row = outOfPlanRow(opts);
  assert.equal(row.Labels, 'ops,out-of-plan,no-dispatch');
  assert.equal(row.Parent, 'MARXY-4');
  assert.equal(row.Paths, 'orchestration/x.mjs, docs/y.md');
  const parsed = parseCsv(upsertRow(base, row));
  assert.deepEqual(parsed.at(-1), row);
  assert.equal(parsed.length, 3);
});

test('a numbered phase takes that phase label and epic', () => {
  const row = outOfPlanRow({ ...opts, phase: '2' });
  assert.equal(row.Labels, 'phase-2,out-of-plan,no-dispatch');
  assert.equal(row.Parent, 'MARXY-32');
});

test('paths and acceptance are required, and the key must be a Jira key', () => {
  assert.throws(() => outOfPlanRow({ ...opts, paths: '' }), /--paths/);
  assert.throws(() => outOfPlanRow({ ...opts, acceptance: ' ' }), /--acceptance/);
  assert.throws(() => outOfPlanRow({ ...opts, key: 'MARXY-NEW-x' }), /not a Jira key/);
  assert.throws(() => outOfPlanRow({ ...opts, phase: '7' }), /--phase/);
});

test('upserting an existing key replaces only that row, even past a multi-line cell', () => {
  const next = upsertRow(base, outOfPlanRow({ ...opts, key: 'MARXY-2' }));
  const rows = parseCsv(next);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Description, 'multi\nline, with comma');
  assert.equal(rows[1].Summary, 'nine, "quoted"');
  assert.ok(next.startsWith(base.slice(0, base.indexOf('MARXY-2'))), 'lines before the row are unchanged');
});

test('deps puts the key in exactly one phase', () => {
  const d = withDeps({ phases: { ops: ['MARXY-9'], 1: ['MARXY-1'] }, deps: {} }, 'MARXY-9', '2', ['MARXY-1']);
  assert.deepEqual(d.phases, { ops: [], 1: ['MARXY-1'], 2: ['MARXY-9'] });
  assert.deepEqual(d.deps['MARXY-9'], ['MARXY-1']);
});

test('start --dry-run creates nothing and names the branch and worktree', () => {
  const r = spawnSync(process.execPath, [here('out-of-plan.mjs'), 'start', 'Do a thing', '--paths', 'a', '--acceptance', '1. x', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /git worktree add --no-track -b chore\/MARXY-0-do-a-thing .*marxy-wt\/MARXY-0 origin\/main/);
  assert.equal(readFileSync(`${ROOT}docs/plan/jira-issues.csv`, 'utf8').includes('MARXY-0,'), false);
});

test('upserting the first, a middle or the last row leaves every other line byte-identical, past newline, \\r and short-row cells', () => {
  const csv = `${HEAD}MARXY-0,Story,short row parseCsv drops\nMARXY-1,Story,one,,MARXY-4,ops,a,"multi\nline",x\nMARXY-2,Story,two,,MARXY-4,ops,b,d,"has\r\nCRLF and\rbare CR"\nMARXY-3,Story,three,,MARXY-4,ops,c,d,z\nMARXY-4,Story,four,,MARXY-4,ops,e,"tail\nline",w\n`;
  const rows = parseCsv(csv);
  for (const target of rows) {
    const changed = { ...target, Summary: `${target.Summary} X` };
    const next = upsertRow(csv, changed);
    const after = parseCsv(next);
    assert.deepEqual(after.map(r => r.Key), rows.map(r => r.Key), `${target.Key}: keys and order kept`);
    assert.deepEqual(after.find(r => r.Key === target.Key), changed);
    for (const r of rows.filter(r => r.Key !== target.Key)) assert.deepEqual(after.find(x => x.Key === r.Key), r);
    // the only bytes that differ are the replaced row's Summary cell
    const at = csv.indexOf(`,${target.Summary},`);
    assert.equal(next, csv.slice(0, at) + `,${target.Summary} X,` + csv.slice(at + target.Summary.length + 2));
  }
});

test('the same holds when the last row has no trailing newline', () => {
  const csv = `${HEAD}MARXY-1,Story,one,,MARXY-4,ops,a,d,x\nMARXY-2,Story,two,,MARXY-4,ops,b,d,y`;
  const next = upsertRow(csv, { ...parseCsv(csv)[1], Summary: 'two X' });
  assert.equal(next, csv.replace(',two,', ',two X,'));
});
