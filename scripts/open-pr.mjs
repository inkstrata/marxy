// The only path that may open a pull request. A body that would fail check-pr never reaches gh.
// usage: node scripts/open-pr.mjs [MARXY-n] [--dry-run]
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, storyKey, fail, fix } from './lib/repo.mjs';
import { lintPrBody } from './check-pr.mjs';

function titleFrom(body, key) {
  const m = /<!--\s*Title:\s*(.+?)\s*-->/.exec(body);
  if (m) return m[1].trim();
  return `type(scope): subject (${key})`;
}

/** Decide whether gh may run. Tests drive this; the CLI is the only caller that may spawn. */
export function planOpenPr({ body, key, title, bodyFile }) {
  const problems = lintPrBody(body, { key });
  if (problems.length) return { ok: false, problems, argv: null };
  const subject = title || titleFrom(body, key);
  return {
    ok: true,
    problems: [],
    argv: ['gh', 'pr', 'create', '--title', subject, '--body-file', bodyFile],
  };
}

/** The real `gh`: spawn it, echo what it printed, and pull the PR number out of the URL it prints. */
export function defaultGh(argv) {
  const run = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    return { ok: false, number: null, problems: [(run.stderr || run.stdout || `gh exited ${run.status}`).trim()] };
  }
  const url = (run.stdout || '').trim().split('\n').filter(Boolean).pop() ?? '';
  const m = /\/pull\/(\d+)/.exec(url);
  return { ok: true, number: m ? Number(m[1]) : null, problems: [] };
}

/**
 * Open the PR (or, under `--dry-run`, plan it) and return its number, so `done.mjs` can record
 * it without re-parsing `gh`'s output itself. `gh` is injected so tests can record calls
 * instead of spawning the real CLI (MARXY-121).
 */
export function openPr({ body, key, bodyFile, title, dryRun = false, gh = defaultGh }) {
  const planned = planOpenPr({ body, key, title, bodyFile });
  if (!planned.ok) return { ok: false, number: null, problems: planned.problems, argv: null };
  if (dryRun) return { ok: true, number: null, problems: [], argv: planned.argv };
  const result = gh(planned.argv);
  return { ok: result.ok, number: result.number ?? null, problems: result.problems ?? [], argv: planned.argv };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const key = argv.find(a => /^MARXY-/.test(a)) || storyKey(process.argv);
  if (!key) {
    console.error(`usage: node scripts/open-pr.mjs MARXY-n${fix('run on a type/MARXY-n-slug branch, or pass the key')}`);
    process.exit(2);
  }
  const bodyFile = join(ROOT, `results/${key}.pr.md`);
  if (!existsSync(bodyFile)) {
    console.error(`✗ no drafted body at results/${key}.pr.md${fix(`pnpm done ${key}, fill every TODO, then run this again`)}`);
    process.exit(1);
  }
  const body = readFileSync(bodyFile, 'utf8');
  const opened = openPr({ body, key, bodyFile, dryRun: dry });
  if (fail(opened.problems)) {
    console.error(`    fix: fill results/${key}.pr.md from .github/pull_request_template.md; do not pass --body to gh`);
    process.exit(1);
  }
  if (dry) {
    console.log(opened.argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    process.exit(0);
  }
  console.log(opened.number != null ? `opened PR #${opened.number}` : 'gh pr create finished but no PR number was found in its output');
  process.exit(opened.number != null ? 0 : 1);
}
