// Punycode labels as a hostile link writes them: the RFC 3492 vectors still decode, and a label no resolver would take
// is shown as written, at once.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hostnameToUnicode, punycodeDecode } from './punycode.ts';

const LABEL_MAX = 63;

process.noDeprecation = true;
const { encode } = await import('node:punycode');

test('RFC 3492 sample strings decode as before', () => {
  const vectors: [string, string][] = [
    ['egbpdaj6bu4bxfgehfvwxn', 'ليهمابتكلموشعربي؟'],
    ['b1abfaaepdrnnbgefbadotcwatmq2g4l', 'почемужеонинеговорятпорусски'],
    ['PorqunopuedensimplementehablarenEspaol-fmd56a', 'PorquénopuedensimplementehablarenEspañol'],
    ['3B-ww4c5e180e575a65lsy2b', '3年B組金八先生'],
    ['bcher-kva', 'bücher'],
    ['pple-43d', 'аpple'],
  ];
  for (const [label, unicode] of vectors) assert.equal(punycodeDecode(label), unicode, label);
  assert.equal(hostnameToUnicode('www.xn--bcher-kva.example'), 'www.bücher.example');
});

test('a label past 63 octets is shown as written, without decoding it', () => {
  // Each code point lower than the last makes the decoder insert at the front: quadratic in the label's length.
  let text = '';
  for (let cp = 0x4e00 + 20_000; cp > 0x4e00; cp--) text += String.fromCodePoint(cp);
  const host = `xn--${encode(text)}.example`;
  const t0 = performance.now();
  const shown = hostnameToUnicode(host);
  const ms = performance.now() - t0;
  assert.equal(shown, host);
  assert.ok(ms < 50, `a hostile label took ${ms.toFixed(0)} ms`);
  const longest = `xn--${'a'.repeat(LABEL_MAX - 5)}-`;
  assert.equal(hostnameToUnicode(longest), 'a'.repeat(LABEL_MAX - 5));
  assert.equal(hostnameToUnicode(`${longest}a`), `${longest}a`);
});

test('a label whose deltas overflow is refused as damage, not decoded', () => {
  for (const label of ['99999999999a', 'a-99999999999b', '9'.repeat(40) + 'a']) {
    assert.throws(() => punycodeDecode(label), /^Error: bad punycode$/, label);
    assert.equal(hostnameToUnicode(`xn--${label}.example`), `xn--${label}.example`);
  }
  // Below '0' is no digit: `!` once read as 11, and `a-!a` decoded to "a\u0085".
  assert.throws(() => punycodeDecode('a-!a'), /^Error: bad punycode$/);
  assert.equal(hostnameToUnicode('xn--a-!a.example'), 'xn--a-!a.example');
});
