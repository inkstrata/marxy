// A pull request's body and its side effects, checked mechanically (docs/conventions.md §Pull requests).
// usage: node scripts/check-pr.mjs (--body file | --pr N) [--key MARXY-n] [--range]
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, storyKey, changedFiles, fail, fix } from './lib/repo.mjs';

export const HOUSE_SECTIONS = [
  '## Summary',
  '## Changes',
  '## Verification',
  '## For the reviewer',
  '<details>',
  '## Checklist',
];

/** Top-level headings from the Cursor / generic templates agents paste instead of the house one. */
export const FOREIGN_HEADINGS = ['## Test plan', '## Why', '## Acceptance'];

/** Phrases that have landed in PR bodies after the commit-msg hook could not see them. */
export const ATTRIBUTION_RE = /made with cursor|(?:🤖\s*)?generated with (?:claude|cursor|gpt|grok|copilot)|co-authored-by:\s*.*(?:claude|cursor|gpt|grok|copilot)/i;

const TABLE_SPLIT = 'Acceptance criteria';

function cells(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

/**
 * Mechanical body rules. Range / changelog / golden checks stay in lintPrRange so tests
 * can drive the body half without a git range.
 */
export function lintPrBody(body, { key } = {}) {
  const problems = [];
  const text = String(body ?? '');
  let last = -1;
  for (const s of HOUSE_SECTIONS) {
    const i = text.indexOf(s);
    if (i < 0) problems.push(`missing section "${s}"${fix('use .github/pull_request_template.md in that order')}`);
    else if (i < last) problems.push(`section "${s}" is out of order`);
    else last = i;
  }
  if (!/^\s*(<!--.*?-->\s*)*## Summary/s.test(text)) {
    problems.push(`the body must start with "## Summary"${fix('plain language first; agent detail goes inside <details>')}`);
  }
  const summary = (text.split('## Summary')[1] || '').split('\n## ')[0].replace(/<!--[\s\S]*?-->/g, '').trim();
  const sentences = summary.split(/[.!?](\s|$)/).filter(s => s.trim().length > 10).length;
  if (sentences < 2) {
    problems.push(`Summary has ${sentences} sentence(s); it needs two to four in plain language${fix('say what a reader notices or a developer can now do, and why')}`);
  }
  if (!/## Changes[\s\S]*?\n- \S/.test(text)) problems.push('Changes has no bullet');
  if (!/## Verification[\s\S]*?```/.test(text)) problems.push('Verification has no fenced block of commands and results');
  for (const h of FOREIGN_HEADINGS) {
    if (new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(text)) {
      problems.push(`foreign heading "${h}"${fix('the house template is Summary, Changes, Verification, For the reviewer, Agent detail, Checklist — not Why / Acceptance / Test plan')}`);
    }
  }
  if (ATTRIBUTION_RE.test(text)) {
    problems.push(`the body carries an AI attribution line${fix('remove it (AGENTS.md); the commit-msg hook cannot see the PR body')}`);
  }
  const table = (text.split(TABLE_SPLIT)[1] || '').split('\n').filter(l => /^\|/.test(l)).slice(2);
  const filled = table.filter(l => cells(l).some(c => c.length > 0));
  if (!filled.length) {
    problems.push(`the acceptance → checks table is empty${fix('one row per criterion naming the test or gate that checks it')}`);
  } else {
    for (const l of filled) {
      const [criterion, checkedBy] = cells(l);
      if (!criterion) problems.push(`an acceptance row has an empty criterion${fix('name the story criterion')}`);
      if (!checkedBy || checkedBy.length < 3 || /^TODO$/i.test(checkedBy)) {
        problems.push(`Checked by is unfilled ("${checkedBy || ''}")${fix('name the test or gate that checks the criterion; TODO is not a check')}`);
      }
    }
  }
  if (key && !text.includes(key)) problems.push(`the body never mentions ${key}`);
  return problems;
}

/** Changelog line and taste-queue row for golden/baseline edits. */
export function lintPrRange({ key, changed = [], changelogDiff = '' } = {}) {
  const problems = [];
  if (key && !changelogDiff.includes(key)) {
    problems.push(`CHANGELOG.md has no line with ${key} under Unreleased${fix('one line, written for a reader of marxy, key in parentheses')}`);
  }
  const goldens = changed.filter(f => /goldens\/|fixtures\/baselines\//.test(f));
  if (goldens.length && !changed.includes('docs/taste-review/queue.md')) {
    problems.push(`${goldens.length} golden/baseline files changed but docs/taste-review/queue.md did not${fix('a baseline change is a human-visible event; add a queue row')}`);
  }
  return problems;
}

function readBody(argv) {
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (arg('--body')) {
    try { return readFileSync(arg('--body'), 'utf8'); }
    catch { throw new Error(`cannot read ${arg('--body')}${fix('pass a path that exists')}`); }
  }
  if (arg('--pr')) {
    try {
      return execSync(`gh pr view ${arg('--pr')} --json body --jq .body`, { encoding: 'utf8' });
    } catch {
      throw new Error(`cannot read PR ${arg('--pr')}${fix('install gh and authenticate, or pass --body file')}`);
    }
  }
  return readFileSync(0, 'utf8');
}

export function checkPr(argv = process.argv, { body, changed, changelogDiff } = {}) {
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const key = arg('--key') || storyKey(argv);
  let text = body;
  if (text === undefined) text = readBody(argv);
  const problems = lintPrBody(text, { key });
  if (argv.includes('--range')) {
    const files = changed ?? changedFiles();
    const diff = changelogDiff ?? execSync('git diff origin/main...HEAD -- CHANGELOG.md', { cwd: ROOT, encoding: 'utf8' });
    problems.push(...lintPrRange({ key, changed: files, changelogDiff: diff }));
  }
  return { key, problems };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const { key, problems } = checkPr(process.argv);
    if (fail(problems)) process.exit(1);
    console.log(`pr ok${key ? ` (${key})` : ''}`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
