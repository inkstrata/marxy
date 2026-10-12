// V-14: Source has a grammar for Go, C, C++, Java, shell and TOML; a Markdown fence takes its language's colours;
// and a file whose lines end in CRLF, CR or a mixture is coloured the same and leaves Source byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compartment, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { ROLES } from '@marxy/core/src/highlight/roles.ts';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from './buffer-commit.ts';
import { attachLanguage, fenceDescription, languageExtension } from './language.ts';
import { lezerTag, ROLE_ORDER } from './highlight-style.ts';

const highlighter = tagHighlighter(ROLE_ORDER.map((role) => ({ tag: ROLES[role].lezer.map(lezerTag), class: `role-${role}` })));
const enc = new TextEncoder();

/** Role of each character of the editor's text for the file at `path` with these bytes, as Source builds it. */
async function rolesOf(path, text, { settle = false } = {}) {
  const buffer = createBuffer(path, enc.encode(text));
  const doc = cmDocText(buffer);
  const state = EditorState.create({
    doc,
    extensions: [await languageExtension(path, doc.length), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  if (settle) await new Promise((r) => setTimeout(r, 300)); // a fence's grammar loads on first use
  const roles = new Array(doc.length).fill(null);
  highlightTree(ensureSyntaxTree(state, doc.length, 10_000), highlighter, (from, to, classes) => {
    const names = classes.split(' ').map((c) => c.slice('role-'.length));
    const winner = [...names].sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0];
    for (let i = from; i < to; i++) roles[i] = winner;
  });
  return { doc, roles, buffer };
}
const at = (r, needle, nth = 1) => {
  let i = -1;
  for (let k = 0; k < nth; k++) i = r.doc.indexOf(needle, i + 1);
  return r.roles[i];
};

test('V-14: each added language colours its keywords, strings, numbers and comments', async () => {
  const cases = [
    ['a.go', 'package main\nfunc f() int { return 1 } // c\nvar s = "x"\n', { func: 'keyword', '// c': 'comment', '"x"': 'string', 1: 'number' }],
    ['a.c', 'int main(void) { return 0; } // c\n', { return: 'keyword', '// c': 'comment', 0: 'number' }],
    ['a.cpp', 'class A { public: int b = 2; }; // c\n', { class: 'keyword', '// c': 'comment', 2: 'number' }],
    ['A.java', 'public class A { String s = "x"; } // c\n', { class: 'keyword', '// c': 'comment', '"x"': 'string' }],
    ['a.sh', 'if [ -n "$X" ]; then echo hi; fi # c\n', { if: 'keyword', '# c': 'comment', echo: 'builtin' }],
    ['a.toml', '[t]\nk = "v" # c\nn = 3\n', { '"v"': 'string', '# c': 'comment', 3: 'number', k: 'property' }],
  ];
  for (const [path, text, want] of cases) {
    const r = await rolesOf(path, text);
    for (const [needle, role] of Object.entries(want)) assert.equal(at(r, needle), role, `${path} ${needle}`);
  }
});

test('V-14: a Markdown fence is coloured in its language, and an unknown one is left plain', async () => {
  const text = '# T\n\n```go\nfunc a() {}\n```\n\n```sh\nif x; then y; fi\n```\n\n```nope\nfunc b\n```\n';
  const r = await rolesOf('a.md', text, { settle: true });
  assert.equal(at(r, 'func a'), 'keyword');
  assert.equal(at(r, 'a()'), 'function');
  assert.equal(at(r, 'if x'), 'keyword');
  assert.notEqual(at(r, 'func b'), 'keyword');
});

// A mixed file keeps `\n` as CodeMirror's separator (F-24), so its CRLF lines keep a CR at the end of the line, which
// no grammar here lets into a token. A lone CR inside a mixed file is a character in a line, by that same rule.
test('V-14: LF, CRLF, CR and mixed (CRLF with LF) endings give the same colours and the same bytes', async () => {
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

// Review round 1: a grammar that will not load leaves Source on screen, uncoloured; the text never waits for it.
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
const coloured = (state) => {
  let any = false;
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
  if (tree) highlightTree(tree, highlighter, () => (any = true));
  return any;
};
const goLoaders = (loader) => ({ go: loader });

test('V-14 round 1: a loader that rejects leaves the text uncoloured and does not throw', async () => {
  const buffer = goBuffer();
  assert.equal(await languageExtension('a.go', 10, goLoaders(async () => { throw new Error('chunk 404'); })), null);
  const ed = fakeEditor(buffer);
  await attachLanguage(ed.view, buffer, () => true, ed.comp, goLoaders(async () => { throw new Error('chunk 404'); }));
  assert.equal(ed.state.doc.toString(), cmDocText(buffer));
  assert.equal(coloured(ed.state), false);
});

test('V-14 round 1: the language arrives later, when the loader resolves', async () => {
  const buffer = goBuffer();
  const ed = fakeEditor(buffer);
  const slow = lazyLoad();
  const done = attachLanguage(ed.view, buffer, () => true, ed.comp, goLoaders(() => slow.promise));
  assert.equal(coloured(ed.state), false);
  slow.release((await import('@codemirror/lang-go')).go());
  await done;
  assert.equal(coloured(ed.state), true);
});

test('V-14 round 1: a file switched away from before the loader resolves gets no stale language', async () => {
  const buffer = goBuffer();
  const ed = fakeEditor(buffer);
  const slow = lazyLoad();
  let current = true;
  const done = attachLanguage(ed.view, buffer, () => current, ed.comp, goLoaders(() => slow.promise));
  current = false; // the editor now shows another file, or was destroyed
  slow.release((await import('@codemirror/lang-go')).go());
  await done;
  assert.equal(coloured(ed.state), false);
});

test('V-14 round 1: a fence whose grammar fails to load stays plain, with no rejection', async () => {
  const d = fenceDescription('go', async () => { throw new Error('chunk 404'); });
  const support = await d.load();
  assert.ok(support.language);
});
