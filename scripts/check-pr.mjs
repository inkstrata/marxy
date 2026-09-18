// A pull request's body and its side effects, checked mechanically (docs/conventions.md §Pull requests).
// usage: node scripts/check-pr.mjs (--body file | --pr N) [--key MARXY-n] [--range]
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ROOT, storyKey, changedFiles, fail, fix } from './lib/repo.mjs';
const argv = process.argv; const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
let body = arg('--body') ? readFileSync(arg('--body'), 'utf8') : arg('--pr') ? execSync(`gh pr view ${arg('--pr')} --json body --jq .body`, { encoding: 'utf8' }) : readFileSync(0, 'utf8');
const key = arg('--key') || storyKey(argv); const problems = [];
const sections = ['## Summary', '## Changes', '## Verification', '## For the reviewer', '<details>', '## Checklist'];
let last = -1;
for (const s of sections) { const i = body.indexOf(s); if (i < 0) problems.push(`missing section "${s}"${fix('use .github/pull_request_template.md in that order')}`); else if (i < last) problems.push(`section "${s}" is out of order`); else last = i; }
if (!/^\s*(<!--.*?-->\s*)*## Summary/s.test(body)) problems.push(`the body must start with "## Summary"${fix('plain language first; agent detail goes inside <details>')}`);
const summary = (body.split('## Summary')[1] || '').split('\n## ')[0].replace(/<!--[\s\S]*?-->/g, '').trim();
const sentences = summary.split(/[.!?](\s|$)/).filter(s => s.trim().length > 10).length;
if (sentences < 2) problems.push(`Summary has ${sentences} sentence(s); it needs two to four in plain language${fix('say what a reader notices or a developer can now do, and why')}`);
if (!/## Changes[\s\S]*?\n- \S/.test(body)) problems.push('Changes has no bullet');
if (!/## Verification[\s\S]*?```/.test(body)) problems.push('Verification has no fenced block of commands and results');
const table = (body.split('Acceptance criteria')[1] || '').split('\n').filter(l => /^\|/.test(l)).slice(2);
if (!table.some(l => !/^\|\s*\|\s*\|\s*$/.test(l) && l.replace(/\|/g, '').trim().length > 5)) problems.push(`the acceptance → checks table is empty${fix('one row per criterion naming the test or gate that checks it')}`);
if (key && !body.includes(key)) problems.push(`the body never mentions ${key}`);
if (argv.includes('--range')) {
  const changed = changedFiles();
  const changelog = execSync('git diff origin/main...HEAD -- CHANGELOG.md', { cwd: ROOT, encoding: 'utf8' });
  if (key && !changelog.includes(key)) problems.push(`CHANGELOG.md has no line with ${key} under Unreleased${fix('one line, written for a reader of marxy, key in parentheses')}`);
  const goldens = changed.filter(f => /goldens\/|fixtures\/baselines\//.test(f));
  if (goldens.length && !changed.includes('docs/taste-review/queue.md')) problems.push(`${goldens.length} golden/baseline files changed but docs/taste-review/queue.md did not${fix('a baseline change is a human-visible event; add a queue row')}`);
}
if (fail(problems)) process.exit(1);
console.log(`pr ok${key ? ` (${key})` : ''}`);
