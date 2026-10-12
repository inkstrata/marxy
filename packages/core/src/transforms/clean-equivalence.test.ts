// strip-emoji and strip-citations were rewritten for speed (W-21.2): neither parses a text it cannot change, and
// strip-citations makes one pass over the prose of the original text where it made two, the second over a text it had
// to parse again. The output must be the same bytes. This keeps the earlier bodies and compares, on the corpus and on
// fuzzed text with stray bytes (U+DC80 to U+DCFF), astral emoji and every marker the two transforms read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import { mapInline, mapProse } from './prose.ts';
import { runTransform } from './registry.ts';

const EMOJI =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?))*/gu;

const oldEmoji = (lf: string): string => mapInline(lf, (p) => p.replace(EMOJI, ''));

function oldCitations(lf: string): string {
  const defs = mapProse(lf, (p) => p.replace(/^\[\^[^\]\n]+\]:.*(?:\n[ \t]+\S.*)*\n?/gm, ''));
  const labels = new Set([...lf.matchAll(/^ {0,3}\[(\d+)\]:/gm)].map((m) => m[1]));
  return mapInline(defs, (p) =>
    p
      .replace(/[ \t]?\[(\d+)\](?![(:[])/g, (m, n: string) => (labels.has(n) ? m : ''))
      .replace(/[ \t]?【[^】\n]*】/g, '')
      .replace(/\[\^[^\]\n]+\](?!:)/g, ''),
  );
}

const lf = (s: string): string => s.replace(/\r\n?/g, '\n');

// A small seeded generator, so a failure names its seed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'word', ' ', ' ', '\n', '\n\n', '\n', '  ', '\t', '    ', 'é', '日本', '© ', '™', '1️⃣', '#️⃣', '2', '#', '*',
  '🚀', '👍🏽', '👨‍👩‍👧', '🇳🇿', '🇳', '😀', '\u{1F9D1}\u{200D}\u{1F4BB}', '\u{FE0F}', '\u{200D}', '\u{20E3}',
  '\u{DC80}', '\u{DCFF}', '\u{DCA5}', '\u{D83D}', '\u{DE80}',
  '[1]', '[2]', '[10]', '[1](http://a.example)', '[1][2]', '[1]: http://b.example', ' [1]: x', '[^n]', '[^n]:', '[^n]: note',
  '[^n]: note\n    more', '[^m]: other\n', '【3】', '【x y】', '【', '】', '[', ']', '(', ':',
  '`', '``', '`[1]`', '`🚀`', '```\n[1] 🚀\n```\n', '~~~\n[^n]: x\n~~~\n', '$$\n[1]\n$$\n', '---\n', '---\ntitle: [1] 🚀\n---\n',
  '\n\n', '[^a]: a\n[^b]: b\n', '\n[^n]: note\n\n', '\n\n[^n]: n [1] 🚀\n\n', '<!--\n', '-->', '<pre>\n', '</pre>\n', '- a\n\n', '- b\n', '  more\n', '\n\n  indented\n', '# [1] 🚀\n', '> [1]\n', '- [^n] 🚀\n', '    [1] code 🚀\n', '<!-- [1] 🚀 -->', '\\[1]', '[a](b)[1]',
];

function fuzz(seed: number): string {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 40);
  let out = '';
  for (let i = 0; i < n; i++) out += PIECES[Math.floor(r() * PIECES.length)];
  return out;
}

const equal = (id: string, old: (s: string) => string, text: string, label: string): void => {
  assert.equal(runTransform(id, text, { lang: 'sh' }), old(text), `${id} differs on ${label}: ${JSON.stringify(text)}`);
};

test('strip-emoji and strip-citations give the bytes they gave before, on the corpus', () => {
  for (const { file, bytes } of corpusDocuments()) {
    const text = lf(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^﻿/, ''));
    equal('strip-emoji', oldEmoji, text, file);
    equal('strip-citations', oldCitations, text, file);
  }
});

test('strip-emoji and strip-citations give the bytes they gave before, on fuzzed texts', () => {
  const seeds = Number(process.env.EQUIV_SEEDS ?? 3000);
  for (let seed = 1; seed <= seeds; seed++) {
    const text = fuzz(seed);
    equal('strip-emoji', oldEmoji, text, `seed ${seed}`);
    equal('strip-citations', oldCitations, text, `seed ${seed}`);
  }
});

test('strip-emoji and strip-citations give the bytes they gave before, on a large text', () => {
  const text = Array.from({ length: 300 }, (_, i) => fuzz(10_000 + i)).join('\n\n');
  equal('strip-emoji', oldEmoji, text, 'large');
  equal('strip-citations', oldCitations, text, 'large');
});
