// Every route from a string to parsed markup must respect innerHtmlAllowedIn (MARXY-132).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { stripComments } from './lib/repo.mjs';
import { htmlRoutes, htmlRouteProblems } from './check-registry.mjs';

const ALLOWED_PREFIX = 'apps/desktop/src/render/';
const OUTSIDE = 'packages/core/src/buffer.ts';

const ROUTE_SNIPPETS = [
  { form: '.innerHTML =', code: 'el.innerHTML = s;' },
  { form: '["innerHTML"] =', code: 'el["innerHTML"] = s;' },
  { form: "Reflect.set(..., 'innerHTML', ...)", code: "Reflect.set(el, 'innerHTML', s);" },
  { form: '.outerHTML =', code: 'el.outerHTML = s;' },
  { form: '.insertAdjacentHTML(', code: 'el.insertAdjacentHTML("beforeend", s);' },
  { form: '.setHTMLUnsafe(', code: 'el.setHTMLUnsafe(s);' },
  { form: 'document.write(', code: 'document.write(s);' },
  { form: '.createContextualFragment(', code: 'range.createContextualFragment(s);' },
];

function problemsFor(relPath, source) {
  return htmlRouteProblems(relPath, stripComments(source), ['apps/desktop/src/app.ts', `${ALLOWED_PREFIX}`]);
}

for (const { form, code } of ROUTE_SNIPPETS) {
  test(`${form} outside allow-list is flagged`, () => {
    const found = htmlRoutes(stripComments(code));
    assert.ok(found.includes(form), found);
    const problems = problemsFor(OUTSIDE, code);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(problems[0], /docs\/design\/README\.md/);
  });
}

test('all eight routes inside apps/desktop/src/render/ are accepted', () => {
  const body = ROUTE_SNIPPETS.map(({ code }) => code).join('\n');
  assert.deepEqual(htmlRoutes(stripComments(body)), ROUTE_SNIPPETS.map(({ form }) => form));
  assert.deepEqual(problemsFor(`${ALLOWED_PREFIX}fixture.ts`, body), []);
});

test('route only in a block comment is not flagged', () => {
  const source = '/* el.innerHTML = poison; */\nconst x = 1;';
  assert.deepEqual(htmlRoutes(stripComments(source)), []);
  assert.deepEqual(problemsFor(OUTSIDE, source), []);
});

test('Reflect.set with inner+HTML string concat is flagged', () => {
  const source = "Reflect.set(el, 'inner' + 'HTML', s);";
  assert.ok(htmlRoutes(stripComments(source)).includes("Reflect.set(..., 'innerHTML', ...)"));
  assert.equal(problemsFor(OUTSIDE, source).length, 1);
});

test('check-registry.mjs is green over the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-registry.mjs'], {
    encoding: 'utf8',
    cwd: new URL('../', import.meta.url).pathname,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /registry ok \(\d+ files\)/);
});

test('temp fixture outside allow-list is flagged via htmlRouteProblems', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-132-'));
  try {
    const relPath = 'tmp/evil.ts';
    const abs = join(dir, 'tmp');
    mkdirSync(abs, { recursive: true });
    const source = 'el.innerHTML = s;\n';
    writeFileSync(join(abs, 'evil.ts'), source, 'utf8');
    const problems = htmlRouteProblems(relPath, stripComments(source), []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /\.innerHTML =/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
