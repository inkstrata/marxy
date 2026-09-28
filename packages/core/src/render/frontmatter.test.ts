// Front matter renders as a quiet key/value head with provenance and copy fidelity (MARXY-234).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { FRONTMATTER_HEAD_MAX_ROWS, frontmatterRows } from './frontmatter.ts';
import { renderSafeHtml } from './pipeline.ts';

const decode = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder().decode(bytes.slice(start, end));

test('YAML front matter lists every key, truncates at twelve rows, and carries provenance', () => {
  const keys = Array.from({ length: 15 }, (_, i) => `key${i + 1}: v${i + 1}`).join('\n');
  const source = `---\n${keys}\n---\n\n# Title\n`;
  const bytes = new TextEncoder().encode(source);
  const document = parseMarkdown(bytes, { file: 'skill.md' });
  const matter = document.children.find((child) => child.type === 'frontmatter');
  assert.ok(matter);
  assert.equal(frontmatterRows(matter.value).length, 15);
  const { html } = renderSafeHtml(bytes, { file: 'skill.md' });
  assert.match(html, /<dl data-marxy-s="/);
  assert.equal([...html.matchAll(/<dt>/g)].length, FRONTMATTER_HEAD_MAX_ROWS);
  assert.match(html, /<dd>3 more<\/dd>/);
  const range = html.match(/<dl data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"/);
  assert.ok(range);
  assert.equal(decode(bytes, Number(range[1]), Number(range[2])), source.slice(0, source.indexOf('\n\n# Title')));
});

test('TOML front matter uses the same head shape', () => {
  const source = '+++\ntitle = "Skill"\nlicense = "MIT"\n+++\n\nBody\n';
  const bytes = new TextEncoder().encode(source);
  const { html } = renderSafeHtml(bytes, { file: 'skill.toml.md' });
  assert.match(html, /<dt>title<\/dt>/);
  assert.match(html, /<dd>"Skill"<\/dd>/);
  assert.match(html, /<dt>license<\/dt>/);
  const matter = parseMarkdown(bytes, { file: 'skill.toml.md' }).children.find((c) => c.type === 'frontmatter');
  assert.ok(matter);
  const range = html.match(/data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"/);
  assert.ok(range);
  assert.equal(decode(bytes, Number(range[1]), Number(range[2])), source.slice(0, source.indexOf('\n\nBody')));
});

test('corpus skill fixture: description is visible and overflow counts three keys', () => {
  const file = new URL('../../../../fixtures/corpus/26-skill-front-matter.md', import.meta.url);
  const bytes = readFileSync(file);
  const { html } = renderSafeHtml(bytes, { file: '26-skill-front-matter.md' });
  assert.match(html, /<dd>/);
  assert.ok(html.includes('a'.repeat(64)));
  assert.match(html, /3 more/);
});
