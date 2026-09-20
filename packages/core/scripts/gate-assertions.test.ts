// Criterion 3 of MARXY-83: deleting any assertion inside the no-network gate fails a named test.
//
// Each test below proves one entry of `GATE_ASSERTION_IDS` by calling the same pure function
// `scripts/gate-no-network.mjs` calls to decide that check, with a case it must catch and (mostly)
// a case it must pass. The final test compares what ran against `GATE_ASSERTION_IDS` by identity: if
// a covering test above is deleted, `covered` is short an id `GATE_ASSERTION_IDS` still has, and it
// fails; if an id is deleted from `GATE_ASSERTION_IDS` instead, `covered` now holds an id the list
// no longer does, and it fails the same way. The only way to remove a check without anything here
// going red is to delete it from every one of three places at once — the gate's own `check(...)`
// call, this list, and its covering test — which is a three-file diff a reviewer reads, not a
// one-line revert nobody notices. `scripts/gate-no-network.mjs` runs the complementary half at
// runtime: it fails if the set of ids it actually executed is not exactly `GATE_ASSERTION_IDS`,
// which is what catches the `check(...)` call being deleted while this list is left alone.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { GATE_ASSERTION_IDS } from './gate-assertions.ts';
import {
  PARITY_URL_ATTRIBUTES, classifyRequestUrl, diffParityNames, diffParityUrls,
  findAllowListViolations, findContainmentViolations, hasEntries, isReferenceInSource,
  isRenderedBlank, mentionsTag, sawHost,
} from './gate-checks.ts';

const gateSource = readFileSync(new URL('../../../scripts/gate-no-network.mjs', import.meta.url), 'utf8');

const covered = new Set<string>();
const cover = (id: string): void => {
  covered.add(id);
};

test('control-interception: the interception must see a request reach the control host', () => {
  cover('control-interception');
  assert.equal(sawHost(['https://no-network-control.invalid/theme.css'], 'no-network-control.invalid'), true);
  assert.equal(sawHost(['https://elsewhere.invalid/x'], 'no-network-control.invalid'), false);
});

test('control-hostile-unsanitised: the unsanitised hostile fixture must be seen reaching out', () => {
  cover('control-hostile-unsanitised');
  assert.equal(hasEntries(['https://evil.invalid/x']), true);
  assert.equal(hasEntries([]), false);
});

test('control-dirty-element: an un-allow-listed element must be seen in the live DOM', () => {
  cover('control-dirty-element');
  assert.equal(mentionsTag(['<marquee>'], '<marquee>'), true);
  assert.equal(mentionsTag(['<a>'], '<marquee>'), false);
});

test('control-dirty-containment: a block inside a formatting element must be seen in the live DOM', () => {
  cover('control-dirty-containment');
  assert.equal(mentionsTag(['<p> inside <a>'], 'inside <a>'), true);
  assert.equal(mentionsTag(['<p>'], 'inside <a>'), false);
});

test('control-traversal-escaped: a reference above the document directory must be classified escaped', () => {
  cover('control-traversal-escaped');
  const origin = 'https://document.marxy.invalid';
  const directory = 'https://document.marxy.invalid/corpus/';
  assert.equal(classifyRequestUrl('https://document.marxy.invalid/etc/passwd', origin, directory), 'escaped');
  assert.equal(classifyRequestUrl('https://document.marxy.invalid/corpus/local.png', origin, directory), 'contained');
  assert.equal(classifyRequestUrl('https://remote.invalid/x', origin, directory), 'remote');
});

test('reference-contained: a contained request must be a reference the document source actually has', () => {
  cover('reference-contained');
  const directory = 'https://document.marxy.invalid/corpus/';
  assert.equal(isReferenceInSource(`${directory}local.png`, directory, '![x](local.png)'), true);
  assert.equal(isReferenceInSource(`${directory}other.png`, directory, '![x](local.png)'), false);
  assert.equal(isReferenceInSource(directory, directory, ''), true);
});

test('rendered-not-empty: a non-blank source must not render to nothing', () => {
  cover('rendered-not-empty');
  assert.equal(isRenderedBlank('', '# hello'), true);
  assert.equal(isRenderedBlank('<h1>hello</h1>', '# hello'), false);
  assert.equal(isRenderedBlank('', ''), false);
});

test('no-remote-requests: a request reaching a host other than the document\'s own must fail the gate', () => {
  cover('no-remote-requests');
  assert.equal(hasEntries(['https://remote.invalid/x']), true);
  assert.equal(hasEntries([]), false);
});

test('no-escaped-requests: a request resolving outside the document directory must fail the gate', () => {
  cover('no-escaped-requests');
  assert.equal(hasEntries(['https://document.marxy.invalid/etc/passwd']), true);
  assert.equal(hasEntries([]), false);
});

test('no-live-dom-violations: an element, attribute or containment violation must fail the gate', () => {
  cover('no-live-dom-violations');
  assert.deepEqual(findAllowListViolations([{ tag: 'marquee', attributes: [] }], ['p'], {}), ['<marquee>']);
  assert.deepEqual(findAllowListViolations([{ tag: 'p', attributes: ['onclick'] }], ['p'], { p: [] }), ['p[onclick]']);
  assert.deepEqual(findAllowListViolations([{ tag: 'p', attributes: [] }], ['p'], { p: [] }), []);
  assert.deepEqual(findContainmentViolations([{ tag: 'p', attributes: [], ancestorTags: ['a'] }], ['p']), ['<p> inside <a>']);
  assert.deepEqual(findContainmentViolations([{ tag: 'p', attributes: [], ancestorTags: ['div'] }], ['p', 'div']), []);
});

test('parity-element-names: an element built from text a parser keeps inert must be caught', () => {
  cover('parity-element-names');
  assert.deepEqual(
    diffParityNames(new Set(['a']), new Set(['a', 'script'])),
    ['<script> built from text the parser keeps inert'],
  );
  assert.deepEqual(diffParityNames(new Set(['a']), new Set(['a'])), []);
});

test('parity-attribute-urls: a URL built from text a parser keeps inert must be caught, on every tracked attribute', () => {
  cover('parity-attribute-urls');
  // The list itself is part of the assertion: shrinking it silently shrinks what the check catches.
  assert.deepEqual(PARITY_URL_ATTRIBUTES, ['src', 'href', 'poster', 'data', 'srcset']);
  // The gate keeps its own literal copy of this list (`boundary.test.ts` pins that exact substring),
  // so the two are asserted equal here rather than one importing the other.
  assert.ok(
    gateSource.includes(`[${PARITY_URL_ATTRIBUTES.map((a) => `'${a}'`).join(', ')}]`),
    'the gate\'s own tracked-attribute list has drifted from PARITY_URL_ATTRIBUTES',
  );
  for (const attribute of PARITY_URL_ATTRIBUTES) {
    const url = `https://evil.invalid/${attribute}`;
    assert.deepEqual(
      diffParityUrls(new Set(), new Set([url])),
      [`${url} fetched from text the parser keeps inert`],
      `a URL resurrected on [${attribute}] was not caught`,
    );
  }
  assert.deepEqual(diffParityUrls(new Set(['https://ok.invalid/x']), new Set(['https://ok.invalid/x'])), []);
});

test('every declared gate assertion was proved above, and nothing else was', () => {
  assert.deepEqual(
    [...covered].sort(),
    [...GATE_ASSERTION_IDS].sort(),
    'the ids this suite covered must equal GATE_ASSERTION_IDS exactly: a mismatch means a covering ' +
      'test was deleted, or an id was added or removed from the gate\'s declared list without the other',
  );
});

// Criterion 4 (MARXY-84): the tree-depth harness runs in the no-network gate on both engines, with
// no skip path — the same spawn the gate uses for this file, so deleting either half fails CI.
test('tree-depth harness runs as part of the no-network gate', () => {
  const repoRoot = new URL('../../../', import.meta.url).pathname;
  const depth = spawnSync(process.execPath, ['packages/core/scripts/gate-tree-depth.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MARXY_84_MUTATION: undefined },
  });
  process.stdout.write(depth.stdout ?? '');
  if (depth.status !== 0) {
    process.stderr.write(depth.stderr ?? '');
  }
  assert.equal(
    depth.status,
    0,
    'packages/core/scripts/gate-tree-depth.mjs must pass when spawned from the gate\'s mutation-coverage suite',
  );
});
