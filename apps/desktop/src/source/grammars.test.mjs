// Source colours every language the registry gives a grammar, from the runs Read paints
// (Shiki's, read in the worker), with Lezer kept for structure where a package exists; and a file whose lines end in
// CRLF, CR or a mixture is coloured the same and leaves Source byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compartment, EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { langOf } from '@marxy/core/src/kind/registry.ts';
import { GRAMMAR_SAMPLES } from '@marxy/core/src/highlight/grammar-samples.ts';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { rolesOfMarks, sourceState } from '../../test/support/source-roles.mjs';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from './buffer-commit.ts';
import { runMarks } from './colour.ts';
import { attachLanguage, languageExtension } from './language.ts';

const enc = new TextEncoder();

/** Role of each character of the editor's text for the file at `path` with these bytes, as Source colours it. */
async function rolesOf(path, text) {
  const buffer = createBuffer(path, enc.encode(text));
  const doc = cmDocText(buffer);
  const state = await sourceState(langOf(path), doc, [EditorState.lineSeparator.of(lineSeparatorFor(buffer))]);
  return { doc: state.doc.toString(), roles: rolesOfMarks(state.field(runMarks), state.doc.length), buffer };
}
const at = (r, needle, nth = 1) => {
  let i = -1;
  for (let k = 0; k < nth; k++) i = r.doc.indexOf(needle, i + 1);
  return r.roles[i];
};

test('each language Source had a grammar for colours its keywords, strings, numbers and comments', async () => {
  const cases = [
    ['a.go', 'package main\nfunc f() int { return 1 } // c\nvar s = "x"\n', { func: 'keyword', '// c': 'comment', '"x"': 'string', 1: 'number' }],
    ['a.c', 'int main(void) { return 0; } // c\n', { return: 'keyword', '// c': 'comment', 0: 'number' }],
    ['a.cpp', 'class A { public: int b = 2; }; // c\n', { class: 'keyword', '// c': 'comment', 2: 'number' }],
    ['A.java', 'public class A { String s = "x"; } // c\n', { class: 'keyword', '// c': 'comment', '"x"': 'string' }],
    ['a.sh', 'if [ -n "$X" ]; then echo hi; fi # c\n', { if: 'keyword', '# c': 'comment', echo: 'builtin' }],
    ['a.toml', '[t]\nk = "v" # c\nn = 3\n', { '"v"': 'string', '# c': 'comment', 3: 'number' }],
  ];
  for (const [path, text, want] of cases) {
    const r = await rolesOf(path, text);
    for (const [needle, role] of Object.entries(want)) assert.equal(at(r, needle), role, `${path} ${needle}`);
  }
});

test('the languages no mode coloured, and C#, Zig, PowerShell and Terraform, colour in Source', async () => {
  const cases = [
    ['a.rb', 'ruby', 'def', 'keyword'], ['a.php', 'php', 'function', 'keyword'], ['a.lua', 'lua', 'local', 'keyword'],
    ['a.r', 'r', '# greet', 'comment'], ['a.ex', 'elixir', 'defmodule', 'keyword'], ['a.hs', 'haskell', '-- greet', 'comment'],
    ['a.vue', 'vue', '// greet', 'comment'], ['a.svelte', 'svelte', '// greet', 'comment'], ['a.scss', 'scss', '// greet', 'comment'],
    ['a.graphql', 'graphql', '# greet', 'comment'], ['Makefile', 'make', '# greet', 'comment'], ['a.cs', 'csharp', 'public', 'keyword'],
    ['a.zig', 'zig', 'const', 'keyword'], ['a.ps1', 'powershell', 'function', 'keyword'], ['main.tf', 'terraform', '# greet', 'comment'],
  ];
  for (const [path, sample, needle, role] of cases) {
    const r = await rolesOf(path, GRAMMAR_SAMPLES[sample]);
    assert.equal(at(r, needle), role, `${path} ${needle}`);
  }
});

// A mixed file keeps `\n` as CodeMirror's separator, so its CRLF lines keep a CR at the end of the line, which
// no grammar here lets into a token. A lone CR inside a mixed file is a character in a line, by that same rule.
test('LF, CRLF, CR and mixed (CRLF with LF) endings give the same colours and the same bytes', async () => {
  const lines = ['package main', 'func f() int { return 1 } // c', 'var s = "x"', ''];
  const variants = { lf: '\n', crlf: '\r\n', cr: '\r', mixed: null };
  for (const [name, sep] of Object.entries(variants)) {
    const text = sep ? lines.join(sep) : 'package main\r\nfunc f() int { return 1 } // c\nvar s = "x"\r\n';
    const r = await rolesOf('a.go', text);
    assert.equal(at(r, 'func'), 'keyword', name);
    assert.equal(at(r, '// c'), 'comment', name);
    assert.equal(at(r, '"x"'), 'string', name);
    assert.deepEqual(leaveSourceMode(r.buffer, cmDocText(r.buffer)).buffer.bytes, enc.encode(text), `${name}: bytes`);
  }
});

// A grammar that will not load leaves Source on screen; the text never waits for it.
const goBuffer = () => createBuffer('a.go', enc.encode('package main\nfunc f() {}\n'));
const lazyLoad = () => {
  let release, fail;
  const promise = new Promise((res, rej) => ((release = res), (fail = rej)));
  return { promise, release, fail };
};
/** A stand-in for the view: applies each dispatch to a state that holds the language compartment, as the editor does. */
function fakeEditor(buffer) {
  const comp = new Compartment();
  let state = EditorState.create({ doc: cmDocText(buffer), extensions: [comp.of([])] });
  return { comp, get state() { return state; }, view: { dispatch: (spec) => { state = state.update(spec).state; } } };
}
/** Lezer's structure is there (a tree folding can read); the colour is there (its marks field). */
const structured = (state) => syntaxTree(state).length > 0;
const coloured = (state) => state.field(runMarks, false) !== undefined;
const goLoaders = (loader) => ({ go: loader });

test('a structure loader that rejects leaves the text, does not throw, and keeps the colour', async () => {
  const buffer = goBuffer();
  const failing = goLoaders(async () => { throw new Error('chunk 404'); });
  assert.equal(await languageExtension('a.go', 10, failing, async () => { throw new Error('chunk 404'); }), null);
  const ed = fakeEditor(buffer);
  await attachLanguage(ed.view, buffer, () => true, ed.comp, failing);
  assert.equal(ed.state.doc.toString(), cmDocText(buffer));
  assert.equal(structured(ed.state), false);
  assert.equal(coloured(ed.state), true);
});

test('the language arrives later, when the loader resolves', async () => {
  const buffer = goBuffer();
  const ed = fakeEditor(buffer);
  const slow = lazyLoad();
  const done = attachLanguage(ed.view, buffer, () => true, ed.comp, goLoaders(() => slow.promise));
  assert.equal(coloured(ed.state), false);
  slow.release((await import('@codemirror/lang-go')).go());
  await done;
  assert.equal(structured(ed.state), true);
  assert.equal(coloured(ed.state), true);
});

test('a file switched away from before the loader resolves gets no stale language', async () => {
  const buffer = goBuffer();
  const ed = fakeEditor(buffer);
  const slow = lazyLoad();
  let current = true;
  const done = attachLanguage(ed.view, buffer, () => current, ed.comp, goLoaders(() => slow.promise));
  current = false; // the editor now shows another file, or was destroyed
  slow.release((await import('@codemirror/lang-go')).go());
  await done;
  assert.equal(structured(ed.state), false);
  assert.equal(coloured(ed.state), false);
});

test('over the large-file threshold Source has no language and no colour, as before', async () => {
  assert.equal(await languageExtension('a.ts', 2 * 1024 * 1024 + 1), null);
  assert.equal(await languageExtension('a.rb', 2 * 1024 * 1024 + 1), null);
  assert.notEqual(await languageExtension('a.rb', 2 * 1024 * 1024), null);
});
