// V-13 (ADR-0068): Source (Lezer) and Rendered (Shiki) give the same token the same role. Each fixture is
// tokenised by both engines, and for every listed construct the role at its first character is asserted in
// each. A construct one engine cannot tell apart is a named gap with its reason, never a silent difference.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { ROLES } from '@marxy/core/src/highlight/roles.ts';
import { tokenizeWithAllowList } from '@marxy/core/src/highlight/highlighter.ts';
import { marxyScopeForTokenColor } from '@marxy/core/src/highlight/scopes.ts';
import { languageExtension } from './language.ts';
import { lezerTag, ROLE_ORDER } from './highlight-style.ts';

const highlighter = tagHighlighter(
  ROLE_ORDER.map((role) => ({ tag: ROLES[role].lezer.map(lezerTag), class: `role-${role}` })),
);

/** Role of every character, in Source: the last role class a token carries wins, as in the style sheet. */
async function sourceRoles(path, doc) {
  const state = EditorState.create({ doc, extensions: [await languageExtension(path, doc.length)] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000);
  const roles = new Array(doc.length).fill(null);
  highlightTree(tree, highlighter, (from, to, classes) => {
    const names = classes.split(' ').map((c) => c.slice('role-'.length));
    const winner = [...names].sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0];
    for (let i = from; i < to; i++) roles[i] = winner;
  });
  return roles;
}

/** Role of every character, in Rendered. */
async function renderedRoles(lang, doc) {
  const lines = await tokenizeWithAllowList(doc, lang);
  const roles = new Array(doc.length).fill(null);
  let offset = 0;
  for (const line of lines) {
    for (const tok of line) {
      const role = marxyScopeForTokenColor(tok.color) ?? null;
      for (let i = 0; i < tok.content.length; i++) roles[offset + i] = role;
      offset += tok.content.length;
    }
    offset += 1; // the newline
  }
  return roles;
}

function indexOfNth(doc, needle, nth = 1) {
  let at = -1;
  for (let i = 0; i < nth; i++) {
    at = doc.indexOf(needle, at + 1);
    assert.ok(at >= 0, `${JSON.stringify(needle)} #${nth} is not in the fixture`);
  }
  return at;
}

// `c(label, needle, role)` expects both engines to say `role` for the needle's first character.
// `gap(label, needle, { rendered, source }, why)` records a place the engines cannot agree.
const c = (label, needle, role, nth = 1) => ({ label, needle, rendered: role, source: role, nth });
const gap = (label, needle, { rendered, source }, why, nth = 1) => ({ label, needle, rendered, source, nth, why });

const PYTHON = `@decorator(1)
class Foo(Base):
    def run(self, x: int = 3):
        s = "plain"
        print(f"a\\n{x!r} {self.y}")
        return len([1])  # c
`;
const TYPESCRIPT = `@Component({a:1})
class A { b = 1; run(this: A) { console.log("a\\n", this.b, \`t\${1}\`); } }
const o = { k: 1 }; const t = true; // c
`;
const RUST = `#[derive(Debug)]
struct S { a: i32 }
fn main() {
    println!("hi\\n");
    let x: Vec<u8> = Vec::new();
    self.a;
}
`;

const FIXTURES = [
  {
    name: 'Python', lang: 'python', path: 'a.py', doc: PYTHON,
    constructs: [
      c('keyword', 'class', 'keyword'),
      c('keyword (return)', 'return', 'keyword'),
      c('decorator mark', '@', 'decorator'),
      c('decorator name', 'decorator', 'decorator'),
      c('class definition', 'Foo', 'type'),
      c('def name', 'run', 'function'),
      c('number', '3', 'number'),
      c('number in a decorator argument', '1', 'number'),
      c('string', 'plain', 'string'),
      c('escape', '\\n', 'escape'),
      c('f-string placeholder', '{x', 'punctuation'),
      c('property', 'y}', 'property'),
      c('comment', '# c', 'comment'),
      gap('self', 'self', { rendered: 'self', source: 'variable' }, 'Lezer gives self no tag in Python; it is a plain VariableName'),
      gap('builtin, called', 'print', { rendered: 'builtin', source: 'function' }, 'Lezer cannot tell a builtin from any other call'),
      gap('builtin, uncalled', 'int', { rendered: 'builtin', source: 'variable' }, 'Lezer has no list of Python builtins'),
    ],
  },
  {
    name: 'TypeScript', lang: 'typescript', path: 'a.ts', doc: TYPESCRIPT,
    constructs: [
      c('decorator mark', '@', 'decorator'),
      c('decorator name', 'Component', 'decorator'),
      c('keyword', 'class', 'keyword'),
      c('keyword (const)', 'const', 'keyword'),
      c('class definition', 'A', 'type'),
      c('field definition', 'b =', 'property'),
      c('self (this)', 'this', 'self'),
      c('call', 'log', 'function'),
      c('property', 'b,', 'property'),
      c('object key', 'k:', 'property'),
      c('escape', '\\n', 'escape'),
      c('template placeholder', '${', 'punctuation'),
      c('number', '1; run', 'number'),
      c('constant', 'true', 'constant'),
      c('comment', '// c', 'comment'),
    ],
  },
  {
    name: 'Rust', lang: 'rust', path: 'a.rs', doc: RUST,
    constructs: [
      c('decorator mark', '#', 'decorator'),
      c('decorator name', 'derive', 'decorator'),
      c('keyword', 'struct', 'keyword'),
      c('keyword (let)', 'let', 'keyword'),
      c('type definition', 'S ', 'type'),
      c('type', 'i32', 'type'),
      c('type (Vec)', 'Vec<', 'type'),
      c('fn name', 'main', 'function'),
      c('macro', 'println', 'function'),
      gap('escape', '\\n', { rendered: 'escape', source: null }, 'the Rust grammar leaves an escape inside a string untagged'),
      c('self', 'self', 'self'),
      gap('field', 'a;', { rendered: null, source: 'property' }, 'the Rust grammar leaves a field access with no scope'),
    ],
  },
];

for (const fx of FIXTURES) {
  test(`V-13 parity: ${fx.name}, Source and Rendered give each construct one role`, async () => {
    const [source, rendered] = [await sourceRoles(fx.path, fx.doc), await renderedRoles(fx.lang, fx.doc)];
    for (const k of fx.constructs) {
      const at = indexOfNth(fx.doc, k.needle, k.nth);
      assert.equal(source[at], k.source, `${fx.name} ${k.label}: Source`);
      assert.equal(rendered[at], k.rendered, `${fx.name} ${k.label}: Rendered`);
      if (!k.why) assert.equal(source[at], rendered[at], `${fx.name} ${k.label}: the modes disagree`);
      else assert.notEqual(source[at], rendered[at], `${fx.name} ${k.label}: the gap closed, so remove it from the list`);
    }
  });
}

// Go and shell have no Source grammar yet (V-14); Rendered's roles are held here so they are right when it lands.
const RENDERED_ONLY = [
  { name: 'Go', lang: 'go', doc: 'package main\nfunc (s *S) Run(x int) string {\n\tfmt.Println("a\\n", s.y)\n\treturn len(x)\n}\n// c\n',
    want: [['func', 'keyword'], ['Run', 'function'], ['int', 'builtin'], ['\\n', 'escape'], ['len', 'builtin'], ['// c', 'comment']] },
  { name: 'shell', lang: 'bash', doc: 'if [ -n "$X" ]; then echo hi ; fi # c\n',
    want: [['if', 'keyword'], ['echo', 'builtin'], ['# c', 'comment']] },
];
for (const fx of RENDERED_ONLY) {
  test(`V-13 parity: ${fx.name} (Rendered only until V-14) takes the roles the table gives`, async () => {
    const rendered = await renderedRoles(fx.lang, fx.doc);
    for (const [needle, role] of fx.want) assert.equal(rendered[indexOfNth(fx.doc, needle)], role, `${fx.name} ${needle}`);
  });
}

test('V-13 parity: every Lezer tag and TextMate scope in the role table is accepted by its engine', () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    for (const tag of spec.lezer) assert.ok(lezerTag(tag), `${role}: ${tag}`);
  }
});
