import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkers, automationMarker, authorMarker, evaluate, mainRedReason, lastReset, CONTRIBUTOR } from './merge-policy.mjs';
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
// A review comment as the review skill writes it: the verdict line, findings, the marker last.
const reviewComment = (verdict, s, head = HEAD, run = 'r2', model = 'sonnet', author = CONTRIBUTOR) =>
  ({ author, body: `Independent review: ${verdict.toUpperCase()}\n\nLooks right.\n${review(verdict, head, run, model)}`, createdAt: at(s) });

function validPr(over = {}) {
  return {
    number: 7, isDraft: false, state: 'OPEN', headRefName: 'agent/thing', headRefOid: HEAD, labels: [],
    isCrossRepository: false, headRepositoryOwner: CONTRIBUTOR,
    body: 'Does a thing.\n<!-- marxy-author run=r1 model=opus -->',
    files: ['apps/desktop/src/a.ts'],
    comments: [reviewComment('approve', '2026-11-24T02:00:00')],
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

test('parseMarkers counts only whole kinds with every field well formed', () => {
  const none = [
    `<!-- marxy-review verdict=approve head=${HEAD} -->`,
    `<!-- marxy-review verdict=approve head=${HEAD} run=r2 -->`,
    `<!-- marxy-review verdict=approve head=${HEAD} run="" model=opus -->`,
    `<!-- marxy-review verdict=yes head=${HEAD} run=r2 model=opus -->`,
    `<!-- marxy-review verdict=approve head=abc123 run=r2 model=opus -->`,
    `<!-- marxy-review-foo verdict=approve head=${HEAD} run=r2 model=opus -->`,
    `<!-- marxy-reviewer verdict=approve head=${HEAD} run=r2 model=opus -->`,
    '<!-- marxy-author run=r1 -->',
    '<!-- marxy-intake run=r1 -->',
    '<!--marxy-x-->',
    '<!-- marxy-hold -->',
  ];
  for (const text of none) assert.deepEqual(parseMarkers(text), [], text);
  assert.deepEqual(parseMarkers(`<!--marxy-intake head=${HEAD}-->`), [{ kind: 'intake', head: HEAD }]);
  assert.deepEqual(parseMarkers(`<!-- marxy-intake kind=review verdict=approve head=${HEAD} run=r2 model=sonnet -->`),
    [{ kind: 'intake', verdict: 'approve', head: HEAD, run: 'r2', model: 'sonnet' }], 'a kind= attribute changes nothing');
});

test('the author marker counts only as the last line of the body', () => {
  assert.equal(authorMarker('Does a thing.\n\n<!-- marxy-author run=r1 model=opus -->\n').run, 'r1');
  for (const body of [
    '<!-- marxy-author run=r1 model=opus -->\nand then more words',
    'Does a thing.\n> <!-- marxy-author run=r1 model=opus -->',
    'See `<!-- marxy-author run=r1 model=opus -->`',
    'Does a thing. <!-- marxy-author run=r1 model=opus -->',
  ]) assert.equal(authorMarker(body), null, body);
  assert.ok(run(validPr({ body: '<!-- marxy-author run=r1 model=opus -->\nmore' })).reasons.includes('no author marker'));
});

test('an automation comment is known by its opening line and its marker on the last line', () => {
  const marker = review('approve');
  assert.equal(automationMarker(`Independent review: APPROVE\n\n1. Fine.\n${marker}\n\n`).verdict, 'approve');
  assert.equal(automationMarker(`Intake: no owner comments.\n<!--marxy-intake head=${HEAD} run=n1-->`).kind, 'intake');
  const people = [
    `Why does <!-- marxy-hold --> not work? Do not merge`,
    `Independent review: APPROVE\n${marker}\nthough wait, do not merge`,
    `> Independent review: APPROVE\n> ${marker}\n\nno, wait`,
    `Independent review: APPROVE\n> ${marker}`,
    `Looks right.\n${marker}`,
    `Intake: done.\n${marker}`,
    `Independent review: APPROVE\n<!-- marxy-review verdict=approve head=${HEAD} -->`,
    `Independent review: APPROVE\n${marker} ${marker}`,
    `Independent review: APPROVE\nsee ${marker}`,
    '',
  ];
  for (const body of people) assert.equal(automationMarker(body), null, body);
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
  ['a fork with an agent/ branch', { isCrossRepository: true, headRepositoryOwner: 'someone' }, /not from this repository/],
  ['a fork owned by the contributor\'s name but cross-repository', { isCrossRepository: true }, /not from this repository/],
  ['a head owned by another account', { headRepositoryOwner: 'someone' }, /not from this repository/],
  ['a record that does not say where the head lives', { isCrossRepository: undefined, headRepositoryOwner: undefined }, /not from this repository/],
  ['no author marker', { body: 'plain' }, /no author marker/],
  ['author marker without a model', { body: '<!-- marxy-author run=r1 -->' }, /no author marker/],
  ['no review', { comments: [] }, /no approval of the current head/],
  ['approval of an older head', { comments: [reviewComment('approve', '2026-11-24T02:00:00', OLD)] }, /no approval of the current head/],
  ['reviewer on the author model', { comments: [reviewComment('approve', '2026-11-24T02:00:00', HEAD, 'r2', 'opus')] }, /not independent/],
  ['reviewer in the author run', { comments: [reviewComment('approve', '2026-11-24T02:00:00', HEAD, 'r1', 'sonnet')] }, /not independent/],
  ['review marker with no run or model', { comments: [{ author: CONTRIBUTOR, body: `Independent review: APPROVE\n<!-- marxy-review verdict=approve head=${HEAD} -->`, createdAt: at('2026-11-24T02:00:00') }] },
    /no approval of the current head/],
  ['a kind that is not exactly marxy-review', { comments: [{ author: CONTRIBUTOR, body: `Independent review: APPROVE\n<!-- marxy-review-foo verdict=approve head=${HEAD} run=r2 model=sonnet -->`, createdAt: at('2026-11-24T02:00:00') }] },
    /no approval of the current head/],
  ['an outsider\'s approve marker', { comments: [reviewComment('approve', '2026-11-24T02:00:00', HEAD, 'r2', 'sonnet', 'someone')] },
    /no approval of the current head/],
  ['a comment with no author', { comments: [reviewComment('approve', '2026-11-24T02:00:00', HEAD, 'r2', 'sonnet', null)] },
    /no approval of the current head/],
  ['an approve marker inside an owner comment', { comments: [{ author: CONTRIBUTOR, body: `I think so.\n${review('approve')}`, createdAt: at('2026-11-24T02:00:00') }] },
    /no approval of the current head/],
  ['newer changes verdict', { comments: [
    reviewComment('approve', '2026-11-24T02:00:00'),
    reviewComment('changes', '2026-11-24T03:00:00', HEAD, 'r3', 'haiku'),
  ] }, /changes requested/],
  ['changes verdict in the same second as the approval', { comments: [
    reviewComment('changes', '2026-11-24T02:00:00', HEAD, 'r3', 'haiku'),
    reviewComment('approve', '2026-11-24T02:00:00'),
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

test('an outsider\'s changes verdict holds nothing', () => {
  const pr = validPr({ comments: [reviewComment('approve', '2026-11-24T02:00:00'), reviewComment('changes', '2026-11-24T03:00:00', HEAD, 'r3', 'haiku', 'someone')] });
  assert.deepEqual(run(pr), { merge: true, reasons: [] });
});

test('a changes verdict a second before the approval does not hold', () => {
  const pr = validPr({ comments: [reviewComment('changes', '2026-11-24T01:59:59', HEAD, 'r3', 'haiku'), reviewComment('approve', '2026-11-24T02:00:00')] });
  assert.deepEqual(run(pr), { merge: true, reasons: [] });
});

test('a review time that cannot be read holds rather than passes', () => {
  const unknownChanges = { ...reviewComment('changes', '2026-11-24T03:00:00', HEAD, 'r3', 'haiku'), createdAt: undefined };
  assert.ok(run(validPr({ comments: [reviewComment('approve', '2026-11-24T02:00:00'), unknownChanges] })).reasons.includes('changes requested on the current head'));
  const unknownApproval = { ...reviewComment('approve', '2026-11-24T02:00:00'), createdAt: 'not a time' };
  assert.ok(run(validPr({ comments: [reviewComment('changes', '2026-11-23T02:00:00', HEAD, 'r3', 'haiku'), unknownApproval] })).reasons.includes('changes requested on the current head'));
});

test('merges at any hour', () => {
  assert.equal(run(validPr(), { now: la('2026-11-24T14:05:00') }).merge, true);
  assert.equal(run(validPr(), { now: la('2026-11-24T22:00:00') }).merge, true);
});

test('every failed reason is listed', () => {
  const r = run(validPr({ isDraft: true, labels: ['hold'], mergeStateStatus: 'BLOCKED' }));
  assert.equal(r.reasons.length, 3);
});

const intake = (s, head = HEAD, author = CONTRIBUTOR) => ({ author, body: `Intake: read and answered.\n<!-- marxy-intake head=${head} run=n1 -->`, createdAt: at(s) });
const ownerSays = (s, body = 'Please also cover X.', author = CONTRIBUTOR) => ({ author, body, createdAt: at(s) });
const approve = reviewComment('approve', '2026-11-24T02:00:00');
const plan = (comments) => validPr({ labels: ['plan'], comments: [approve, ...comments] });

test('plan PR merges after the reset with a fresh intake', () => {
  assert.deepEqual(run(plan([ownerSays('2026-11-21T10:00:00'), intake('2026-11-22T01:00:00')])), { merge: true, reasons: [] });
});

test('plan PR: owner comment after the intake blocks it', () => {
  const r = run(plan([intake('2026-11-22T01:00:00'), ownerSays('2026-11-23T10:00:00')]));
  assert.deepEqual(r.reasons, ['owner commented after the intake']);
});

test('plan PR: an owner comment that mentions or quotes a marker still blocks it', () => {
  for (const body of [
    'Why does <!-- marxy-hold --> not work? Do not merge',
    `> Intake: read and answered.\n> <!-- marxy-intake head=${HEAD} run=n1 -->\n\nno, wait`,
    `Intake: looks fine, but do not merge yet\n<!-- marxy-intake head=${HEAD} run=n1 --> was the wrong head`,
  ]) {
    const r = run(plan([intake('2026-11-22T01:00:00'), ownerSays('2026-11-23T10:00:00', body)]));
    assert.deepEqual(r.reasons, ['owner commented after the intake'], body);
  }
});

test('plan PR: an outsider\'s comment after the intake does not block it, and an outsider\'s intake is none', () => {
  assert.deepEqual(run(plan([intake('2026-11-22T01:00:00'), ownerSays('2026-11-23T10:00:00', 'veto', 'someone')])), { merge: true, reasons: [] });
  assert.deepEqual(run(plan([intake('2026-11-22T01:00:00', HEAD, 'someone')])).reasons, ['plan has no intake']);
});

test('plan PR: an owner comment edited after the intake blocks it', () => {
  const old = ownerSays('2026-11-21T10:00:00', 'Fine by me. Edit: do not merge.');
  assert.deepEqual(run(plan([{ ...old, lastEditedAt: at('2026-11-23T10:00:00') }, intake('2026-11-22T01:00:00')])).reasons, ['owner commented after the intake']);
  assert.deepEqual(run(plan([{ ...old, lastEditedAt: null, updatedAt: at('2026-11-23T10:00:00') }, intake('2026-11-22T01:00:00')])).reasons, ['owner commented after the intake']);
  assert.deepEqual(run(plan([{ ...old, lastEditedAt: at('2026-11-21T11:00:00') }, intake('2026-11-22T01:00:00')])), { merge: true, reasons: [] });
});

test('plan PR: an owner comment or intake whose time cannot be read holds it', () => {
  assert.deepEqual(run(plan([intake('2026-11-22T01:00:00'), { ...ownerSays('2026-11-21T10:00:00'), createdAt: undefined }])).reasons, ['owner commented after the intake']);
  const r = run(plan([intake('2026-11-22T01:00:00'), { ...intake('2026-11-22T02:00:00'), createdAt: 'garbage' }]));
  assert.ok(r.reasons.includes('plan intake is older than the weekly reset'), r.reasons.join(' | '));
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
  pr.comments = [{ author: CONTRIBUTOR, body: `Independent review: APPROVE\n<!-- marxy-review verdict=approve head=${pr.headRefOid} run=b model=Sonnet -->`, createdAt: '2026-11-28T01:00:00Z' }];
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

test('a red main holds an otherwise mergeable pull request', () => {
  assert.equal(run(validPr()).merge, true);
  const held = run(validPr(), { mainHold: mainRedReason({ conclusion: 'failure' }) });
  assert.equal(held.merge, false);
  assert.ok(held.reasons.includes('main is red: fix it first'));
});

test('mainRedReason: failure holds, success and a running run do not, an unreadable one holds', () => {
  assert.equal(mainRedReason({ conclusion: 'failure' }), 'main is red: fix it first');
  assert.equal(mainRedReason({ conclusion: 'timed_out' }), 'main is red: fix it first');
  assert.equal(mainRedReason({ conclusion: 'success' }), null);
  assert.equal(mainRedReason({ conclusion: '', status: 'in_progress' }), null);
  assert.match(mainRedReason(null), /could not be read/);
  assert.match(mainRedReason({ conclusion: 'success' }, false), /could not be read/);
});
