// Acceptance checks for parse-time Shiki highlighting over the grammar allow-list (MARXY-27).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFF_LINE_ADD,
  DIFF_LINE_DEL,
  LOG_LEVEL_CLASS,
  highlight,
  lineMetaForHighlight,
  LANGUAGE_TO_GRAMMAR,
  plainTextFromTokens,
  type HighlightToken,
} from './index.ts';

const root = join(import.meta.dirname, '../../../..');
const allowlist = JSON.parse(readFileSync(join(root, 'scripts/allowlists/shiki-languages.json'), 'utf8')) as {
  languages: readonly { id: string; grammar: string }[];
  aliases: Readonly<Record<string, string>>;
};

test('LANGUAGE_TO_GRAMMAR matches shiki-languages.json', () => {
  const expected: Record<string, string> = Object.fromEntries(allowlist.languages.map(({ id, grammar }) => [id, grammar]));
  for (const [alias, id] of Object.entries(allowlist.aliases)) expected[alias] = expected[id]!;
  assert.deepEqual(LANGUAGE_TO_GRAMMAR, expected);
});

test('the fence ids READMEs actually use are highlighted: ts, js, sh, py, rs, yml (ADR-0033)', async () => {
  for (const [id, sample] of [['ts', 'const x: number = 1;'], ['js', 'const x = 1;'], ['sh', 'echo "hi"'], ['py', 'x = "hi"'], ['rs', 'let x = "hi";'], ['yml', 'key: "value"']]) {
    const tokens = await highlight(sample!, id!);
    assert.ok(tokens?.some((line) => line.some((t) => t.scope)), `${id} returned no scoped tokens`);
  }
});

const SAMPLES: Record<string, string> = {
  bash: 'echo hello',
  shellscript: 'echo hello',
  c: 'int main() { return 0; }',
  cpp: 'int main() { return 0; }',
  css: 'body { color: red; }',
  diff: '+added line',
  dockerfile: 'FROM node:24',
  go: 'package main',
  html: '<p>hi</p>',
  ini: '[section]',
  java: 'class Main {}',
  javascript: 'const x = 1;',
  json: '{"a":1}',
  jsonc: '{"a":1}',
  kotlin: 'fun main() {}',
  markdown: '# Title',
  python: 'print(1)',
  rust: 'fn main() {}',
  sql: 'SELECT 1',
  swift: 'print("hi")',
  toml: 'key = "value"',
  typescript: 'const x: number = 1;',
  tsx: 'export const App = () => <p />;',
  yaml: 'key: value',
  xml: '<root/>',
  jsonl: '{"a":1}',
  log: '2026-09-25T10:00:02Z ERROR db',
  shellsession: '$ ls',
};

test('every allow-listed language id produces highlight tokens for a one-line sample', async () => {
  for (const { id } of allowlist.languages) {
    const sample = SAMPLES[id];
    assert.ok(sample, `missing sample for ${id}`);
    const tokens = await highlight(sample, id);
    assert.ok(tokens && tokens.length > 0, `${id} returned no tokens`);
    assert.ok(tokens.some((line) => line.some((t) => t.scope)), `${id} returned no scoped tokens`);
  }
});

test('unknown and plaintext language ids return null', async () => {
  assert.equal(await highlight('x', ''), null);
  assert.equal(await highlight('x', 'plaintext'), null);
  assert.equal(await highlight('x', 'text'), null);
  assert.equal(await highlight('x', 'fortran'), null);
});

test('plainTextFromTokens concatenates runs without markup', () => {
  const lines: HighlightToken[][] = [
    [
      { text: 'const ', scope: 'keyword' },
      { text: 'x', scope: 'variable' },
      { text: ' = 1;', scope: undefined },
    ],
  ];
  assert.equal(plainTextFromTokens(lines), 'const x = 1;');
  assert.doesNotMatch(plainTextFromTokens(lines), /marxy-tok/);
});

test('highlighting every fenced block in 03-ai-plan.md stays under 30 ms', async () => {
  const source = readFileSync(join(root, 'fixtures/corpus/03-ai-plan.md'), 'utf8');
  const blocks: { lang: string; code: string }[] = [];
  const fence = /^```(\w*)\n([\s\S]*?)^```/gm;
  for (const match of source.matchAll(fence)) {
    const lang = match[1] || 'plaintext';
    blocks.push({ lang, code: match[2].replace(/\n$/, '') });
  }
  assert.ok(blocks.length > 0, 'expected fenced blocks in 03-ai-plan.md');
  // Grammars load once per session, lazily, as separate chunks; the budget is for tokenising a
  // document. Since the fence aliases (ADR-0033) the plan's `sh` block loads a third grammar.
  for (const { lang, code } of blocks) await highlight(code, lang);
  const start = performance.now();
  for (const { lang, code } of blocks) {
    await highlight(code, lang);
  }
  const ms = performance.now() - start;
  assert.ok(ms < 30, `highlight pass took ${ms.toFixed(1)} ms (budget 30 ms)`);
});

test('forbidden grammars are absent from highlight sources and bundle gate passes', () => {
  const run = spawnSync(process.execPath, ['scripts/allowlists/gate-highlight-bundle.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
});

test('MARXY-235: diff lines carry marxy-diff-add and marxy-diff-del; headers and no-newline stay plain', async () => {
  const sample = [
    '@@ -1,2 +1,2 @@',
    ' context',
    '+added',
    '-removed',
    '+++ b/file',
    '--- a/file',
    '\\ No newline at end of file',
  ].join('\n');
  const lines = await highlight(sample, 'diff');
  assert.ok(lines);
  const meta = lineMetaForHighlight('diff', lines);
  const text = (i: number) => lines[i]!.map((t) => t.text).join('');
  assert.equal(meta[2]?.lineClass, DIFF_LINE_ADD);
  assert.equal(meta[3]?.lineClass, DIFF_LINE_DEL);
  assert.equal(meta[0]?.lineClass, undefined);
  assert.equal(meta[4]?.lineClass, undefined);
  assert.equal(meta[5]?.lineClass, undefined);
  assert.equal(meta[6]?.lineClass, undefined);
  assert.equal(text(2), '+added');
  assert.equal(text(3), '-removed');
});

test('MARXY-235: console fence classes $ as punctuation and leaves output unclassed', async () => {
  const lines = await highlight('$ ls\nhello\n', 'console');
  assert.ok(lines);
  const prompt = lines[0]!;
  assert.equal(prompt.find((t) => t.text === '$')?.scope, 'punctuation');
  assert.ok(prompt.every((t) => t.text === '$' || !t.scope));
  assert.ok(lines[1]!.every((t) => !t.scope && !t.className));
});

test('MARXY-235: log fence puts the level word in marxy-log-level without a token hue', async () => {
  const lines = await highlight('2026-09-25T10:00:02Z ERROR db timeout\n', 'log');
  assert.ok(lines);
  const level = lines[0]!.find((t) => t.text === 'ERROR');
  assert.ok(level);
  assert.equal(level.className, LOG_LEVEL_CLASS);
  assert.equal(level.scope, undefined);
});

test('code blocks use pre-wrap and a hanging indent in base.css', () => {
  const run = spawnSync(process.execPath, ['scripts/allowlists/gate-code-block-layout.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
});
