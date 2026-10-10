// promote-heading / demote-heading (E-07): the table rows run in LF, CRLF, CR, no trailing newline and BOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Heading, Node } from '../contracts/ast.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { demoteHeading, promoteHeading } from './heading-level.ts';
import { corpusProperties, tableTest, type Row } from './testing/test-kit.ts';

function headings(n: Node, out: Heading[] = []): Heading[] {
  if (n.type === 'heading') out.push(n as Heading);
  for (const c of n.children ?? []) headings(c as Node, out);
  return out;
}
const nth = (i: number) => (doc: Document): Node => headings(doc)[i]!;
const section = (doc: Document, node: Node) => sectionRange(doc, node as Heading);

const row = (name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => ({
  name, source, expect, pick: nth(at), range: section, ...(summary ? { summary } : {}),
});

tableTest(promoteHeading, [
  row('h2 with two h3 children', '# A\n\n## B\n\ntext\n\n### C\n\n### D\n\n## E\n', '# A\n\n# B\n\ntext\n\n## C\n\n## D\n\n## E\n', 1),
  row('the last section of a file', '# A\n\n## B\n\n### C\n', '# A\n\n# B\n\n## C\n', 1),
  row('a closing run stays', '# A\n\n## Close me ##\n', '# A\n\n# Close me ##\n', 1),
  row('a heading inside a blockquote', '> ## Q\n> text\n', '> # Q\n> text\n'),
  row('leading spaces before the run', '# A\n\n   ## B\n', '# A\n\n   # B\n', 1),
  row('an h1 refuses', '# A\n\ntext\n', '# A\n\ntext\n', 0, /already level 1/),
  row('a sub-heading at h1 would not fit: refuses', '# A\n\n## B\n', '# A\n\n## B\n', 0, /already level 1/),
  row('a sub-heading is promoted with its parent', '## A\n\n### B\n', '# A\n\n## B\n'),
  row('a setext heading refuses (underline ending kept)', 'Title\n=====\n\ntext\n', 'Title\n=====\n\ntext\n', 0, /setext/),
  row('a # comment in a fence is left alone', '## A\n\n```sh\n# comment\n```\n\n### B\n', '# A\n\n```sh\n# comment\n```\n\n## B\n'),
  row('a heading in a list item', '- ### L\n', '- ## L\n'),
]);

tableTest(demoteHeading, [
  row('h2 with two h3 children', '## B\n\ntext\n\n### C\n\n### D\n\n## E\n', '### B\n\ntext\n\n#### C\n\n#### D\n\n## E\n'),
  row('the last section of a file', '# A\n\n## B\n\n### C\n', '# A\n\n### B\n\n#### C\n', 1),
  row('a closing run stays', '## Close me ##\n', '### Close me ##\n'),
  row('a heading inside a blockquote', '> # Q\n> text\n', '> ## Q\n> text\n'),
  row('leading spaces before the run', '  # A\n', '  ## A\n'),
  row('an h6 refuses', '###### A\n', '###### A\n', 0, /already level 6/),
  row('a sub-heading at h6 refuses the whole section', '##### A\n\n###### B\n', '##### A\n\n###### B\n', 0, /already level 6/),
  row('a setext heading refuses', 'Title\n-----\n', 'Title\n-----\n', 0, /setext/),
  row('a setext sub-heading refuses the whole section', '# A\n\nSub\n---\n', '# A\n\nSub\n---\n', 0, /setext/),
  row('a # comment in a fence is left alone', '# A\n\n```\n# not a heading\n```\n', '## A\n\n```\n# not a heading\n```\n'),
]);

test('canApply: a heading whose range is the section start only; never a document or a paragraph', () => {
  const doc = parseDoc('# A\n\ntext\n');
  const h = headings(doc)[0]!;
  assert.equal(promoteHeading.canApply({ document: doc, node: h, range: h.src }), true);
  assert.equal(demoteHeading.canApply({ document: doc, node: h, range: { ...h.src, start: h.src.start + 1 } }), false);
  assert.equal(demoteHeading.canApply({ document: doc, node: doc, range: doc.src }), false);
  assert.equal(demoteHeading.canApply({ document: doc, range: h.src }), false);
  assert.deepEqual(promoteHeading.appliesTo, ['section']);
});

import { parseMarkdown } from '../parse/parse.ts';
function parseDoc(s: string): Document {
  return parseMarkdown(s, { file: 't.md' });
}

const runs = (_doc: Document, node: Node) => [{ file: node.src.file, start: node.src.start, end: node.src.start + (node as Heading).level }];

// `inverse` is only meaningful where the operation applied and changed something, so the sweep accepts the ATX headings
// that are not at the bound. An ATX heading's first child starts after its `#` run; a setext heading's text starts at its own start.
const isAtx = (h: Heading): boolean => h.children.length === 0 || h.children[0]!.src.start > h.src.start;

test('corpus: promote is a minimal diff on the # runs and demote undoes it', () => {
  const accepts = (n: Node) => n.type === 'heading' && (n as Heading).level > 1 && isAtx(n as Heading);
  const stats = corpusProperties(promoteHeading, { targets: runs, accepts, inverse: demoteHeading, sample: 2 });
  assert.ok(stats.applied > 0);
});

test('corpus: demote is a minimal diff on the # runs and promote undoes it', () => {
  const accepts = (n: Node) => n.type === 'heading' && (n as Heading).level < 6 && isAtx(n as Heading);
  const stats = corpusProperties(demoteHeading, { targets: runs, accepts, inverse: promoteHeading, sample: 2 });
  assert.ok(stats.applied > 0);
});

test('corpus: a refusal (h1 promote, h6 demote, setext) changes no byte', () => {
  // The kit counts only accepted nodes; a refusing run must return the input unchanged, which assertMinimalDiff with no targets checks.
  corpusProperties(promoteHeading, { targets: (_d, n) => ((n as Heading).level === 1 || !isAtx(n as Heading) ? [] : runs(_d, n)), accepts: (n) => n.type === 'heading' });
});
