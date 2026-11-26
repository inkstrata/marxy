// The outline is the heading list a later dialog will render.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Heading, Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { OUTLINE_MAX, outlineFrom, outlineOf } from './outline.ts';
import { outlineFrom as exported } from '../index.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const outlineDir = new URL('./', import.meta.url);

function astHeadings(node: Node): Heading[] {
  const found: Heading[] = node.type === 'heading' ? [node] : [];
  for (const child of node.children ?? []) found.push(...astHeadings(child));
  return found;
}

function imports(text: string): string[] {
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"\n]*from\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

function sourceFiles(directory: URL, prefix = ''): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...sourceFiles(new URL(`${entry.name}/`, directory), `${name}/`));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    files.push({ path: name, text: readFileSync(new URL(entry.name, directory), 'utf8') });
  }
  return files;
}

for (const name of ['01-long-technical.md', '09-gfm-everything.md']) {
  test(`outlineFrom matches every AST heading in ${name}, same order, level and src`, () => {
    const source = readFileSync(new URL(name, corpus), 'utf8');
    const document = parseMarkdown(source, { file: name });
    const outline = outlineFrom(document);
    const headings = astHeadings(document);
    assert.equal(outline.length, headings.length, `${name} heading count`);
    for (const [index, heading] of headings.entries()) {
      const entry = outline[index]!;
      assert.equal(entry.level, heading.level, `${name}[${index}] level`);
      assert.equal(entry.src.start, heading.src.start, `${name}[${index}] src.start`);
      assert.equal(entry.src.end, heading.src.end, `${name}[${index}] src.end`);
    }
  });
}

test('math in a heading keeps its TeX source, undelimited', () => {
  const texts = (source: string) => outlineFrom(parseMarkdown(source, { file: '/t.md' })).map((e) => e.text);
  assert.deepEqual(texts('# Euler $E=mc^2$\n'), ['Euler E=mc^2']);
  assert.deepEqual(texts('# $x$\n'), ['x']);
});

test('emphasis, strong and inline code markers are stripped from entry.text', () => {
  const source = '# A *em* **bold** and `code` heading\n';
  const document = parseMarkdown(source, { file: 'markers.md' });
  const [entry] = outlineFrom(document);
  assert.ok(entry);
  assert.equal(entry.text, 'A em bold and code heading');
  assert.doesNotMatch(entry.text, /\*|`/);
});

test('a heading nested in a blockquote is included, document order', () => {
  const source = '> # Nested\n\n# After\n';
  const document = parseMarkdown(source, { file: 'quote.md' });
  const outline = outlineFrom(document);
  assert.deepEqual(
    outline.map((entry) => entry.text),
    ['Nested', 'After'],
  );
  const headings = astHeadings(document);
  assert.equal(headings[0]?.src.start, outline[0]?.src.start);
  assert.equal(headings[1]?.src.start, outline[1]?.src.start);
});

test('200,000 headings in one quote: every one in order, no RangeError; capped at OUTLINE_MAX only when asked', () => {
  const document = parseMarkdown(`---\ntitle: T\n---\n${'> ## h\n'.repeat(199_999)}> # last\n`, { file: 'many.md' });
  const all = outlineFrom(document);
  assert.equal(all.length, 200_000, 'the h1 means no front-matter title');
  assert.equal(all[199_999]!.text, 'last');
  assert.ok(all.every((entry, i) => i === 0 || entry.src.start > all[i - 1]!.src.start));
  assert.equal(outlineOf(document).capped, false);
  const outline = outlineOf(document, OUTLINE_MAX);
  assert.equal(outline.capped, true);
  assert.equal(outline.entries.length, OUTLINE_MAX, 'an h1 past the cap still means no front-matter title');
  assert.deepEqual(outline.entries, all.slice(0, OUTLINE_MAX));
  const under = outlineOf(parseMarkdown('> # a\n> ## b\n\n# c\n', { file: 'few.md' }));
  assert.equal(under.capped, false);
  assert.deepEqual(under.entries.map((entry) => entry.text), ['a', 'b', 'c']);
});

test('frontmatter title: prepends as level 1 when there is no h1', () => {
  const source = '---\ntitle: Hello\n---\n\n## Section\n';
  const document = parseMarkdown(source, { file: 'fm.md' });
  const matter = document.children.find((child) => child.type === 'frontmatter');
  assert.ok(matter);
  const outline = outlineFrom(document);
  assert.equal(outline[0]?.level, 1);
  assert.equal(outline[0]?.text, 'Hello');
  assert.equal(outline[0]?.src.start, matter.src.start);
  assert.equal(outline[0]?.src.end, matter.src.end);
  assert.equal(outline[1]?.text, 'Section');
});

test('frontmatter title: is absent when an h1 exists', () => {
  const source = '---\ntitle: Hello\n---\n\n# Real\n';
  const document = parseMarkdown(source, { file: 'fm-h1.md' });
  const outline = outlineFrom(document);
  assert.deepEqual(
    outline.map((entry) => entry.text),
    ['Real'],
  );
});

test('quoted frontmatter title drops matching wraps', () => {
  const source = '---\ntitle: "Quoted title"\n---\n';
  const document = parseMarkdown(source, { file: 'fm-quoted.md' });
  assert.equal(outlineFrom(document)[0]?.text, 'Quoted title');
});

test('empty document and no headings with no frontmatter title return []', () => {
  assert.deepEqual(outlineFrom(parseMarkdown('', { file: 'empty.md' })), []);
  assert.deepEqual(outlineFrom(parseMarkdown('A paragraph.\n\n- just a list\n', { file: 'none.md' })), []);
  assert.deepEqual(outlineFrom(parseMarkdown('---\nauthor: x\n---\n\nparagraph\n', { file: 'fm-no-title.md' })), []);
});

test('a bare heading still occupies a row with empty text', () => {
  const outline = outlineFrom(parseMarkdown('#\n', { file: 'bare.md' }));
  assert.equal(outline.length, 1);
  assert.equal(outline[0]?.text, '');
  assert.equal(outline[0]?.level, 1);
});

test('packages/core/src/index.ts exports outlineFrom', () => {
  assert.equal(exported, outlineFrom);
});

test('no file under packages/core/src/outline imports apps/desktop or packages/shell-api', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(outlineDir)) {
    for (const specifier of imports(file.text)) {
      if (
        specifier.includes('apps/desktop') ||
        specifier.includes('packages/shell-api') ||
        specifier.includes('@marxy/desktop') ||
        specifier.includes('@tauri-apps')
      ) {
        offenders.push(`${file.path} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('TOML front matter title prepends like YAML when there is no h1', () => {
  const source = '+++\ntitle = "From TOML"\n+++\n\n## Section\n';
  const document = parseMarkdown(source, { file: 'toml.md' });
  const matter = document.children.find((child) => child.type === 'frontmatter');
  assert.ok(matter);
  const outline = outlineFrom(document);
  assert.equal(outline[0]?.text, 'From TOML');
  assert.equal(outline[0]?.src.start, matter.src.start);
  assert.equal(outline[1]?.text, 'Section');
});

test('frontmatter title: an empty or block-scalar title gives no entry, never the next key', () => {
  for (const source of ['---\ntitle:\nauthor: Jane\n---\n\n## S\n', '---\ntitle: |\n  Long\n---\n\n## S\n']) {
    const outline = outlineFrom(parseMarkdown(source, { file: 'fm.md' }));
    assert.deepEqual(outline.map((entry) => entry.text), ['S']);
  }
});
