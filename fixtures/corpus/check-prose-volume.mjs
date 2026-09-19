#!/usr/bin/env node
// Asserts the MARXY-64 prose fixture has the volume and shape the story asked for,
// and that fixtures/corpus/README.md records a licence the tree can ship.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const fixtureName = '15-prose-volume.md';
const source = readFileSync(join(dir, fixtureName), 'utf8');
const readme = readFileSync(join(dir, 'README.md'), 'utf8');

assert.doesNotMatch(source, /```|~~~/, `${fixtureName} must not contain a code fence`);
assert.doesNotMatch(source, /^\s*\|/m, `${fixtureName} must not contain a table row`);
assert.match(source, /—/, `${fixtureName} must contain an em dash`);
assert.match(source, /"/, `${fixtureName} must contain a quotation`);
assert.match(source, /\[\^[^\]]+\]/, `${fixtureName} must contain a footnote-style aside`);

const words = source.trim().split(/\s+/).filter(Boolean);
assert.ok(words.length >= 5000, `${fixtureName} is ${words.length} words; need at least 5000`);

/** Same drop-rules as packages/typeset/scripts/rag-model.mjs extractParagraphs, kept here
 * because that script is outside this story's paths. A drift would fail the length checks. */
function extractParagraphs(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
    current = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*>\s?/, '');
    if (
      line.trim() === '' ||
      /^\s{0,3}#{1,6}\s/.test(line) ||
      /^\s{0,3}</.test(line) ||
      /^\s{0,3}\[[^\]]+\]:\s/.test(line)
    ) {
      flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return paragraphs.filter((p) => p.length > 0);
}

const paragraphs = extractParagraphs(source);
const lengths = paragraphs.map((p) => p.split(/\s+/).length);
assert.ok(paragraphs.length >= 30, `${fixtureName} has ${paragraphs.length} paragraphs; need varied volume`);
assert.ok(Math.min(...lengths) < 40, `shortest paragraph is ${Math.min(...lengths)} words; need a short one`);
assert.ok(Math.max(...lengths) > 150, `longest paragraph is ${Math.max(...lengths)} words; need a long one`);

assert.match(readme, /15-prose-volume\.md/, 'README.md must name the prose fixture');
assert.match(readme, /\b(MIT|CC0|public domain)\b/i, 'README.md must record a licence the tree can ship');
assert.doesNotMatch(readme + source, /CC-BY-SA-4\.0 spec/i, 'must not vendor CC-BY-SA spec examples');

console.log(
  `prose-volume check ok: ${fixtureName} is ${words.length} words in ${paragraphs.length} paragraphs ` +
    `(shortest ${Math.min(...lengths)}, longest ${Math.max(...lengths)}); provenance in README.md`,
);
