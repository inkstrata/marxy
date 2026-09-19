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
  const planned = planOpenPr({ body, key, bodyFile });
  if (fail(planned.problems)) {
    console.error(`    fix: fill results/${key}.pr.md from .github/pull_request_template.md; do not pass --body to gh`);
    process.exit(1);
  }
  if (dry) {
    console.log(planned.argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    process.exit(0);
  }
  const run = spawnSync(planned.argv[0], planned.argv.slice(1), { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
