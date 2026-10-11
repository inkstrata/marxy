// F-26: `ol start` and `li value` take a signed small integer and nothing else.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeHtml } from './sanitize-html.ts';

const ol = (start: string) => sanitizeHtml(`<ol start="${start}"><li>x</li></ol>`).html;
const li = (value: string) => sanitizeHtml(`<ol><li value="${value}">x</li></ol>`).html;

test('a negative start survives, as does a plain one', () => {
  assert.equal(ol('-3'), '<ol start="-3"><li>x</li></ol>');
  assert.equal(ol('7'), '<ol start="7"><li>x</li></ol>');
  assert.equal(ol('-999999999'), '<ol start="-999999999"><li>x</li></ol>');
});

test('a list item keeps a signed value', () => {
  assert.equal(li('10'), '<ol><li value="10">x</li></ol>');
  assert.equal(li('-4'), '<ol><li value="-4">x</li></ol>');
  assert.equal(li('0'), '<ol><li value="0">x</li></ol>');
  assert.equal(li('-0'), '<ol><li value="-0">x</li></ol>');
});

test('value is still only for li, and td colspan stays unsigned', () => {
  assert.equal(sanitizeHtml('<p value="3">x</p>').html, '<p>x</p>');
  assert.match(sanitizeHtml('<table><tr><td colspan="2">x</td></tr></table>').html, /colspan="2"/);
  assert.doesNotMatch(sanitizeHtml('<table><tr><td colspan="-2">x</td></tr></table>').html, /colspan/);
});

test('whitespace around the number is trimmed by the policy and never reaches the output', () => {
  for (const padded of [' 3', '3 ', '\t3', '3\n', ' -3 ']) {
    const n = padded.trim();
    assert.equal(ol(padded), `<ol start="${n}"><li>x</li></ol>`, JSON.stringify(padded));
    assert.equal(li(padded), `<ol><li value="${n}">x</li></ol>`, JSON.stringify(padded));
  }
});

const REFUSED: Array<[string, string]> = [
  ['exponent', '1e3'],
  ['unit', '10px'],
  ['double sign', '--1'],
  ['leading plus', '+3'],
  ['plus then minus', '+-3'],
  ['minus then plus', '-+3'],
  ['sign alone', '-'],
  ['empty', ''],
  ['expression', 'calc(1+2)'],
  ['var', 'var(--x)'],
  ['decimal', '1.5'],
  ['hex', '0x10'],
  ['20 digits', '12345678901234567890'],
  ['ten digits', '1234567890'],
  ['negative 20 digits', '-12345678901234567890'],
  ['inner space', '- 3'],
  ['Arabic-Indic digits', '٣'],
  ['fullwidth digits', '３'],
  ['U+2212 minus', '−3'],
  ['en dash', '–3'],
  ['trailing minus', '3-'],
  ['two numbers', '1 2'],
];

for (const [name, value] of REFUSED) {
  test(`a ${name} is dropped from both start and value`, () => {
    assert.equal(ol(value), '<ol><li>x</li></ol>', `start=${JSON.stringify(value)}`);
    assert.equal(li(value), '<ol><li>x</li></ol>', `value=${JSON.stringify(value)}`);
  });
}

test('an entity-encoded minus decodes first: &minus; and &#8722; are U+2212 and go, &#45; is ASCII and stays', () => {
  assert.equal(ol('&minus;3'), '<ol><li>x</li></ol>');
  assert.equal(ol('&#8722;3'), '<ol><li>x</li></ol>');
  assert.equal(li('&#x2212;3'), '<ol><li>x</li></ol>');
  assert.equal(ol('&#45;3'), '<ol start="-3"><li>x</li></ol>');
  assert.equal(li('&#x2d;3'), '<ol><li value="-3">x</li></ol>');
  // a decoded sign cannot be doubled into a refusal's disguise
  assert.equal(ol('&#45;&#45;3'), '<ol><li>x</li></ol>');
  assert.equal(ol('&#43;3'), '<ol><li>x</li></ol>');
});
