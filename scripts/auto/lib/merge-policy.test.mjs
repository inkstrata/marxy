import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkers, evaluate, lastReset } from './merge-policy.mjs';
import { parseCodeowners } from './codeowners.mjs';

const la = (s) => new Date(`${s}-08:00`);
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = la('2026-11-24T09:00:00'); // Tuesday morning
const RESET = la('2026-11-20T20:00:00');
const ownerRules = parseCodeowners('/.github/ @owner\nAGENTS.md @owner');

const review = (verdict, head = HEAD, run = 'r2', model = 'sonnet') =>
  `<!-- marxy-review verdict=${verdict} head=${head} run=${run} model=${model} -->`;
const at = (s) => la(s).toISOString();

function validPr(over = {}) {
  return {
    number: 7, isDraft: false, state: 'OPEN', headRefName: 'agent/thing', headRefOid: HEAD, labels: [],
    body: 'Does a thing.\n<!-- marxy-author run=r1 model=opus -->',
    files: ['apps/desktop/src/a.ts'],
    comments: [{ body: `Looks right.\n${review('approve')}`, createdAt: at('2026-11-24T02:00:00') }],
    checks: [{ name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' }, { name: 'lint', conclusion: 'NEUTRAL' }],
    mergeStateStatus: 'CLEAN',
    ...over,
  };
}
const run = (pr, opts = {}) => evaluate(pr, { now: NOW, ownerRules, lastResetAt: RESET, ...opts });

test('parseMarkers tolerates spacing, order and quotes', () => {
  const m = parseMarkers(`x <!--marxy-review   model="opus 5" head=${HEAD}  verdict=approve run=r9   --> y
    <!-- marxy-intake head=${OLD} --><!-- marxy-author run=r1 model=opus -->`);
  assert.deepEqual(m, [
    { kind: 'review', model: 'opus 5', head: HEAD, verdict: 'approve', run: 'r9' },
    { kind: 'intake', head: OLD },
    { kind: 'author', run: 'r1', model: 'opus' },
  ]);
  assert.deepEqual(parseMarkers('<!-- other -->'), []);
});

test('lastReset is the most recent Friday 20:00 local', () => {
  assert.equal(lastReset(NOW).toISOString(), RESET.toISOString());
  assert.equal(lastReset(la('2026-11-27T19:59:00')).toISOString(), RESET.toISOString());
  assert.equal(lastReset(la('2026-11-27T20:00:00')).toISOString(), la('2026-11-27T20:00:00').toISOString());
});

test('a fully valid PR merges', () => assert.deepEqual(run(validPr()), { merge: true, reasons: [] }));

const failing = [
  ['closed', { state: 'MERGED' }, /not open/],
  ['draft', { isDraft: true }, /draft/],
  ['branch', { headRefName: 'feature/x' }, /agent\/\*/],
  ['no author marker', { body: 'plain' }, /no author marker/],
  ['no review', { comments: [] }, /no approval of the current head/],
  ['approval of an older head', { comments: [{ body: review('approve', OLD), createdAt: at('2026-11-24T02:00:00') }] },
    /no approval of the current head/],
  ['reviewer on the author model', { comments: [{ body: review('approve', HEAD, 'r2', 'opus'), createdAt: at('2026-11-24T02:00:00') }] },
    /not independent/],
  ['reviewer in the author run', { comments: [{ body: review('approve', HEAD, 'r1', 'sonnet'), createdAt: at('2026-11-24T02:00:00') }] },
    /not independent/],
  ['newer changes verdict', { comments: [
    { body: review('approve'), createdAt: at('2026-11-24T02:00:00') },
    { body: review('changes', HEAD, 'r3', 'haiku'), createdAt: at('2026-11-24T03:00:00') },
  ] }, /changes requested/],
  ['ci missing', { checks: [] }, /ci has not passed/],
  ['ci pending', { checks: [{ name: 'ci', conclusion: null, status: 'IN_PROGRESS' }] }, /ci has not passed/],
  ['a failed check', { checks: [{ name: 'ci', conclusion: 'success' }, { name: 'e2e', conclusion: 'TIMED_OUT' }] },
    /failed checks: e2e/],
  ['owner paths', { files: ['a.ts', '.github/workflows/ci.yml', 'docs/AGENTS.md'] },
    /waits for the owner: CODEOWNERS paths \.github\/workflows\/ci\.yml, docs\/AGENTS\.md/],
  ['hold', { labels: ['hold'] }, /labelled hold/],
  ['unstable', { mergeStateStatus: 'UNSTABLE' }, /not CLEAN/],
  ['has hooks', { mergeStateStatus: 'HAS_HOOKS' }, /not CLEAN/],
];
for (const [name, over, reason] of failing) {
  test(`refused: ${name}`, () => {
    const r = run(validPr(over));
    assert.equal(r.merge, false);
    assert.ok(r.reasons.some((x) => reason.test(x)), r.reasons.join(' | '));
  });
}

test('merges at any hour', () => {
  assert.equal(run(validPr(), { now: la('2026-11-24T14:05:00') }).merge, true);
  assert.equal(run(validPr(), { now: la('2026-11-24T22:00:00') }).merge, true);
});

test('every failed reason is listed', () => {
  const r = run(validPr({ isDraft: true, labels: ['hold'], mergeStateStatus: 'BLOCKED' }));
  assert.equal(r.reasons.length, 3);
});

const intake = (s, head = HEAD) => ({ body: `Read and answered.\n<!-- marxy-intake head=${head} -->`, createdAt: at(s) });
const ownerSays = (s) => ({ body: 'Please also cover X.', createdAt: at(s) });
const approve = { body: review('approve'), createdAt: at('2026-11-24T02:00:00') };
const plan = (comments) => validPr({ labels: ['plan'], comments: [approve, ...comments] });

test('plan PR merges after the reset with a fresh intake', () => {
  assert.deepEqual(run(plan([ownerSays('2026-11-21T10:00:00'), intake('2026-11-22T01:00:00')])), { merge: true, reasons: [] });
});

test('plan PR: owner comment after the intake blocks it', () => {
  const r = run(plan([intake('2026-11-22T01:00:00'), ownerSays('2026-11-23T10:00:00')]));
  assert.deepEqual(r.reasons, ['owner commented after the intake']);
});

test('plan PR: held until an intake made after the reset', () => {
  const r = run(plan([intake('2026-11-22T01:00:00')]), { lastResetAt: la('2026-11-27T20:00:00') });
  assert.deepEqual(r.reasons, ['plan intake is older than the weekly reset']);
});

test('plan PR: known by its branch when the label is missing', () => {
  const pr = plan([]);
  pr.labels = [];
  pr.headRefName = 'agent/plan-2026-12-04';
  assert.ok(run(pr).reasons.includes('plan has no intake'));
});

test('independence compares model families, not spellings', () => {
  const pr = plan([]);
  pr.labels = [];
  pr.headRefName = 'agent/x';
  pr.body = '<!-- marxy-author run=a model=claude-sonnet-5-5 -->';
  pr.comments = [{ body: `<!-- marxy-review verdict=approve head=${pr.headRefOid} run=b model=Sonnet -->`, createdAt: '2026-11-28T01:00:00Z' }];
  assert.ok(run(pr).reasons.some((x) => x.startsWith('approval is not independent')));
});

test('plan PR: intake from before the reset refused', () => {
  const r = run(plan([intake('2026-11-19T01:00:00')]));
  assert.deepEqual(r.reasons, ['plan intake is older than the weekly reset']);
});

test('plan PR: no intake, or an intake of an older head, refused', () => {
  assert.deepEqual(run(plan([])).reasons, ['plan has no intake']);
  assert.deepEqual(run(plan([intake('2026-11-22T01:00:00', OLD)])).reasons, ['plan intake is for an older head']);
});
