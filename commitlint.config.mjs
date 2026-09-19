// Commit message conventions (docs/conventions.md). Run in CI over the PR's commits and its title.
// `node commitlint.config.mjs --selftest` is the check for MARXY-100: the story paths leave no
// separate test file, and a config that is never asserted will drift the same way the hook did.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert']],
    'scope-enum': [1, 'always', ['core', 'typeset', 'theme', 'shell', 'desktop', 'corpus', 'gates', 'ci', 'docs', 'orchestration', 'release', 'fonts', 'repo', 'workspace', 'bootstrap', 'spike']],
    // 100, not 72: the (MARXY-nnn) suffix alone takes 13 characters, and a squash merge adds (#nn).
    'header-max-length': [2, 'always', 100],
    'subject-full-stop': [2, 'never', '.'],
    'body-max-line-length': [1, 'always', 100],
    'footer-max-line-length': [1, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // The Jira key belongs at the end of the subject, checked directly rather than through the
    // parser's issue references: with issuePrefixes set, a key mentioned anywhere in the body was
    // read as a footer, so a commit could not name a sibling story without failing.
    'marxy-key-in-subject': [2, 'always'],
    'trailer-exists': [0],
  },
  plugins: [{
    rules: {
      'marxy-key-in-subject': ({ header }) => [
        /\(MARXY-\d+\)( \(#\d+\))?$/.test(header ?? '') || /^(Merge|Revert|\w+(\(\w+\))?!?: .*\((bootstrap|spike)\))/.test(header ?? ''),
        'subject must end with the Jira key in parentheses, e.g. "(MARXY-23)" — docs/conventions.md',
      ],
    },
  }],
  ignores: [msg => /^(Merge|Revert)\b/.test(msg)],
};
export default config;

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, '.githooks/commit-msg');

function gitCommonDir(cwd = here) {
  return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8',
  }).trim();
}

function mainCheckout(cwd = here) {
  return resolve(gitCommonDir(cwd), '..');
}

function commitlintBin() {
  for (const dir of [here, mainCheckout()]) {
    const bin = join(dir, 'node_modules/.bin/commitlint');
    if (existsSync(bin)) return { bin, dir };
  }
  return null;
}

function withMsg(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-100-'));
  const file = join(dir, 'msg');
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  try { return fn(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function lint(message) {
  const found = commitlintBin();
  if (!found) return { status: 127, stdout: '', stderr: 'commitlint not installed for selftest\n' };
  return withMsg(message, file => spawnSync(found.bin, ['--edit', file, '--verbose'], {
    encoding: 'utf8',
    cwd: here,
    env: { ...process.env, NODE_PATH: join(found.dir, 'node_modules') },
  }));
}

function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  return { ...env, ...extra };
}

function runHook(message, { cwd, env } = {}) {
  return withMsg(message, file => spawnSync(hookPath, [file], {
    encoding: 'utf8',
    cwd: cwd ?? here,
    env: cleanGitEnv(env),
  }));
}

function header(innerLen) {
  return `fix(gates): ${'x'.repeat(innerLen)} (MARXY-100)`;
}

function selftest() {
  let bad = 0;
  let ran = 0;
  const report = (ok, name, detail) => {
    ran += 1;
    if (ok) console.log(`selftest ok: ${name}`);
    else { bad += 1; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const outOf = r => `${r.stdout || ''}${r.stderr || ''}`;

  report(JSON.stringify(config.rules['header-max-length']) === JSON.stringify([2, 'always', 100]),
    'config: header-max-length is 100');
  report(JSON.stringify(config.rules['footer-max-line-length']) === JSON.stringify([1, 'always', 100]),
    'config: footer-max-line-length is a warning at 100');
  report(JSON.stringify(config.rules['footer-max-line-length']) === JSON.stringify(config.rules['body-max-line-length']),
    'config: footer-max-line-length matches body-max-line-length');
  report(config.rules['scope-enum'][2].includes('repo') && config.rules['scope-enum'][2].includes('workspace'),
    'config: scope-enum includes repo and workspace');

  const h100 = lint(header(76));
  report(h100.status === 0 && header(76).length === 100, 'lint: a 100-character header passes',
    `exit ${h100.status}, len ${header(76).length}: ${outOf(h100).trim()}`);
  const h101 = lint(header(77));
  report(h101.status !== 0 && /header-max-length/.test(outOf(h101)), 'lint: a 101-character header fails',
    `exit ${h101.status}: ${outOf(h101).trim()}`);
  const h73 = lint(header(49));
  report(h73.status === 0 && header(49).length === 73, 'lint: a 73-character header passes (the old 72 limit would refuse it)',
    `exit ${h73.status}, len ${header(49).length}: ${outOf(h73).trim()}`);

  const squash = lint('fix(gates): lint commit messages where they are written (MARXY-100) (#48)');
  report(squash.status === 0, 'lint: a squash-merge subject with a trailing (#n) passes', outOf(squash).trim());
  const bareKey = lint('fix(gates): lint commit messages where they are written');
  report(bareKey.status !== 0 && /marxy-key-in-subject/.test(outOf(bareKey)),
    'lint: a subject without the key still fails', outOf(bareKey).trim());

  const repo = lint('chore(repo): freeze the workspace contracts (MARXY-100)');
  const workspace = lint('chore(workspace): freeze the workspace contracts (MARXY-100)');
  report(repo.status === 0, 'lint: scope repo is accepted', outOf(repo).trim());
  report(workspace.status === 0, 'lint: scope workspace is accepted', outOf(workspace).trim());

  const footer = lint(`fix(gates): footer line (MARXY-100)\n\nBody.\n\nBREAKING CHANGE: ${'z'.repeat(110)}\n`);
  report(footer.status === 0 && /footer-max-line-length/.test(outOf(footer)) && /found 0 problems/.test(outOf(footer)),
    'lint: a long footer line is a warning, not a failure', outOf(footer).trim());

  const empty = join(tmpdir(), `marxy-100-wt-${process.pid}`);
  execFileSync('git', ['worktree', 'add', '--detach', '-q', empty], { cwd: here });
  let borrowed;
  let borrowedOk;
  try {
    report(!existsSync(join(empty, 'node_modules/.bin/commitlint')),
      'hook: the borrowed worktree has no local commitlint');
    borrowed = runHook('not a conventional commit', { cwd: empty });
    borrowedOk = runHook('fix(gates): short (MARXY-100)', { cwd: empty });
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', empty], { cwd: here });
  }
  report(borrowed.status !== 0 && /marxy-key-in-subject|type-empty|subject-empty/.test(outOf(borrowed)),
    'hook: a worktree without node_modules borrows commitlint and refuses a message commitlint refuses',
    `exit ${borrowed.status}: ${outOf(borrowed).trim()}`);
  report(borrowedOk.status === 0, 'hook: the same worktree accepts a message commitlint accepts',
    `exit ${borrowedOk.status}: ${outOf(borrowedOk).trim()}`);

  const fake = mkdtempSync(join(tmpdir(), 'marxy-100-none-'));
  execFileSync('git', ['init', '-q'], { cwd: fake });
  chmodSync(hookPath, 0o755);
  const missing = runHook('fix(gates): short (MARXY-100)', { cwd: fake });
  const skipped = runHook('fix(gates): short (MARXY-100)', { cwd: fake, env: { MARXY_SKIP_HOOKS: '1' } });
  rmSync(fake, { recursive: true, force: true });
  report(missing.status !== 0 && /pnpm install/.test(outOf(missing)) && /MARXY_SKIP_HOOKS/.test(outOf(missing)),
    'hook: missing commitlint fails and says how to install it',
    `exit ${missing.status}: ${outOf(missing).trim()}`);
  report(skipped.status === 0, 'hook: MARXY_SKIP_HOOKS bypasses a missing commitlint',
    `exit ${skipped.status}: ${outOf(skipped).trim()}`);

  const conventions = readFileSync(join(here, 'docs/conventions.md'), 'utf8');
  report(/at most 100 characters/.test(conventions), 'docs: conventions.md states the 100-character header limit');
  report(/footer lines over 100 characters are a warning/.test(conventions),
    'docs: conventions.md states that long footer lines are a warning');
  report(/`repo`/.test(conventions) && /`workspace`/.test(conventions),
    'docs: conventions.md lists the repo and workspace scopes');
  report(/squash merge appends/.test(conventions) || /\(#nn\)/.test(conventions),
    'docs: conventions.md records that a squash-merge (#n) is accepted');

  if (bad) { console.error(`commitlint selftest failed: ${bad}/${ran} case(s)`); process.exit(1); }
  console.log(`commitlint selftest ok: ${ran} named cases`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--selftest')) {
  selftest();
}
