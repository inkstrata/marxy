// The AST reader the boundary, bundle and registry gates share: each shape a regex missed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSpecs, dynamicImportSpecs, rawInvokeCalls, isNodeBuiltin, stripCommentsAst } from './imports.mjs';

test('importSpecs reads a multi-line import list', () => {
  assert.deepEqual(importSpecs("import {\n  a,\n  b,\n} from 'node:fs';"), ['node:fs']);
});

test('importSpecs reads a side-effect import, a multi-line re-export and two imports on one line', () => {
  const src = "import 'node:fs';\nexport {\n a\n} from './x.js';\nimport a from 'a'; import b from 'b';";
  assert.deepEqual(importSpecs(src), ['node:fs', './x.js', 'a', 'b']);
});

test('importSpecs reads import-equals, import types, import() and require(), skipping interpolated templates', () => {
  const src = "import q = require('q'); type T = import('t').X; void import('d'); require(`r`); import(`./${x}`);";
  assert.deepEqual(importSpecs(src), ['q', 't', 'd', 'r']);
  assert.deepEqual(dynamicImportSpecs(src), ['d', 'r']);
});

test('importSpecs ignores import-shaped text inside strings and comments', () => {
  assert.deepEqual(importSpecs("const s = \"import x from 'fs'\";\n// import y from 'os'\n"), []);
});

test('rawInvokeCalls sees generic and nested-generic calls, and not the word in a string', () => {
  assert.equal(rawInvokeCalls("invoke<Array<string>>('x');"), 1);
  assert.equal(rawInvokeCalls("core.invoke('x'); invoke('y');"), 2);
  assert.equal(rawInvokeCalls("const s = 'invoke(x)'; // invoke(y)\n"), 0);
});

test('isNodeBuiltin knows prefixed, bare and subpath built-ins', () => {
  for (const s of ['node:fs', 'fs', 'fs/promises', 'events', 'buffer', 'module', 'assert', 'process', 'path/posix']) assert.ok(isNodeBuiltin(s), s);
  for (const s of ['react', './fs', '@marxy/core', 'markdown-it']) assert.ok(!isNodeBuiltin(s), s);
});

test('stripCommentsAst keeps comment-shaped text inside strings, templates and regexes', () => {
  const src = "const glob = 'src/*.ts'; el.innerHTML = x; /** doc */ // tail\nconst u = `http://a/*b*/`; const r = /a\\/*/;\n";
  const out = stripCommentsAst(src);
  assert.ok(out.includes("'src/*.ts'"));
  assert.ok(out.includes('el.innerHTML = x;'));
  assert.ok(out.includes('`http://a/*b*/`'));
  assert.ok(!out.includes('doc') && !out.includes('tail'));
  assert.equal(out.length, src.length);
});

test('stripCommentsAst blanks only the comment when an emoji comes before it (MARXY-337)', () => {
  const src = 'const a = "😀😀😀😀"; // c\nwindow.foo(); // window.bar\n';
  const out = stripCommentsAst(src);
  assert.ok(out.includes('window.foo();'), out);
  assert.ok(!out.includes('// c') && !out.includes('window.bar'), out);
  assert.equal(out.length, src.length);
});
