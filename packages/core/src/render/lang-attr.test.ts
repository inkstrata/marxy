// A code block's `<pre>` carries `data-marxy-lang`, the registry's id, so a theme's language scope meets a fence
// and a file of one language alike; a raw HTML block cannot claim one.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCode } from '../parse/code.ts';
import { checkInvariants } from '../parse/invariants.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { renderDocumentSafeHtml } from './pipeline.ts';

const html = (md: string): string => renderDocumentSafeHtml(parseMarkdown(new TextEncoder().encode(md))).html;
const langs = (out: string): (string | null)[] => [...out.matchAll(/<pre\b([^>]*)>/g)].map((m) => /data-marxy-lang="([^"]*)"/.exec(m[1]!)?.[1] ?? null);

test('a fence carries the registry id for its word', () => {
  assert.deepEqual(langs(html('```rs\nfn a() {}\n```\n\n```Rust\nx\n```\n\n```bash\nls\n```\n\n```cs\nx\n```\n\n```mermaid\na\n```\n')), ['rust', 'rust', 'shellscript', 'csharp', 'mermaid']);
});

test('a braced fence (Quarto, R Markdown, Pandoc) carries the language inside its brace; its info is kept as written', () => {
  const md = '```{r}\nx\n```\n\n```{r setup, include=FALSE}\nx\n```\n\n```{python}\nx\n```\n\n```{.python .numberLines}\nx\n```\n\n```{=html}\nx\n```\n\n```{}\nx\n```\n';
  const out = html(md);
  assert.deepEqual(langs(out), ['r', 'r', 'python', 'python', 'html', null]);
  assert.deepEqual([...out.matchAll(/<pre class="language-([^"]*)"/g)].map((m) => m[1]), ['r', 'r', 'python', 'python', 'html']);
  const blocks = parseMarkdown(new TextEncoder().encode(md)).children.map((b) => (b.type === 'codeBlock' ? [b.lang ?? null, b.info ?? null] : null));
  assert.deepEqual(blocks, [['r', '{r}'], ['r', '{r setup, include=FALSE}'], ['python', '{python}'], ['python', '{.python .numberLines}'], ['html', '{=html}'], [null, '{}']]);
});

test('a .qmd body parses as a .md one: front matter, a {r} cell, a ::: div and a shortcode, with no invariant broken', () => {
  const src = '---\ntitle: "Report"\nformat: html\n---\n\n# Intro\n\n```{r setup, include=FALSE}\nlibrary(x)\n```\n\n::: {.callout-note}\nA note.\n:::\n\n{{< video https://example.com/a.mp4 >}}\n';
  const bytes = new TextEncoder().encode(src);
  const qmd = parseMarkdown(bytes, { file: '/r/report.qmd' });
  assert.deepEqual(checkInvariants(qmd, bytes), []);
  assert.deepEqual(qmd.children.map((b) => b.type), ['frontmatter', 'heading', 'codeBlock', 'paragraph', 'paragraph']);
  assert.deepEqual(qmd.children.map((b) => b.type), parseMarkdown(bytes, { file: '/r/report.md' }).children.map((b) => b.type));
  const out = renderDocumentSafeHtml(qmd).html;
  assert.match(out, /<dt data-marxy-fm-key="title">title<\/dt>/, 'front matter is the head, as for .md');
  // No callouts or shortcodes yet: the div's fence lines and the shortcode are text in their paragraphs.
  assert.match(out, /<p [^>]*>::: \{\.callout-note\}\nA note\.\n:::<\/p>/);
  assert.match(out, /<p [^>]*>\{\{&lt; video <a [^>]*>https:\/\/example\.com\/a\.mp4<\/a> &gt;\}\}<\/p>/);
});

test('a fence with no language, or one that is not one token, carries none', () => {
  assert.deepEqual(langs(html('```\nplain\n```\n')), [null]);
  assert.deepEqual(langs(html('```a&#32;marxy-run\nx\n```\n')), [null]);
});

test('a code file\'s pieces carry the id its file is coloured in', () => {
  const doc = parseCode(new TextEncoder().encode('fn a() {}\n'), { file: '/r/a.rs', lang: 'rust' });
  assert.deepEqual(langs(renderDocumentSafeHtml(doc).html), ['rust']);
});

test('a raw HTML block cannot claim a language scope', () => {
  const out = html('<pre data-marxy-lang="rust">x</pre>\n');
  assert.doesNotMatch(out, /data-marxy-lang/);
});
