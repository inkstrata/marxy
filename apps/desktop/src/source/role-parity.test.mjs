// One tokenizer for both modes, so a token is one role in Read and in Source, in every
// language. Read's roles are the token lines its spans are built from; Source's are the marks its colour lays from the
// worker's runs, read a piece at a time. Every grammar on the allow-list is held to it, with the role at each character
// compared, and the constructs named (where Lezer and Shiki once disagreed) now agree with no gaps left.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EditorState, RangeSet } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlight } from '@marxy/core/src/highlight/grammar.ts';
import { GRAMMAR_SAMPLES, POLYGLOT_SAMPLE } from '@marxy/core/src/highlight/grammar-samples.ts';
import { ROLES } from '@marxy/core/src/highlight/roles.ts';
import { runsFromTokens } from '@marxy/core/src/highlight/runs.ts';
import { langOfFence } from '@marxy/core/src/kind/registry.ts';
import { readRoles, rolesOfMarks, sourceRoles } from '../../test/support/source-roles.mjs';
import { fenceBodies, marksFromRuns } from './colour.ts';
import { languageExtension } from './language.ts';
import { lezerTag } from './highlight-style.ts';

const allowlist = JSON.parse(readFileSync(new URL('../../../../scripts/allowlists/shiki-languages.json', import.meta.url), 'utf8'));

/** One language id per grammar on the allow-list, the one the list names first. */
function idPerGrammar() {
  const ids = new Map();
  for (const { id, grammar } of allowlist.languages) if (!ids.has(grammar)) ids.set(grammar, id);
  return [...ids.values()];
}

test('D1 role-parity: in every language on the allow-list, each character has one role in Read and in Source', async () => {
  const ids = idPerGrammar();
  assert.ok(ids.length > 240, `${ids.length} grammars`);
  let coloured = 0;
  for (const id of ids) {
    const doc = GRAMMAR_SAMPLES[id] ?? POLYGLOT_SAMPLE;
    const [read, source] = [await readRoles(id, doc), await sourceRoles(id, doc)];
    assert.deepEqual(source, read, `${id}: Source and Read disagree`);
    if (read.some((r) => r !== null)) coloured++;
  }
  // A parity of two blank pages proves nothing: nearly every grammar colours something of its sample.
  assert.ok(coloured > ids.length * 0.9, `${coloured} of ${ids.length} grammars coloured their sample`);
});

test('D1 role-parity: a file read in several pieces keeps parity across their joins', async () => {
  const doc = `${GRAMMAR_SAMPLES.ruby}=begin\na block\ncomment\n=end\n`.repeat(600);
  // Several pieces in Source, one block (under its 200,000-character cap) in Read.
  assert.ok(doc.length > 60_000 && doc.length < 200_000, `${doc.length}`);
  assert.deepEqual(await sourceRoles('ruby', doc), await readRoles('ruby', doc));
});

// The constructs checked, each now the same role in both modes. Those with a `was` were a named gap between Lezer
// and Shiki when Source coloured with Lezer; the gap closed because both modes read Shiki.
const c = (label, needle, role, was) => ({ label, needle, role, was });
const CONSTRUCTS = {
  python: [
    c('keyword', 'class', 'keyword'), c('decorator name', 'decorator', 'decorator'), c('class definition', 'Foo', 'type'),
    c('def name', 'run', 'function'), c('escape', '\\n', 'escape'), c('comment', '# c', 'comment'),
    c('self', 'self', 'self', 'Lezer gave self no tag in Python'), c('builtin, called', 'print', 'builtin', 'Lezer could not tell a builtin from a call'),
    c('builtin, uncalled', 'int', 'builtin', 'Lezer had no list of Python builtins'),
  ],
  typescript: [
    c('decorator mark', '@', 'decorator'), c('keyword', 'class', 'keyword'), c('self (this)', 'this', 'self'), c('call', 'log', 'function'),
    c('escape', '\\n', 'escape'), c('constant', 'true', 'constant'), c('comment', '// c', 'comment'),
  ],
  rust: [
    c('keyword', 'struct', 'keyword'), c('fn name', 'main', 'function'), c('macro', 'println', 'function'),
    c('escape', '\\n', 'escape', 'the Lezer Rust grammar left an escape untagged'), c('self', 'self', 'self'),
    c('field', 'a;', null, 'Lezer called a field access a property; Shiki gives it no scope'),
  ],
  go: [
    c('keyword', 'func', 'keyword'), c('comment', '// c', 'comment'),
    c('method name', 'Run', 'function', 'lang-go tagged a method name as a property'),
    c('builtin type', 'int', 'builtin', 'Lezer had no list of Go predeclared types'),
    c('builtin call', 'len', 'builtin', 'Lezer could not tell a predeclared function from a call'),
    c('escape', '\\n', 'escape', 'the Lezer Go grammar did not split an escape out of a string'),
  ],
  shellscript: [c('keyword', 'if', 'keyword'), c('builtin', 'echo', 'builtin'), c('comment', '# c', 'comment')],
  ruby: [c('keyword', 'def', 'keyword'), c('string', '"hi', 'string'), c('comment', '# say', 'comment')],
};

for (const [lang, constructs] of Object.entries(CONSTRUCTS)) {
  test(`D1 role-parity: ${lang}'s named constructs take their role in both modes`, async () => {
    const doc = GRAMMAR_SAMPLES[lang];
    const [read, source] = [await readRoles(lang, doc), await sourceRoles(lang, doc)];
    for (const k of constructs) {
      const at = doc.indexOf(k.needle);
      assert.ok(at >= 0, `${k.needle} is not in the sample`);
      assert.equal(read[at], k.role, `${lang} ${k.label}: Read`);
      assert.equal(source[at], k.role, `${lang} ${k.label}: Source`);
    }
  });
}

test('D1 role-parity: a Markdown fence in Source takes the runs Read paints for that fence', async () => {
  const doc = '# T\n\n```ruby\ndef hi(name) # c\n  "hi"\nend\n```\n\n```ts\nconst a = 1; // c\n```\n\n```nope\nfunc b\n```\n\n> ```py\n> x = 1\n> ```\n';
  const { markdown } = await import('@codemirror/lang-markdown');
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 10_000);
  const fences = fenceBodies(state, [{ from: 0, to: doc.length }]);
  // The unknown fence and the quoted one are left plain, as Read leaves an unknown fence.
  assert.deepEqual(fences.map((f) => f.lang), ['ruby', 'typescript']);
  for (const fence of fences) {
    const text = state.doc.sliceString(fence.from, fence.to, '\n');
    const marks = RangeSet.of(marksFromRuns(runsFromTokens(await highlight(text, fence.lang)), fence.from, fence.to), true);
    const source = rolesOfMarks(marks, doc.length).slice(fence.from, fence.to);
    const open = doc.lastIndexOf('```', fence.from);
    const word = doc.slice(open + 3, doc.indexOf('\n', open));
    assert.equal(langOfFence(word), fence.lang);
    assert.deepEqual(source, await readRoles(word, text), `${word}: the fence's roles`);
  }
});

test('Lezer colours nothing in a code file; it stays for structure (folding) and Markdown', async () => {
  const ext = await languageExtension('a.ts', 10, undefined, async () => []);
  const state = EditorState.create({ doc: 'function f() {\n  return 1;\n}\n', extensions: [ext] });
  // The tree is there (folding reads it), and no highlighter is installed for it.
  assert.ok(ensureSyntaxTree(state, state.doc.length, 10_000)?.length > 0);
  const { highlightingFor } = await import('@codemirror/language');
  const { tags } = await import('@lezer/highlight');
  assert.equal(highlightingFor(state, [tags.keyword]), null);
});

test('in Markdown, Lezer colours the marks and leaves a fence\'s body to its runs', async () => {
  const doc = '# T\n\n```ruby\ndef hi\n```\n\nsome `code`\n';
  const ext = await languageExtension('a.md', doc.length);
  const state = EditorState.create({ doc, extensions: [ext] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000);
  const { highlightTree } = await import('@lezer/highlight');
  const { highlightingFor } = await import('@codemirror/language');
  const styled = [];
  highlightTree(tree, { style: (tags) => highlightingFor(state, tags) }, (from, to) => styled.push([from, to]));
  const styledAt = (needle) => styled.some(([from, to]) => from <= doc.indexOf(needle) && doc.indexOf(needle) < to);
  assert.ok(styledAt('T\n'), 'the heading keeps its Lezer style');
  assert.ok(styledAt('code`'), 'inline code keeps its Lezer style');
  assert.ok(!styledAt('def hi') && !styledAt('hi\n```'), `the fence body has no Lezer colour: ${JSON.stringify(styled)}`);
});

test('every Lezer tag in the role table is accepted (Markdown\'s marks still use them)', () => {
  for (const [role, spec] of Object.entries(ROLES)) for (const tag of spec.lezer) assert.ok(lezerTag(tag), `${role}: ${tag}`);
});
