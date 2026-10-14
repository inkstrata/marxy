// The quiet date's pure half (K-22): which characters of a heading or a first line are the date.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bareDateSpan, versionDateSpan } from './quiet-dates.ts';

const at = (text: string, span: readonly [number, number] | null): string | null => (span === null ? null : text.slice(span[0], span[1]));

test('a version heading\'s date is the ISO date after the version', () => {
  assert.equal(at('[1.4.0] — 2026-09-12', versionDateSpan('[1.4.0] — 2026-09-12')), '2026-09-12');
  assert.equal(at('v2.0.1 (2026-01-02)', versionDateSpan('v2.0.1 (2026-01-02)')), '2026-01-02');
  assert.equal(at('Version 3.1 - 2026-03-04', versionDateSpan('Version 3.1 - 2026-03-04')), '2026-03-04');
});

test('a heading that is not a version, or has no date, has none', () => {
  assert.equal(versionDateSpan('Unreleased'), null);
  assert.equal(versionDateSpan('Released 2026-09-12'), null);
  assert.equal(versionDateSpan('[1.4.0]'), null);
  assert.equal(versionDateSpan('Added'), null);
});

test('a first line is a date line only when it is nothing but the date', () => {
  assert.equal(at(' 2026-10-08 ', bareDateSpan(' 2026-10-08 ')), '2026-10-08');
  assert.equal(bareDateSpan('2026-10-08: standup'), null);
  assert.equal(bareDateSpan('Thursday 2026-10-08'), null);
});
