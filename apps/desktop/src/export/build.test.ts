import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportName, htmlDocument, PAPER } from './build.ts';

const input = {
  title: 'Plan <1>',
  html: '<h1>Plan</h1><p>Text.</p>',
  colours: PAPER,
};

test('HTML is one file: the page, its title escaped, its colours inline, no script and nothing to fetch', () => {
  const doc = htmlDocument(input);
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /<title>Plan &lt;1&gt;<\/title>/);
  assert.match(doc, /<article>\n<h1>Plan<\/h1><p>Text.<\/p>\n<\/article>/);
  assert.doesNotMatch(doc, /<script|<link|@import|url\(/);
});

test('a colour from the page cannot close the rule it is written into', () => {
  const braces = (s: string): number => (s.match(/[{}]/g) ?? []).length;
  const hostile = htmlDocument({ ...input, colours: { ...PAPER, bg: 'red; } body { display: none' } });
  // The same rules as with a plain colour: what was left of the value is one declaration the engine drops.
  assert.equal(braces(hostile), braces(htmlDocument(input)));
  assert.doesNotMatch(hostile, /;\s*\}\s*body\s*\{/);
});

test('a page for paper names its size; notes in the margin are asides it styles', () => {
  assert.match(htmlDocument({ ...input, paper: 'Letter' }), /@page \{ size: letter; margin: 18mm; \}/);
  assert.match(htmlDocument({ ...input, paper: 'A4' }), /@page \{ size: A4;/);
  assert.doesNotMatch(htmlDocument(input), /@page/);
  assert.match(htmlDocument(input), /aside \{/);
});

test('the name keeps its stem', () => {
  assert.equal(exportName('pg16-upgrade-plan.md', 'html'), 'pg16-upgrade-plan.html');
  assert.equal(exportName('NOTES', 'txt'), 'NOTES.txt');
  assert.equal(exportName('.env', 'txt'), '.env.txt');
});
