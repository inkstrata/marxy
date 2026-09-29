// Acceptance checks for parse-time Shiki highlighting over the grammar allow-list (MARXY-27).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, LANGUAGE_TO_GRAMMAR, plainTextFromTokens, type HighlightToken } from './index.ts';

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

test('code blocks use pre-wrap and a hanging indent in base.css', () => {
  const run = spawnSync(process.execPath, ['scripts/allowlists/gate-code-block-layout.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
});

// MARXY-337: the cost of Shiki's JS regex engine is not linear in line length, so lines and blocks are capped.
test('an over-long line is left plain and does not stall its neighbours, in every language', async () => {
  for (const lang of ['bash', 'shellscript', 'ts', 'json']) {
    const long = 'echo ' + '"a b" '.repeat(9000);
    const code = `echo one\n${long}\necho three`;
    const start = performance.now();
    const lines = await highlight(code, lang);
    const ms = performance.now() - start;
    assert.ok(lines, lang);
    assert.equal(lines.length, 3, lang);
    assert.deepEqual(lines[1], [{ text: long }], lang);
    assert.equal(plainTextFromTokens(lines), code, lang);
    assert.ok(ms < 5000, `${lang} took ${ms.toFixed(0)} ms`);
  }
  const around = await highlight('echo "one"\n' + 'x'.repeat(3000) + '\necho "three"', 'bash');
  assert.ok(around![0]!.some((t) => t.scope), 'the line before is still highlighted');
  assert.ok(around![2]!.some((t) => t.scope), 'the line after is still highlighted');
});

test('a block over 200 KB is returned as plain lines', async () => {
  const code = 'const x = 1;\n'.repeat(20000);
  assert.ok(code.length > 200_000);
  const lines = await highlight(code, 'ts');
  assert.equal(lines!.length, 20001);
  assert.ok(lines!.every((line) => line.every((t) => t.scope === undefined)));
  assert.equal(plainTextFromTokens(lines!), code);
});

test('the one-line bash case from the repro finishes quickly', async () => {
  const start = performance.now();
  await highlight('a'.repeat(50000), 'bash');
  assert.ok(performance.now() - start < 3000);
});
