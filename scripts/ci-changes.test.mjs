// What each kind of diff runs in CI (A-09). The classifier decides which jobs of ci.yml start, so a
// wrong answer here is either a job that cannot fail for the diff, or a gate that silently does not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUTS, classify } from './ci-changes.mjs';

const none = { docs_only: false, web: false, typography: false, rust: false, fleet: false, lockfile: false };
const every = { docs_only: false, web: true, typography: true, rust: true, fleet: true, lockfile: true };
const only = (...keys) => ({ ...none, ...Object.fromEntries(keys.map(k => [k, true])) });

/** [why, diff, expected outputs]. */
const CASES = [
  ['docs only: no job but changes and ci', ['docs/x.md'], only('docs_only')],
  ['prose no test reads is still docs only', ['docs/research/x.md', 'orchestration/needs-human.md', 'README.md'], only('docs_only')],
  ['a theme CSS change runs the browser and typography jobs', ['packages/theme/src/tokens.css'], only('web', 'typography')],
  ['a TypeScript-only desktop change runs fast and browser, nothing else', ['apps/desktop/src/app.ts'], only('web')],
  ['the parser is typography: it decides what is rendered', ['packages/core/src/parse/blocks.ts'], only('web', 'typography')],
  ['an operation is not typography', ['packages/core/src/operations/align-table.ts'], only('web')],
  ['a corpus file is typography and not docs, though it ends in .md', ['fixtures/corpus/01-long-technical.md'], only('web', 'typography')],
  ['the headless render entry the aesthetics gate builds is typography', ['apps/desktop/src/render/headless.ts'], only('web', 'typography')],
  ['Rust source runs the Rust job only', ['apps/desktop/src-tauri/src/main.rs'], only('rust')],
  ['tauri.conf.json runs the Rust job', ['apps/desktop/src-tauri/tauri.conf.json'], only('rust')],
  ['the Vite config the binary embeds runs the Rust job', ['apps/desktop/vite.config.ts'], only('web', 'rust')],
  ['the command-line smoke runs the Rust job', ['apps/desktop/scripts/smoke-cli-open.mjs'], only('web', 'rust')],
  ['mise.toml pins the toolchain the Rust job uses', ['mise.toml'], only('web', 'rust')],
  ['Cargo.lock is Rust and a lockfile', ['apps/desktop/src-tauri/Cargo.lock'], only('rust', 'lockfile')],
  ['pnpm-lock.yaml is a lockfile', ['pnpm-lock.yaml'], only('web', 'lockfile')],
  ['a package manifest anywhere is a lockfile change', ['packages/core/package.json'], only('web', 'lockfile')],
  ['fleet code runs the fleet tests only', ['orchestration/x.mjs'], only('fleet')],
  ['AGENTS.md is asserted by the fleet tests, so it is not docs only', ['AGENTS.md'], only('fleet')],
  ['the board CSV is the fleet\'s, not docs (MARXY-191)', ['docs/plan/jira-issues.csv'], only('fleet')],
  ['a script the fleet imports runs the fleet tests', ['scripts/check-pr.mjs'], only('web', 'fleet')],
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
