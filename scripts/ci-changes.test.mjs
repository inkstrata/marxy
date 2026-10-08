// What each kind of diff runs in CI (A-09). The classifier decides which jobs of ci.yml start, so a
// wrong answer here is either a job that cannot fail for the diff, or a gate that silently does not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUTS, classify } from './ci-changes.mjs';
import { resolveRelativeModule } from './gate-bundle.mjs';
import { importSpecs } from './lib/imports.mjs';

const none = { docs_only: false, web: false, rust: false, lockfile: false };
const every = { docs_only: false, web: true, rust: true, lockfile: true };
const only = (...keys) => ({ ...none, ...Object.fromEntries(keys.map(k => [k, true])) });

/** [why, diff, expected outputs]. */
const CASES = [
  ['docs only: no job but changes and ci', ['docs/x.md'], only('docs_only')],
  ['prose no test reads is still docs only', ['docs/research/x.md', 'orchestration/needs-human.md', 'README.md'], only('docs_only')],
  // G-03: widened. test:fleet left the pull-request path, so the prose only the fleet's tests asserted is documentation.
  ['a changelog fragment is docs only', ['changelog.d/G-03.md'], only('docs_only')],
  ['a changelog fragment beside a doc is docs only', ['changelog.d/G-03.md', 'docs/adr/0056-x.md'], only('docs_only')],
  ['agent configuration under .claude/ is docs only, whatever its extension', ['.claude/settings.json', '.claude/skills/install-local/install.sh', '.claude/skills/install-local/SKILL.md'], only('docs_only')],
  ['orchestration prose the fleet\'s tests asserted is docs only now', ['orchestration/README.md', 'orchestration/prompts/implementor.md', 'orchestration/needs-human.md'], only('docs_only')],
  ['a task card is docs only now', ['docs/plan/tasks/MARXY-1.md'], only('docs_only')],
  ['the roadmap documents are docs only', ['docs/plan/roadmap-2026-10/progress.md', 'docs/plan/roadmap-2026-10/09-ci-and-precheck.md'], only('docs_only')],
  // Not widened: `fast` itself reads these (lib/no-ceiling, check-story, smoke-verdict, smoke-built-app, check-one-parse, lib/plan).
  ['AGENTS.md is read by a scripts test, so `fast` runs', ['AGENTS.md'], none],
  ['the process docs are read by scripts tests, so `fast` runs', ['docs/sdlc.md', 'docs/hygiene.md', 'docs/ci-contract.md', 'docs/plan.md'], none],
  ['the board CSV is read by lib/plan.test, so `fast` runs', ['docs/plan/jira-issues.csv'], none],
  ['fleet code is still code: `fast` runs, nothing else', ['orchestration/x.mjs', 'orchestration/deps.json', 'orchestration/loop.sh'], none],
  ['git hooks are code', ['.githooks/commit-msg'], none],
  ['a docs change beside fleet code is not docs only', ['docs/x.md', 'orchestration/cycle.mjs'], none],
  ['a theme CSS change runs the browser job', ['packages/theme/src/tokens.css'], only('web')],
  ['the app is web', ['apps/desktop/src/app.ts'], only('web')],
  ['the parser is web', ['packages/core/src/parse/blocks.ts'], only('web')],
  ['a core test is web', ['packages/core/test/parse.test.mjs'], only('web')],
  ['a desktop test is web', ['apps/desktop/test/palette.test.mjs'], only('web')],
  ['a corpus file is web and not docs, though it ends in .md', ['fixtures/corpus/01-long-technical.md'], only('web')],
  ['the app harness page is web', ['apps/desktop/gate.html'], only('web')],
  ['a font file starts no PR job: nightly renders it', ['fonts/literata/Literata-Regular.woff2'], none],
  ['a font\'s README is docs only', ['fonts/literata/README.md'], only('docs_only')],
  ['a font\'s LICENSE is docs only', ['fonts/literata/LICENSE'], only('docs_only')],
  ['the @font-face sheet is web (the app loads it)', ['apps/desktop/src/fonts/fonts.css'], only('web')],
  // G-03: `web` narrowed from "anything under scripts/" to the scripts the browser job runs or imports.
  ['the WebKit launcher every browser test imports is web', ['scripts/playwright-webkit.mjs'], only('web')],
  ['the no-network gate is web', ['scripts/gate-no-network.mjs'], only('web')],
  ['the perf harness, whose generator progressive.test.mjs imports, is web', ['scripts/perf-harness.mjs'], only('web')],
  ['the CSP check release-csp.test.mjs imports, and the lib files it loads, are web', ['scripts/check-csp.mjs', 'scripts/lib/repo.mjs', 'scripts/lib/plan.mjs'], only('web')],
  ['the release CSP lives in tauri.conf.json: editing it runs the browser job that asserts it, and the Rust job', ['apps/desktop/src-tauri/tauri.conf.json'], only('web', 'rust')],
  ['the specimen gate is nightly: no PR job, but `fast` runs', ['scripts/specimen/specimen.mjs'], none],
  ['the aesthetics gate is nightly: no PR job, but `fast` runs', ['scripts/gate-aesthetics.mjs'], none],
  ['a script no browser job runs starts only `fast`', ['scripts/precheck.mjs', 'scripts/ci-changes.mjs', 'scripts/check-workflows.mjs', 'scripts/lib/imports.mjs'], none],
  ['a script the fleet imports no longer starts a fleet job', ['scripts/check-pr.mjs'], none],
  ['Rust source runs the Rust job only', ['apps/desktop/src-tauri/src/main.rs'], only('rust')],
  ['the Vite config is web: the Rust job no longer builds the frontend', ['apps/desktop/vite.config.ts'], only('web')],
  ['the command-line smoke is web and nightly: the Rust job no longer runs it', ['apps/desktop/scripts/smoke-cli-open.mjs'], only('web')],
  ['mise.toml pins the toolchain the Rust job uses', ['mise.toml'], only('web', 'rust')],
  ['Cargo.lock is Rust and a lockfile', ['apps/desktop/src-tauri/Cargo.lock'], only('rust', 'lockfile')],
  ['pnpm-lock.yaml is a lockfile', ['pnpm-lock.yaml'], only('web', 'lockfile')],
  ['a package manifest anywhere is a lockfile change', ['packages/core/package.json'], only('web', 'lockfile')],
  ['a docs change beside Rust is not docs only', ['docs/x.md', 'apps/desktop/src-tauri/src/lib.rs'], only('rust')],
  ['a workflow change runs everything', ['.github/workflows/ci.yml'], every],
  ['anything under .github/ counts as a workflow change, even prose', ['.github/notes.md'], every],
  ['a diff git could not produce runs everything', ['<unknown>'], every],
  ['an empty diff runs fast and nothing path-filtered', [], none],
];

for (const [why, diff, want] of CASES) {
  test(`${why}: ${JSON.stringify(diff)}`, () => {
    assert.deepEqual(classify(diff), want);
  });
}

// Every scripts/ file the browser job runs or loads must start it. The job runs `gate:no-network` and
// the files `test:lite` names; the walk follows their relative imports the way gate-bundle walks
// main.ts's, so a lite test that starts importing another script fails here instead of silently
// skipping the browser job when only that script changes.
test('every scripts/ file the browser job reaches is web', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  const lite = pkg.scripts['test:lite'].split(/\s+/).filter(a => /^test\/.*\.test\.mjs$/.test(a));
  assert.ok(lite.length >= 10, `test:lite names only ${lite.length} files; the pattern is broken`);
  const seen = new Set();
  const queue = [join(root, 'scripts/gate-no-network.mjs'), ...lite.map(f => join(root, 'apps/desktop', f))];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file) || file.includes('/node_modules/')) continue;
    seen.add(file);
    for (const spec of importSpecs(readFileSync(file, 'utf8'), file)) {
      if (spec.startsWith('.')) queue.push(resolveRelativeModule(file, spec));
    }
  }
  const files = [...seen].map(f => relative(root, f));
  const scripts = files.filter(f => f.startsWith('scripts/'));
  assert.ok(scripts.includes('scripts/playwright-webkit.mjs') && scripts.includes('scripts/perf-harness.mjs'), `the walk missed the known imports: ${scripts}`);
  assert.ok(files.length > 20, `the walk reached only ${files.length} files; it is broken`);
  assert.deepEqual(scripts.filter(f => !classify([f]).web), []);
});

test('the specimen and aesthetics gates and test:fleet are nightly: no pull-request output names them', () => {
  assert.deepEqual([...OUTPUTS], ['docs_only', 'web', 'rust', 'lockfile']);
  for (const [, diff] of CASES) for (const gone of ['typography', 'fleet']) assert.ok(!(gone in classify(diff)), `${gone} is no longer an output`);
});

test('classify answers every output the changes job declares, and nothing else', () => {
  for (const [, diff] of CASES) assert.deepEqual(Object.keys(classify(diff)).sort(), [...OUTPUTS].sort());
});

test('the command writes every output to GITHUB_OUTPUT for a real base...HEAD diff', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'ci-changes.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'marxy-ci-changes-'));
  try {
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    mkdirSync(join(dir, 'apps/desktop/src-tauri/src'), { recursive: true });
    writeFileSync(join(dir, 'apps/desktop/src-tauri/src/main.rs'), 'fn main() {}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'rust');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    execFileSync(process.execPath, [script, base], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(readFileSync(output, 'utf8'), OUTPUTS.map(k => `${k}=${k === 'rust'}\n`).join(''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
