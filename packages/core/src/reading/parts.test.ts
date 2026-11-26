import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { namesPart, partReading, partsOf, readingOfPart } from './parts.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const page = (text: string) => {
  const bytes = enc(text);
  return { bytes, parts: partsOf(parseMarkdown(bytes), bytes) };
};

/** Every `data-marxy-s`/`data-marxy-e` pair in `html`, as the bytes of the file it names. */
function spans(html: string, bytes: Uint8Array): string[] {
  const dec = new TextDecoder();
  return [...html.matchAll(/data-marxy-s="(\d+)" data-marxy-e="(\d+)"/g)].map((m) => dec.decode(bytes.subarray(Number(m[1]), Number(m[2]))));
}

const HANDOFF = [
  '# Handoff',
  '',
  'Picking this up.',
  '',
  '```',
  '$ go test ./auth/... -run Session',
  'ok   example.com/api/auth  1.84s',
  '$ curl -si localhost:8080/v1/refresh | head -5',
  'HTTP/1.1 200 OK',
  '```',
  '',
  'Done.',
  '',
].join('\n');

test('a fence that names no language and opens with a prompt is a session, guessed from its text, by its lines', () => {
  const { parts } = page(HANDOFF);
  assert.equal(parts.length, 1);
  const [p] = parts;
  assert.equal(p!.guess, 'session');
  assert.equal(p!.from, 'text');
  assert.deepEqual([p!.firstLine, p!.lastLine], [5, 10]);
  assert.deepEqual(p!.ways, ['session', 'written']);
  assert.match(p!.reasons[0]!, /^Lines 6 and 8 begin with a prompt/);
  assert.equal(namesPart(p!, p!.guess), true);
});

test('a JSON fence reads as a data tree, every range at the bytes of the file, past multi-byte text above it', () => {
  const text = ['# Réponse — “quoted”', '', '```json', '{"name": "marxy", "tags": ["été", "x"], "n": 3}', '```', ''].join('\n');
  const { bytes, parts } = page(text);
  const [p] = parts;
  assert.equal(p!.guess, 'data');
  assert.equal(p!.from, 'fence');
  const r = partReading(p!, bytes)!;
  assert.equal(r.id, 'tree');
  const named = spans(r.html, bytes);
  assert.ok(named.length >= 3);
  for (const s of named) assert.ok(text.includes(s) && s.length > 0, `a range names bytes of the fence: ${JSON.stringify(s)}`);
  assert.ok(named.some((s) => s.includes('"été"')), 'the multi-byte value is named exactly');
  for (const m of r.html.matchAll(/data-marxy-s="(\d+)"/g)) assert.ok(Number(m[1]) >= p!.contentStart && Number(m[1]) <= p!.contentEnd);
  // A key's row goes to where its value starts, as in a file read as data.
  const rest = (byte: number): string => new TextDecoder().decode(bytes.subarray(byte, p!.contentEnd));
  assert.deepEqual(r.contents?.items.map((i) => i.text), ['name', 'tags', 'n']);
  assert.deepEqual(r.contents?.items.map((i) => [rest(i.byte).startsWith('"marxy"'), rest(i.byte).startsWith('["été"'), rest(i.byte).startsWith('3}')]), [[true, false, false], [false, true, false], [false, false, true]]);
});

test('YAML, TOML, CSV and JSON Lines fences read as their formats do; a CSV is a table', () => {
  const text = [
    '```yaml', 'name: ci', 'on: [push]', '```', '',
    '```toml', '[server]', 'port = 8080', '```', '',
    '```csv', 'day,p95', '2026-10-01,120', '2026-10-02,118', '```', '',
    '```jsonl', '{"a": 1}', '{"a": 2}', '```', '',
  ].join('\n');
  const { bytes, parts } = page(text);
  assert.deepEqual(parts.map((p) => p.guess), ['data', 'data', 'table', 'data']);
  assert.deepEqual(parts.map((p) => partReading(p, bytes)?.id), ['tree', 'tree', 'table', 'records']);
  const csv = partReading(parts[2]!, bytes)!;
  assert.deepEqual(spans(csv.html, bytes).slice(0, 3), ['day,p95\n2026-10-01,120\n2026-10-02,118', 'day', 'p95']);
});

test('a data fence that does not read is set as written, and says where in the file', () => {
  const { parts } = page(['Intro.', '', '```json', '{"a": 1,', ' "b" 2}', '```', ''].join('\n'));
  const [p] = parts;
  assert.equal(p!.guess, 'written');
  assert.deepEqual(p!.ways, ['written']);
  assert.match(p!.note ?? '', /^JSON that does not read at line 5, /);
  assert.equal(namesPart(p!, p!.guess), true);
});

test('a data fence inside a list item keeps its fence: its bytes hold the indentation too', () => {
  const { parts } = page(['- Set it:', '', '   ```json', '   {"a": 1}', '   ```', ''].join('\n'));
  assert.equal(parts[0]!.guess, 'written');
  assert.equal(parts[0]!.note, null);
});

test('what a fence says decides: console is a session, diff a patch, log a log, sh a session only with a prompt, code is code', () => {
  const text = [
    '```console', '$ ls', 'a b', '```', '',
    '```diff', '-a', '+b', '```', '',
    '```log', '2026-10-14 12:02:11 INFO up', '```', '',
    '```sh', 'make all', '```', '',
    '```bash', '$ make all', 'ok', '```', '',
    '```python', 'print(1)', '```', '',
  ].join('\n');
  const { parts } = page(text);
  assert.deepEqual(parts.map((p) => p.guess), ['session', 'patch', 'log', 'written', 'session', 'written']);
  assert.ok(parts.every((p) => p.from === 'fence'));
  const python = parts[5]!;
  assert.equal(namesPart(python, python.guess), false, 'a code fence as its fence says is not named');
  assert.deepEqual(python.ways, ['written']);
});

test('a mermaid fence is a diagram, drawn in the page, and may be read as written instead', () => {
  const { parts } = page(['```mermaid', 'flowchart LR', '  A --> B', '```', ''].join('\n'));
  const [p] = parts;
  assert.equal(p!.guess, 'diagram');
  assert.equal(p!.from, 'fence');
  assert.deepEqual(p!.ways, ['diagram', 'written']);
  assert.equal(readingOfPart(p!, 'written'), 'written');
});

test('a fence that names no language: a patch, a log or JSON by what is in it; else as written, still guessed', () => {
  const text = [
    '```', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b', '```', '',
    '```', '2026-10-14T12:02:11Z INFO started', '2026-10-14T12:02:12Z WARN slow', '```', '',
    '```', '{"ok": true}', '```', '',
    '```text', 'just some words', '```', '',
  ].join('\n');
  const { parts } = page(text);
  assert.deepEqual(parts.map((p) => [p.guess, p.from]), [['patch', 'text'], ['log', 'text'], ['data', 'text'], ['written', 'text']]);
  assert.equal(namesPart(parts[3]!, 'written'), true);
});

test('a choice holds only when it is one of the part’s ways; twin parts have keys of their own', () => {
  const { parts } = page(['```', '$ ls', 'a', '```', '', '```', '$ ls', 'a', '```', ''].join('\n'));
  assert.notEqual(parts[0]!.key, parts[1]!.key);
  assert.equal(readingOfPart(parts[0]!, 'written'), 'written');
  assert.equal(readingOfPart(parts[0]!, 'data'), 'session');
  assert.equal(readingOfPart(parts[0]!, undefined), 'session');
  assert.equal(namesPart(parts[0]!, 'written'), true, 'a part chosen otherwise is named');
});

test('the pieces of a code file are not parts', async () => {
  const { parseCode } = await import('../parse/code.ts');
  const bytes = enc('{"a": 1}\n');
  assert.deepEqual(partsOf(parseCode(bytes, { lang: 'json' }), bytes), []);
});
