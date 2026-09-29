import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareTitle, displayTitle, landsOf, titleUpdate } from './pr-mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SUBJECT = 'feat(desktop): run the suite (MARXY-247)';

test('[human] and (signed) are the only marks, and an automerge pull request stays unmarked', () => {
  assert.equal(landsOf({ waitingOn: 'reviewer', reviewed: false }).mark, '');
  assert.equal(landsOf({ waitingOn: 'CI', reviewed: true }).mark, '(signed)');
  assert.equal(landsOf({ waitingOn: 'author', reviewed: false }).mark, '[human]');
  assert.equal(landsOf({ waitingOn: 'author', reviewed: true }).mark, '[human] (signed)');
});

test('a title round-trips, a stale mark is stripped, and an unmarked title is left alone', () => {
  assert.equal(bareTitle(SUBJECT), SUBJECT);
  assert.equal(displayTitle(SUBJECT, '[human]'), `[human] ${SUBJECT}`);
  assert.equal(displayTitle(SUBJECT, '(signed)'), `(signed) ${SUBJECT}`);
  assert.equal(displayTitle(SUBJECT, '[human] (signed)'), `[human] (signed) ${SUBJECT}`);
  assert.equal(bareTitle(`[human] (signed) ${SUBJECT}`), SUBJECT);
  assert.equal(titleUpdate(`[human] (signed) ${SUBJECT}`, '')?.title, SUBJECT);
  assert.equal(titleUpdate(SUBJECT, ''), null);
  assert.equal(titleUpdate(`[human] ${SUBJECT}`, '[human]'), null);
  assert.equal(titleUpdate('', '[human]'), null);
});

test('the conventions job lints the title with the mark removed', () => {
  const yml = readFileSync(join(here, '../.github/workflows/ci.yml'), 'utf8');
  assert.match(yml, /node orchestration\/pr-mark\.mjs --bare/);
  const out = execFileSync(process.execPath, [join(here, 'pr-mark.mjs'), '--bare'], {
    env: { ...process.env, PR_TITLE: `[human] (signed) ${SUBJECT}` },
    encoding: 'utf8',
  });
  assert.equal(out, `${SUBJECT}\n`);
});
