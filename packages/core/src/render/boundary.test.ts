// Keeps the boundary where it is (ADR-0009, ADR-0020): the unsanitised render has exactly two kinds
// of caller, and the no-network gate drives this pipeline rather than a placeholder that happens to
// behave, without reaching into the desktop shell for any of it.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { GATE_DOCUMENT_DIRECTORY, GATE_DOCUMENT_ORIGIN } from '../sanitize/document-origin.ts';

const srcDir = new URL('../', import.meta.url);
const gate = readFileSync(new URL('../../../../scripts/gate-no-network.mjs', import.meta.url), 'utf8');

function sourceFiles(directory: URL, prefix = ''): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...sourceFiles(new URL(`${entry.name}/`, directory), `${name}/`));
      continue;
    }
    if (entry.name.endsWith('.ts')) files.push({ path: name, text: readFileSync(new URL(entry.name, directory), 'utf8') });
  }
  return files;
}

const all = sourceFiles(srcDir);

test('only the pipeline, its own index and the tests reach the unsanitised render', () => {
  const callers = all
    .filter((file) => file.path !== 'render/render-html.ts' && file.text.includes('renderToUnsanitisedHtml'))
    .map((file) => file.path)
    .sort();
  const allowed = callers.filter((path) => path.endsWith('.test.ts') || path === 'render/pipeline.ts' || path === 'render/index.ts');
  assert.deepEqual(callers, allowed, 'unsanitised HTML has exactly two kinds of caller: the pipeline, and the checks that prove the pipeline matters');
});

test('the no-network gate drives the real pipeline', () => {
  assert.match(gate, /packages\/core\/src\/render\//, 'the gate must import the core pipeline');
  assert.match(gate, /renderSafeHtml/);
  assert.match(gate, /renderToUnsanitisedHtml/, 'the gate needs the unsanitised render for its control');
});

test('the no-network gate imports nothing from the desktop shell (ADR-0020)', () => {
  const imports = [...gate.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
  const shell = imports.filter((specifier) => specifier.includes('apps/desktop') || specifier.includes('@marxy/desktop') || specifier.includes('@tauri-apps'));
  assert.deepEqual(shell, []);
  // Not even a path into the shell, in code; the header comment may name it to say why it does not.
  const code = gate.replace(/^\s*\/\/.*$/gm, '');
  for (const reach of ['apps/desktop', '@marxy/desktop', '@tauri-apps', 'src-tauri']) {
    assert.ok(!code.includes(reach), `the gate reaches into ${reach}`);
  }
});

test('the no-network gate no longer drives the markdown-it and DOMPurify placeholder', () => {
  for (const placeholder of ['markdown-it', 'markdownit', 'dompurify', 'DOMPurify']) {
    assert.ok(!gate.includes(placeholder), `the gate still mentions ${placeholder}`);
  }
});

test('both engines are still driven, in both directions', () => {
  assert.match(gate, /webkit/);
  assert.match(gate, /chromium/);
});

test('the gate serves documents from a directory, or its containment check means nothing', () => {
  // Served from the origin root, `../../../../etc/passwd` resolves to `/etc/passwd`, which is
  // inside the root, so every request is "contained" by construction and the check that a document
  // cannot reach outside its own directory passes vacuously — the round-1 finding, in a new shape.
  // The gate's own control 4 catches this at runtime; this catches it before a browser is started.
  const directory = new URL(GATE_DOCUMENT_DIRECTORY);
  assert.equal(directory.origin, new URL(GATE_DOCUMENT_ORIGIN).origin);
  assert.notEqual(directory.pathname, '/', 'a document served from the origin root cannot be climbed out of');
  assert.ok(directory.pathname.endsWith('/'), 'the directory must end in a slash, or a sibling file would look contained');
  assert.ok(new URL('../../../../../../etc/passwd', directory).href.startsWith(GATE_DOCUMENT_ORIGIN));
  assert.ok(!new URL('../../../../../../etc/passwd', directory).href.startsWith(directory.href), 'a traversal must be detectable as leaving the directory');
});

test('the gate checks that the sanitiser builds nothing the engine would not have built', () => {
  // The parse-parity check is the only thing standing between a raw-text mistake and a reader
  // fetching a file their document never asked for, so it may not quietly disappear.
  assert.match(gate, /DOMParser/, 'parity is asked of the engine, not of a regular expression here');
  assert.match(gate, /resurrected/);
});
