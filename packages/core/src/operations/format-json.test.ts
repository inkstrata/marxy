// format-json (E-10): table rows in LF, CRLF, CR, no trailing newline and BOM; the corpus; token fidelity; refusals; properties.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodeBlock, Document, Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { formatJson, formatJsonText } from './format-json.ts';
import { corpusDocuments } from './testing/corpus.ts';
import { corpusProperties, tableTest, type Row } from './testing/test-kit.ts';
import { sliceByBytes } from './text-helpers.ts';

function all(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) all(c as Node, out);
  return out;
}
const fenceAt = (i: number) => (doc: Document): Node => all(doc).filter((n) => n.type === 'codeBlock')[i]!;
const row = (name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => ({
  name, source, expect, pick: fenceAt(at), ...(summary ? { summary } : {}),
});
const fence = (body: string): string => `\`\`\`json\n${body}\`\`\`\n`;
const REFUSED = /Not formatted: not strict JSON near line \d+/;

tableTest(
  formatJson,
  [
    row('nested objects and arrays', fence('{"a":{"b":[1,2,{"c":null}]},"d":true}\n'), fence('{\n  "a": {\n    "b": [\n      1,\n      2,\n      {\n        "c": null\n      }\n    ]\n  },\n  "d": true\n}\n')),
    row('numbers are copied byte for byte', fence('[1e10,-0,1.0,1234567890123456789012345,0.10,-1E+2]\n'), fence('[\n  1e10,\n  -0,\n  1.0,\n  1234567890123456789012345,\n  0.10,\n  -1E+2\n]\n')),
    row('strings: accents, escaped quotes, CJK and \\u escapes stay', fence(String.raw`{"é":"caf\u00e9 \"q\" \\ \/","日本語":"漢字🙂"}` + '\n'), fence('{\n  ' + String.raw`"é": "caf\u00e9 \"q\" \\ \/"` + ',\n  "日本語": "漢字🙂"\n}\n')),
    row('keys keep their order, duplicates stay', fence('{"b":1,"a":2,"b":3}\n'), fence('{\n  "b": 1,\n  "a": 2,\n  "b": 3\n}\n')),
    row('empty containers stay {} and []', fence('{"a":{},"b":[ ],"c":{ \n}}\n'), fence('{\n  "a": {},\n  "b": [],\n  "c": {}\n}\n')),
    row('a trailing comma is kept (the LLM answer)', fence('{\n"queue": "q",\n"n": 3,\n}\n'), fence('{\n  "queue": "q",\n  "n": 3,\n}\n')),
    row('a trailing comma in an array', fence('[1,2,]\n'), fence('[\n  1,\n  2,\n]\n')),
    row('a top-level scalar', fence('  "x"  \n'), fence('"x"\n')),
    row('already pretty: no change', fence('{\n  "a": [\n    1\n  ]\n}\n'), fence('{\n  "a": [\n    1\n  ]\n}\n'), 0),
    row('minified', fence('[{"a":1},{"a":2}]\n'), fence('[\n  {\n    "a": 1\n  },\n  {\n    "a": 2\n  }\n]\n')),
    row('a tilde fence and a longer backtick fence', '~~~json\n{"a":1}\n~~~\n\n````JSON\n[]\n````\n', '~~~json\n{\n  "a": 1\n}\n~~~\n\n````JSON\n[]\n````\n'),
    row('an unclosed fence keeps its missing final newline', '```json\n{"a":1}', '```json\n{\n  "a": 1\n}'),
    row('text around the fence is untouched', 'Intro  \n\n' + fence('{"a":1}\n') + '\n  after  \n', 'Intro  \n\n' + fence('{\n  "a": 1\n}\n') + '\n  after  \n'),
    row('blank lines after the value are dropped, the final ending stays', fence('{"a":1}\n\n\n'), fence('{\n  "a": 1\n}\n')),
    row('an empty fence declines', fence(''), fence(''), 0, REFUSED),
    row('a comment declines', fence('{\n"a": 1 // one\n}\n'), fence('{\n"a": 1 // one\n}\n'), 0, /near line 2/),
    row('single quotes decline', fence("{'a': 1}\n"), fence("{'a': 1}\n"), 0, /near line 1/),
    row('unquoted keys decline', fence('{a: 1}\n'), fence('{a: 1}\n'), 0, REFUSED),
    row('two top-level values decline', fence('{"a":1}\n{"b":2}\n'), fence('{"a":1}\n{"b":2}\n'), 0, /near line 2/),
    row('an unclosed container declines', fence('{"a":[1,2}\n'), fence('{"a":[1,2}\n'), 0, REFUSED),
    row('a leading zero declines', fence('[01]\n'), fence('[01]\n'), 0, REFUSED),
    row('a raw newline in a string declines', fence('{"a":"x\ny"}\n'), fence('{"a":"x\ny"}\n'), 0, REFUSED),
    row('a bad escape declines', fence('["\\x"]\n'), fence('["\\x"]\n'), 0, REFUSED),
    row('a leading comma declines', fence('[,1]\n'), fence('[,1]\n'), 0, REFUSED),
    row('a doubled comma declines', fence('[1,,2]\n'), fence('[1,,2]\n'), 0, REFUSED),
    row('a trailing comma after a key declines', fence('{"a":}\n'), fence('{"a":}\n'), 0, REFUSED),
    row('a yaml fence is not offered', '```yaml\na: 1\n```\n', '```yaml\na: 1\n```\n'),
    row('a fence with no language is not offered', '```\n{"a":1}\n```\n', '```\n{"a":1}\n```\n'),
    row('an indented fence is not offered', '  ```json\n  {"a":1}\n  ```\n', '  ```json\n  {"a":1}\n  ```\n'),
    row('a fence in a list item is not offered', '- item\n\n  ```json\n  {"a":1}\n  ```\n', '- item\n\n  ```json\n  {"a":1}\n  ```\n'),
    row('a fence in a blockquote is not offered', '> ```json\n> {"a":1}\n> ```\n', '> ```json\n> {"a":1}\n> ```\n'),
    row('the second fence of two', fence('{"a":1}\n') + '\n' + fence('[1]\n'), fence('{"a":1}\n') + '\n' + fence('[\n  1\n]\n'), 1),
  ],
  { bom: true },
);

test('a mixed-separator body: the output uses the first line ending of the content and keeps the final one', () => {
  const source = '```json\n{"a":\n1}\r\n```\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const f = doc.children[0] as CodeBlock;
  const out = formatJson.run({ document: doc, node: f, range: f.src, text: source.slice(f.src.start, f.src.end) });
  assert.equal(out.replacement, '```json\n{\n  "a": 1\n}\r\n```');
});

test('canApply: a json fence at the top level, at its own range; not a document, a missing node or a part range', () => {
  const doc = parseMarkdown('```json\n{}\n```\n', { file: 't.md' });
  const f = doc.children[0]!;
  assert.equal(formatJson.canApply({ document: doc, node: f, range: f.src }), true);
  assert.equal(formatJson.canApply({ document: doc, node: f, range: { ...f.src, start: f.src.start + 1 } }), false);
  assert.equal(formatJson.canApply({ document: doc, node: doc, range: doc.src }), false);
  assert.equal(formatJson.canApply({ document: doc, range: f.src }), false);
  assert.deepEqual(formatJson.appliesTo, ['block']);
});

test('formatJsonText: eol is used for every break; null for what is not JSON; deep nesting does not overflow', () => {
  assert.equal(formatJsonText('[1,[2]]', '\r\n'), '[\r\n  1,\r\n  [\r\n    2\r\n  ]\r\n]');
  assert.equal(formatJsonText('', '\n'), null);
  assert.equal(formatJsonText('   ', '\n'), null);
  assert.equal(formatJsonText('/* c */ 1', '\n'), null);
  assert.equal(formatJsonText('NaN', '\n'), null);
  assert.equal(formatJsonText('[1] x', '\n'), null);
  assert.equal(formatJsonText('\u00a0[1]', '\n'), null);
  const depth = 3_000;
  const deep = formatJsonText('['.repeat(depth) + ']'.repeat(depth), '\n');
  assert.ok(deep && deep.split('\n').length === depth * 2 - 1);
  const long = formatJsonText(`["${'x'.repeat(2_000_000)}"]`, '\n');
  assert.ok(long && long.length > 2_000_000);
});

/** The JSON tokens of `s`, whitespace outside strings dropped: a scan independent of the formatter. */
function tokens(s: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/gs;
  for (const m of s.matchAll(re)) out.push(m[0]);
  return out;
}

const jsonFences = () => {
  const found: { file: string; body: string; node: CodeBlock }[] = [];
  for (const { file, bytes, document } of corpusDocuments()) {
    for (const n of all(document)) {
      if (n.type !== 'codeBlock' || (n as CodeBlock).lang?.toLowerCase() !== 'json') continue;
      const body = sliceByBytes({ range: document.src, text: new TextDecoder().decode(bytes) }, (n as CodeBlock).content);
      found.push({ file, body, node: n as CodeBlock });
    }
  }
  return found;
};

test('corpus: formatJsonText is idempotent over every json fence and keeps the token sequence', () => {
  const fences = jsonFences();
  assert.ok(fences.length >= 20);
  let formatted = 0;
  for (const { file, body, node } of fences) {
    const once = formatJsonText(body, '\n');
    if (once === null) continue;
    formatted++;
    assert.equal(formatJsonText(once, '\n'), once, `${file}@${node.src.start}: not idempotent`);
    assert.deepEqual(tokens(once), tokens(body), `${file}@${node.src.start}: tokens changed`);
  }
  assert.ok(formatted > 0);
});

test('corpus: the trailing comma of 28-llm-answer.md is formatted and kept', () => {
  const f = jsonFences().find((x) => x.file === '28-llm-answer.md')!;
  assert.equal(
    formatJsonText(f.body, '\n'),
    '{\n  "queue": "invoice-export",\n  "visibilityTimeoutSeconds": 900,\n  "maxReceiveCount": 3,\n  "deadLetterQueue": "invoice-export-dlq",\n  "retentionDays": 14,\n}',
  );
});

test('corpus: format-json changes only the content span, in every separator variant, and is idempotent', () => {
  const stats = corpusProperties(formatJson, {
    targets: (_d, n) => [(n as CodeBlock).content],
    accepts: (n) => n.type === 'codeBlock',
    idempotent: true,
  });
  assert.ok(stats.applied > 0);
});

test('the property can fail: a replacement that also rewrites the fence line is caught', async () => {
  const { assertMinimalDiff, canFail } = await import('./testing/test-kit.ts');
  const before = new TextEncoder().encode('```json\n{"a":1}\n```\n');
  canFail(() => assertMinimalDiff(before, { start: 0, end: before.length - 1 }, '```JSON\n{\n  "a": 1\n}\n```', [{ start: 8, end: 16 }]));
});
