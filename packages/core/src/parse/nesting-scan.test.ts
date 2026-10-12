// The text scan that answers a source nested past doubt without parsing it (F-54): when it says yes the document
// really is deeper than the cap, and a document that is not deep renders exactly as it did before the scan existed.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from './math-syntax.ts';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import type { Block, Document } from '../contracts/ast.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { checkInvariants } from './invariants.ts';
import { MAX_NESTING_DEPTH, nestedTooDeepText } from './from-mdast.ts';
import { SCAN_MARKERS, opensWithTooManyMarkers } from './nesting-scan.ts';
import { parseMarkdown } from './parse.ts';

const N = SCAN_MARKERS + 44; // 300: past the scan's bound
const quotes = '> '.repeat(N);
const bare = '>'.repeat(N);
const bullets = '- '.repeat(N);
const stars = '* '.repeat(N);

/** The deepest run of block quotes and lists in micromark's own tree: the exact count, whatever the scan says. */
function treeDepth(text: string): number {
  let deepest = 0;
  const stack: [{ type: string; children?: unknown[] }, number][] = [[fromMarkdown(text, { extensions: [frontmatter(), math()], mdastExtensions: [frontmatterFromMarkdown(), mathFromMarkdown()] }), 0]];
  // An explicit stack: these trees are deeper than a recursive walk is safe for.
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    const here = node.type === 'blockquote' || node.type === 'list' ? depth + 1 : depth;
    deepest = Math.max(deepest, here);
    for (const child of node.children ?? []) stack.push([child as { type: string; children?: unknown[] }, here]);
  }
  return deepest;
}

/** Documents of at most a level or two whose text holds a line of 300 markers where no marker opens a container. */
const notDeep: readonly [string, string, Block['type']][] = [
  ['a backtick fence', `\`\`\`\n${bare}\n\`\`\`\n`, 'codeBlock'],
  ['a backtick fence of bullets', `\`\`\`\n${bullets}\n\`\`\`\n`, 'codeBlock'],
  ['a tilde fence with an info string', `~~~text\n${quotes}\n~~~\n`, 'codeBlock'],
  ['a diff fence of plus markers', `\`\`\`diff\n${'+ '.repeat(N)}\n\`\`\`\n`, 'codeBlock'],
  ['a fence in a list item', `- item\n\n  \`\`\`\n  ${bare}\n  \`\`\`\n`, 'list'],
  ['a fence in a quote', `> \`\`\`\n> ${bare}\n> \`\`\`\n`, 'blockquote'],
  ['a fence left open to the end', `\`\`\`\n${bare}\n`, 'codeBlock'],
  ['indented code', `    ${bare}\n`, 'codeBlock'],
  ['indented code in a list item', `-     ${bare}\n`, 'list'],
  ['a pre block', `<pre>\n${bare}\n\n${bare}\n</pre>\n`, 'htmlBlock'],
  ['a div block', `<div>\n${bare}\n</div>\n`, 'htmlBlock'],
  ['an HTML comment with blank lines', `<!--\n\n${bare}\n\n-->\n`, 'htmlBlock'],
  ['a math block', `$$\n${bare}\n$$\n`, 'mathBlock'],
  ['frontmatter holding a folded line', `---\ntitle: >\n  x\nnote: ${bare}\n${bare}\n---\n\ntext\n`, 'frontmatter'],
  ['a thematic break in a list item', `- ${stars}\n`, 'list'],
  ['a thematic break in a quote', `> ${'- '.repeat(N)}\n`, 'blockquote'],
  ['a starred thematic break in a quote', `> ${stars}\n`, 'blockquote'],
  ['a thematic break in an ordered item', `1. ${'- '.repeat(N)}\n`, 'list'],
  ['a thematic break of bare dashes', `${'-'.repeat(N)}\n`, 'thematicBreak'],
  ['a thematic break of spaced stars', `${stars}\n`, 'thematicBreak'],
  ['an ordered marker that cannot interrupt a paragraph', `text\n${'2. '.repeat(N)}\n`, 'paragraph'],
  ['a fence in a quote that a plain fence line does not close', `> \`\`\`\n\`\`\`\n${'1. - '.repeat(150)}\n\`\`\`\n`, 'blockquote'],
  ['ordered items numbered 2 after a paragraph', `text\n1. ${'2. '.repeat(N)}\n`, 'paragraph'],
  ['exactly the bound in a fence', `\`\`\`\n${'> '.repeat(SCAN_MARKERS + 1)}\n\`\`\`\n`, 'codeBlock'],
];

for (const [name, source, firstBlock] of notDeep) {
  test(`${name} holding ${N} markers is not nested too deep and renders as markup`, () => {
    assert.equal(opensWithTooManyMarkers(source), false);
    const document = parseMarkdown(source, { file: 'x.md' });
    assert.equal(nestedTooDeepText(document), undefined);
    assert.equal(document.children[0]?.type, firstBlock);
    const result = renderSafeHtml(source, { file: 'x.md' });
    assert.equal(result.removed.filter((r) => r.what === 'structure').length, 0);
    assert.doesNotMatch(result.html, /^<pre data-marxy-s="0" data-marxy-e="\d+">(?!<code)/);
    assert.ok(treeDepth(source) <= MAX_NESTING_DEPTH, `the tree is ${treeDepth(source)} deep`);
  });
}

/** Sources the scan calls deep: the tree must agree. */
const deep: readonly [string, string][] = [
  ['bare quotes', `${bare}word\n`],
  ['spaced quotes', `${quotes}word\n`],
  ['bullets', `${bullets}word\n`],
  ['stars with text', `${stars}word\n`],
  ['ordered items', `${'1. '.repeat(N)}word\n`],
  ['a mix of quotes and bullets', `${'> - '.repeat(N / 2)}word\n`],
  ['a tower after a closed fence', `\`\`\`\nx\n\`\`\`\n\n${quotes}word\n`],
  ['a tower after a closed pre block', `<pre>\nx\n</pre>\n\n${quotes}word\n`],
  ['a tower after frontmatter', `---\na: b\n---\n\n${quotes}word\n`],
  ['a tower in a fence-opening line', `${quotes}\`\`\`\n`],
  ['a tower after a thematic break', `* * *\n${bullets}word\n`],
];

for (const [name, source] of deep) {
  test(`${name}: the scan says deep, and the parsed tree is deeper than the cap`, () => {
    assert.equal(opensWithTooManyMarkers(source), true);
    assert.ok(treeDepth(source) > MAX_NESTING_DEPTH, `the tree is only ${treeDepth(source)} deep`);
    assert.notEqual(nestedTooDeepText(parseMarkdown(source)), undefined);
  });
}

test('a source with the markers just under the bound is left to the tree', () => {
  assert.equal(opensWithTooManyMarkers(`${'> '.repeat(SCAN_MARKERS)}word\n`), false);
  assert.equal(opensWithTooManyMarkers(`${'> '.repeat(SCAN_MARKERS + 1)}word\n`), true);
  // Between the cap and the bound the tree decides, and finds it deep.
  assert.notEqual(nestedTooDeepText(parseMarkdown(`${'> '.repeat(MAX_NESTING_DEPTH + 1)}word\n`)), undefined);
});

test('the scan reads CR and CRLF line endings as lines', () => {
  for (const eol of ['\r\n', '\r']) {
    assert.equal(opensWithTooManyMarkers(`\`\`\`${eol}${bare}${eol}\`\`\`${eol}`), false);
    assert.equal(opensWithTooManyMarkers(`text${eol}${bare}word${eol}`), true);
  }
});

test('the document nested too deep to typeset satisfies every AST invariant, however its lines end', () => {
  for (const [eol, bom] of [['\n', ''], ['\r\n', ''], ['\r', ''], ['', ''], ['\n', '﻿'], ['\n\n', '']] as const) {
    const source = `${bom}${'> '.repeat(MAX_NESTING_DEPTH + 1)}word${eol}`;
    const bytes = new TextEncoder().encode(source);
    const document: Document = parseMarkdown(bytes, { file: 'deep.md' });
    assert.notEqual(nestedTooDeepText(document), undefined);
    assert.deepEqual(checkInvariants(document, bytes), [], JSON.stringify(eol));
  }
  // And a deep document that begins like a fence, which a code block's own content check would take for one.
  const fenced = new TextEncoder().encode(`${'> '.repeat(MAX_NESTING_DEPTH + 1)}\`\`\`\n`);
  assert.deepEqual(checkInvariants(parseMarkdown(fenced), fenced), []);
});
