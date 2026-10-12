// Every route from a string to parsed markup must respect innerHtmlAllowedIn (MARXY-132).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { stripComments } from './lib/repo.mjs';
import { htmlRoutes, htmlRouteProblems, constructedRegistryNameProblems, stripForRegistry, customPropertiesIn, customPropertyProblems, assembledCustomPropertyLines } from './check-registry.mjs';
import { fileURLToPath } from 'node:url';

const ALLOWED_PREFIX = 'apps/desktop/src/render/';
const OUTSIDE = 'packages/core/src/buffer.ts';

// `+=` belongs in this table so these tests fail on the pre-fix `/\.innerHTML\s*=/`
// regex; leaving only `=` would overstate what they catch (MARXY-306).
const ROUTE_SNIPPETS = [
  { form: '.innerHTML =', code: 'el.innerHTML = s;' },
  { form: '.innerHTML =', code: 'el.innerHTML += s;' },
  { form: '["innerHTML"] =', code: 'el["innerHTML"] = s;' },
  { form: '["innerHTML"] =', code: 'el["innerHTML"] += s;' },
  { form: "Reflect.set(..., 'innerHTML', ...)", code: "Reflect.set(el, 'innerHTML', s);" },
  { form: '.outerHTML =', code: 'el.outerHTML = s;' },
  { form: '.outerHTML =', code: 'el.outerHTML += s;' },
  { form: '.insertAdjacentHTML(', code: 'el.insertAdjacentHTML("beforeend", s);' },
  { form: '.setHTMLUnsafe(', code: 'el.setHTMLUnsafe(s);' },
  { form: 'document.write(', code: 'document.write(s);' },
  { form: '.createContextualFragment(', code: 'range.createContextualFragment(s);' },
];
const ROUTE_FORMS = [...new Set(ROUTE_SNIPPETS.map(({ form }) => form))];

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
  assert.deepEqual(htmlRoutes(stripComments(body)), ROUTE_FORMS);
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

test('MARXY-229: a template-literal data-marxy- attribute name is flagged', () => {
  const problems = constructedRegistryNameProblems('packages/core/src/sanitize/policy.ts', "export const X = `data-marxy-${'remote'}`;");
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /data-marxy-\* attribute name built with a template literal/);
});

test('MARXY-229: a concatenated data-marxy- attribute name is flagged', () => {
  const problems = constructedRegistryNameProblems('packages/core/src/sanitize/policy.ts', "export const X = 'data-marxy-' + 'remote';");
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /data-marxy-\* attribute name built by concatenation/);
});

test('MARXY-229: a template-literal marxy- class name is flagged', () => {
  const problems = constructedRegistryNameProblems('packages/core/src/render/render-html.ts', "el.className = `marxy-${'katex'}`;");
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /marxy-\* name built with a template literal/);
});

test('MARXY-229: a literal registered data-marxy- name is not a construction violation', () => {
  assert.deepEqual(
    constructedRegistryNameProblems('packages/core/src/sanitize/policy.ts', "export const REMOTE_IMAGE_ATTR = 'data-marxy-remote';"),
    [],
  );
});

test('check-registry.mjs is green over the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-registry.mjs'], {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /registry ok \(\d+ files\)/);
});

test('MARXY-306: innerHTML and outerHTML compound assignment outside allow-list are flagged', () => {
  const preFixInner = /\.innerHTML\s*=/;
  const preFixOuter = /\.outerHTML\s*=/;
  // String properties only have += in practice; ||= / &&= / ??= are the other
  // ECMAScript compounds that can still write a string, so the gate must not
  // special-case a single `+` literal (MARXY-306).
  const compounds = [
    'el.innerHTML += userHtml;',
    'el.outerHTML += chunk;',
    'el.innerHTML ||= fallbackHtml;',
    'el.innerHTML &&= nextHtml;',
    'el.innerHTML ??= otherHtml;',
    'el["innerHTML"] += x;',
  ];
  for (const code of compounds) {
    const stripped = stripComments(code);
    assert.equal(preFixInner.test(stripped) || preFixOuter.test(stripped), false, `pre-fix regex missed: ${code}`);
    const problems = problemsFor(OUTSIDE, code);
    assert.equal(problems.length, 1, code);
    assert.match(problems[0], /\.innerHTML =|\.outerHTML =|\["innerHTML"\] =/);
    assert.match(problems[0], /docs\/design\/README\.md/);
  }
});

test('temp fixture outside allow-list is flagged via htmlRouteProblems', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-132-'));
  try {
    const relPath = 'tmp/evil.ts';
    const abs = join(dir, 'tmp');
    mkdirSync(abs, { recursive: true });
    const source = 'el.innerHTML += x;\n';
    writeFileSync(join(abs, 'evil.ts'), source, 'utf8');
    assert.equal(/\.innerHTML\s*=/.test(stripComments(source)), false, 'pre-fix regex missed compound assignment');
    const problems = htmlRouteProblems(relPath, stripComments(source), []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /\.innerHTML =/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const viaGate = code => htmlRouteProblems(OUTSIDE, stripForRegistry(code, OUTSIDE), []);

test('MARXY-337: comparing innerHTML is not an assignment', () => {
  for (const code of ["if (el.innerHTML === '') {}", "if (el.innerHTML == '') {}", 'if (a.outerHTML !== b) {}', 'const f = () => el.innerHTML;']) {
    assert.deepEqual(viaGate(code), [], code);
  }
});

test('MARXY-337: bracket-string and other routes the old table missed are flagged', () => {
  const missed = [
    "el['outerHTML'] = s;",
    'el[`innerHTML`] = s;',
    "el['insertAdjacentHTML']('beforeend', s);",
    "el['setHTMLUnsafe'](s);",
    'document.writeln(s);',
    "document['write'](s);",
    'Document.parseHTMLUnsafe(s);',
    'new DOMParser().parseFromString(s, "text/html");',
    'frame.srcdoc = s;',
    "frame.setAttribute('srcdoc', s);",
    'Object.assign(el, { innerHTML: s });',
    'Object.assign(el, { x: 1, outerHTML: s });',
    "Object.defineProperty(el, 'innerHTML', { value: s });",
  ];
  for (const code of missed) assert.equal(viaGate(code).length >= 1, true, code);
});

test('MARXY-337: a "/*" inside a string does not hide a later route behind a fake comment', () => {
  const code = "const glob = 'src/*.ts'; el.innerHTML = x; /** doc */";
  assert.equal(viaGate(code).length, 1);
  assert.deepEqual(viaGate("/* el.innerHTML = x */ const a = 'ok';"), []);
});

// H-01 (ADR-0059): the kind scope and per-language colour are registered names. The gate runs from a
// copy of the scripts over a two-file tree, once with the real registry and once with both removed.
test('H-01: a source file using data-marxy-kind and data-marxy-lang passes the registry gate', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const real = JSON.parse(readFileSync(join(repo, 'scripts/registry.json'), 'utf8'));
  const names = ['data-marxy-kind', 'data-marxy-lang'];
  const run = (dataAttributes) => {
    const dir = mkdtempSync(join(tmpdir(), 'marxy-h01-'));
    try {
      mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
      for (const f of ['check-registry.mjs', 'lib/repo.mjs', 'lib/plan.mjs', 'lib/imports.mjs']) {
        copyFileSync(join(repo, 'scripts', f), join(dir, 'scripts', f));
      }
      writeFileSync(join(dir, 'scripts/registry.json'), JSON.stringify({ ...real, dataAttributes, customProperties: ['--marxy-tok-'] }));
      symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
      mkdirSync(join(dir, 'packages/theme'), { recursive: true });
      copyFileSync(join(repo, 'packages/theme/tokens.contract.json'), join(dir, 'packages/theme/tokens.contract.json'));
      mkdirSync(join(dir, 'apps/desktop/src/pane'), { recursive: true });
      writeFileSync(
        join(dir, 'apps/desktop/src/pane/kind.ts'),
        "export function scope(root: HTMLElement, code: HTMLElement): void {\n" +
          "  root.setAttribute('data-marxy-kind', 'report');\n" +
          "  code.setAttribute('data-marxy-lang', 'rust');\n}\n",
      );
      writeFileSync(
        join(dir, 'apps/desktop/src/pane/kind.css'),
        '[data-marxy-kind="log"] { --marxy-color-bg: #0b0b0c; }\n[data-marxy-lang="rust"] { --marxy-tok-function: #b7410e; }\n',
      );
      return spawnSync(process.execPath, ['scripts/check-registry.mjs'], { encoding: 'utf8', cwd: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  for (const name of names) assert.ok(real.dataAttributes.includes(name), `${name} missing from scripts/registry.json`);
  const ok = run(real.dataAttributes);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.match(ok.stdout, /registry ok \(\d+ files\)/);
  // Control: without the entries the same tree fails on both names, so the pass above is not vacuous.
  const without = run(real.dataAttributes.filter((a) => !names.includes(a)));
  assert.equal(without.status, 1, without.stdout);
  for (const name of names) assert.match(without.stderr + without.stdout, new RegExp(`attribute "${name}" is not in the registry`));
});

// Design plates under docs/plan/<round>/studio/ are reference HTML like mock* and galley (J-D1). The gate
// runs from a copy of the scripts over one plate, once inside studio/ and once in a sibling folder.
test('a design plate under docs/plan/<round>/studio/ is exempt; the same plate elsewhere is not', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const run = (folder) => {
    const dir = mkdtempSync(join(tmpdir(), 'marxy-studio-'));
    try {
      mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
      for (const f of ['check-registry.mjs', 'registry.json', 'lib/repo.mjs', 'lib/plan.mjs', 'lib/imports.mjs']) {
        copyFileSync(join(repo, 'scripts', f), join(dir, 'scripts', f));
      }
      // A tree this small uses none of the private properties the real list holds.
      writeFileSync(join(dir, 'scripts/registry.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(repo, 'scripts/registry.json'), 'utf8')), customProperties: [] }));
      symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
      mkdirSync(join(dir, 'packages/theme'), { recursive: true });
      copyFileSync(join(repo, 'packages/theme/tokens.contract.json'), join(dir, 'packages/theme/tokens.contract.json'));
      mkdirSync(join(dir, 'docs/plan/direction-2026-10', folder), { recursive: true });
      writeFileSync(join(dir, 'docs/plan/direction-2026-10', folder, 'plate.html'), '<div class="sd-plate"></div>\n');
      return spawnSync(process.execPath, ['scripts/check-registry.mjs'], { encoding: 'utf8', cwd: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const studio = run('studio');
  assert.equal(studio.status, 0, studio.stderr || studio.stdout);
  const elsewhere = run('plates');
  assert.equal(elsewhere.status, 1, elsewhere.stdout);
  assert.match(elsewhere.stderr + elsewhere.stdout, /sd-plate/);
});

// ---- custom properties (F-71): a --marxy-* name in source is a theme token or listed; a listed one is used somewhere
const TOKENS = new Set(['--marxy-color-accent']);
const usedBy = (...names) => new Map(names.map(n => [n, 'apps/desktop/src/x.ts']));

test('customPropertiesIn reads whole names and an assembled family prefix', () => {
  assert.deepEqual(customPropertiesIn("el.style.setProperty('--marxy-col', '1'); `--marxy-face-${n}`; var(--marxy-color-accent)"), ['--marxy-col', '--marxy-face-', '--marxy-color-accent']);
});

test('a custom property that is neither a theme token nor listed is flagged', () => {
  const problems = customPropertyProblems(usedBy('--marxy-color-accent', '--marxy-newcomer'), TOKENS, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /--marxy-newcomer.*customProperties/s);
});

test('a listed custom property that nothing uses is flagged', () => {
  const problems = customPropertyProblems(usedBy('--marxy-col'), TOKENS, ['--marxy-col', '--marxy-gone']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lists "--marxy-gone"/);
});

test('theme tokens, listed names and a listed family prefix are all accepted', () => {
  assert.deepEqual(customPropertyProblems(usedBy('--marxy-color-accent', '--marxy-col', '--marxy-face-body'), TOKENS, ['--marxy-col', '--marxy-face-']), []);
  assert.equal(customPropertyProblems(usedBy('--marxy-col'), TOKENS, ['--marxy-col', '--marxy-face-']).length, 1);
});

// The same gate end to end, from a copy over a one-file tree: an unlisted private property fails the run.
test('F-71: the gate run fails on an unlisted --marxy-* property in source and on a listed one nothing uses', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const real = JSON.parse(readFileSync(join(repo, 'scripts/registry.json'), 'utf8'));
  const run = (customProperties, css) => {
    const dir = mkdtempSync(join(tmpdir(), 'marxy-f71-'));
    try {
      mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
      for (const f of ['check-registry.mjs', 'lib/repo.mjs', 'lib/plan.mjs', 'lib/imports.mjs']) copyFileSync(join(repo, 'scripts', f), join(dir, 'scripts', f));
      writeFileSync(join(dir, 'scripts/registry.json'), JSON.stringify({ ...real, customProperties }));
      symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
      mkdirSync(join(dir, 'packages/theme'), { recursive: true });
      copyFileSync(join(repo, 'packages/theme/tokens.contract.json'), join(dir, 'packages/theme/tokens.contract.json'));
      mkdirSync(join(dir, 'apps/desktop/src/pane'), { recursive: true });
      writeFileSync(join(dir, 'apps/desktop/src/pane/x.css'), css);
      return spawnSync(process.execPath, ['scripts/check-registry.mjs'], { encoding: 'utf8', cwd: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const css = '.marxy-x { left: var(--marxy-fixture-private); color: var(--marxy-color-accent); }\n';
  const ok = run(['--marxy-fixture-private'], css);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const unlisted = run([], css);
  assert.equal(unlisted.status, 1);
  assert.match(unlisted.stderr, /"--marxy-fixture-private" is neither a theme token nor in registry\.customProperties/);
  const stale = run(['--marxy-fixture-private', '--marxy-nowhere'], css);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /lists "--marxy-nowhere"/);
});

// ---- F-75: the two gaps the F-71 review found
test('F-75: a name assembled entirely in code after --marxy- is found, with its line', () => {
  assert.deepEqual(assembledCustomPropertyLines('a\nel.style.setProperty(`--marxy-${x}`, 1);\nb'), [2]);
  assert.deepEqual(assembledCustomPropertyLines("a;\nb;\nel.style.setProperty('--marxy-' + x, 1);"), [3]);
  assert.deepEqual(assembledCustomPropertyLines('s.setProperty("--marxy-".concat(x), 1)'), [1]);
});

test('F-75: a family prefix written out at the site, and a whole name, are not assembled-in-code', () => {
  assert.deepEqual(assembledCustomPropertyLines('`--marxy-face-${n}`; \'--marxy-tok-\' + k; var(--marxy-col); s.startsWith("--marxy-")'), []);
});

test('F-75: a bare --marxy- entry, or one shorter than --marxy-x-, is rejected and covers nothing', () => {
  for (const bad of ['--marxy-', '--marxy--']) {
    const problems = customPropertyProblems(usedBy('--marxy-anything'), TOKENS, [bad]);
    assert.ok(problems.some(p => /too broad a family prefix/.test(p) && p.includes(`"${bad}"`)), problems.join('\n'));
    assert.ok(problems.some(p => /neither a theme token nor/.test(p)), 'and it does not whitelist the name');
  }
  assert.deepEqual(customPropertyProblems(usedBy('--marxy-a-b'), TOKENS, ['--marxy-a-']), []);
});

test('F-75: the gate run fails on an assembled name and on a bare --marxy- entry', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const real = JSON.parse(readFileSync(join(repo, 'scripts/registry.json'), 'utf8'));
  const run = (customProperties, ts) => {
    const dir = mkdtempSync(join(tmpdir(), 'marxy-f75-'));
    try {
      mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
      for (const f of ['check-registry.mjs', 'lib/repo.mjs', 'lib/plan.mjs', 'lib/imports.mjs']) copyFileSync(join(repo, 'scripts', f), join(dir, 'scripts', f));
      writeFileSync(join(dir, 'scripts/registry.json'), JSON.stringify({ ...real, customProperties }));
      symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
      mkdirSync(join(dir, 'packages/theme'), { recursive: true });
      copyFileSync(join(repo, 'packages/theme/tokens.contract.json'), join(dir, 'packages/theme/tokens.contract.json'));
      mkdirSync(join(dir, 'apps/desktop/src/pane'), { recursive: true });
      writeFileSync(join(dir, 'apps/desktop/src/pane/x.ts'), ts);
      return spawnSync(process.execPath, ['scripts/check-registry.mjs'], { encoding: 'utf8', cwd: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const fam = 'export const f = (n: string) => `--marxy-fam-${n}`;\n';
  const ok = run(['--marxy-fam-'], fam);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const assembled = run(['--marxy-fam-'], fam + 'export const g = (n: string) => `--marxy-${n}`;\n');
  assert.equal(assembled.status, 1);
  assert.match(assembled.stderr, /apps\/desktop\/src\/pane\/x\.ts:2: custom property name assembled entirely in code/);
  const bare = run(['--marxy-'], fam);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /"--marxy-" is too broad a family prefix/);
});
