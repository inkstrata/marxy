// MARXY-96: the wide allow-list matches §12 and shares the default policy's network boundary.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeHtml } from './sanitize-html.ts';
import { DEFAULT_POLICY, WIDE_POLICY } from './policy.ts';

test('WIDE_POLICY.urlSchemes is the same object as DEFAULT_POLICY.urlSchemes', () => {
  assert.equal(WIDE_POLICY.urlSchemes, DEFAULT_POLICY.urlSchemes);
});

test('details and summary are elements under wide, transparent under default', () => {
  const html = '<details open><summary>More</summary><p>body</p></details>';
  assert.match(sanitizeHtml(html, WIDE_POLICY).html, /<details/);
  assert.match(sanitizeHtml(html, WIDE_POLICY).html, /<summary/);
  assert.doesNotMatch(sanitizeHtml(html, DEFAULT_POLICY).html, /<details/);
});

test('div with align is an element under wide, transparent under default', () => {
  const html = '<div align="center"><h1>Title</h1></div>';
  assert.match(sanitizeHtml(html, WIDE_POLICY).html, /<div align="center">/);
  assert.doesNotMatch(sanitizeHtml(html, DEFAULT_POLICY).html, /<div/);
  assert.match(sanitizeHtml(html, DEFAULT_POLICY).html, /<h1>Title<\/h1>/);
});

test('p and headings may carry align under wide only', () => {
  for (const tag of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    const html = `<${tag} align="center">x</${tag}>`;
    assert.match(sanitizeHtml(html, WIDE_POLICY).html, new RegExp(`<${tag} align="center">`));
    assert.doesNotMatch(sanitizeHtml(html, DEFAULT_POLICY).html, /align=/);
  }
});

test('img width, height and align are admitted under wide only', () => {
  const html = '<img src="local.png" alt="a" width="120" height="40%" align="right" />';
  const wide = sanitizeHtml(html, WIDE_POLICY).html;
  assert.match(wide, /width="120"/);
  assert.match(wide, /height="40%"/);
  assert.match(wide, /align="right"/);
  const narrow = sanitizeHtml(html, DEFAULT_POLICY).html;
  assert.doesNotMatch(narrow, /width=/);
  assert.doesNotMatch(narrow, /height=/);
  assert.doesNotMatch(narrow, /align=/);
});

test('picture stays transparent and source stays absent under wide', () => {
  const html = '<picture><source srcset="https://example.invalid/a.png"><img src="local.png" alt="a"></picture>';
  const wide = sanitizeHtml(html, WIDE_POLICY).html;
  assert.doesNotMatch(wide, /<picture/);
  assert.doesNotMatch(wide, /<source/);
  assert.match(wide, /src="local.png"/);
});
