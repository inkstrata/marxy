// The story boundary, at commit time: files must be inside the story's paths, frozen files need an ADR,
// no secrets, no build artefacts, no attribution. usage: node scripts/check-story.mjs [--staged] [--key MARXY-n] [--strict]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, registry, changedFiles, storyKey, story, pathsOf, allowedByPaths, isFrozen, fail, fix, sh } from './lib/repo.mjs';
const argv = process.argv; const staged = argv.includes('--staged'); const strict = argv.includes('--strict');
const reg = registry(); const key = storyKey(argv); const files = changedFiles({ staged });
const problems = [], notes = [];
if (files.length === 0) { console.log('story-check: nothing to check'); process.exit(0); }
const row = story(key);
if (!key) { if (strict) problems.push(`no story key in the branch name${fix('branches are type/MARXY-nn-slug (docs/conventions.md)')}`); else notes.push('no story key in the branch name; path check skipped (pass --strict to fail)'); }
else if (!row) notes.push(`story ${key} not found in docs/plan/jira-issues.csv; path check skipped`);
const paths = row ? pathsOf(row) : [];
const extras = [...reg.extraAllowedPaths, `orchestration/results/${key}`, `docs/plan/tasks/${key}.md`, `docs/plan/deltas/`];
for (const f of files) {
  if (row && !allowedByPaths(f, paths) && !extras.some(e => f === e || f.startsWith(e))) problems.push(`${f} is outside ${key}'s paths (${paths.join(', ') || 'none listed'})${fix('revert it, or if the story genuinely needs it, stop and report blocked so the planner widens the paths')}`);
  if (isFrozen(f, reg) && !files.some(g => g.startsWith('docs/adr/') && g.endsWith('.md'))) problems.push(`${f} is a frozen contract file and no docs/adr/*.md is in this change${fix('contracts change only with an ADR in the same commit (AGENTS.md)')}`);
  const full = join(ROOT, f); if (!existsSync(full) || !statSync(full).isFile()) continue;
  const size = statSync(full).size;
  if (size > reg.largeFileBytes && !reg.largeFileAllowedUnder.some(p => f.startsWith(p))) problems.push(`${f} is ${(size / 1e6).toFixed(1)} MB${fix('build outputs and captures do not belong in the tree; add to .gitignore or move under results/')}`);
  if (/(^|\/)(\.env|jira\.env|\.npmrc|id_rsa|\.pem)$/.test(f)) problems.push(`${f} looks like a credential file${fix('never commit credentials; they live in ~/.config/marxy or the environment')}`);
  if (size < 4_000_000 && !/\.(png|ttf|icns|ico|woff2?|jpg)$/.test(f)) {
    const text = readFileSync(full, 'utf8');
    if (/(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[bp]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|ATATT3[A-Za-z0-9_=-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/.test(text)) problems.push(`${f} contains what looks like a secret${fix('remove it and rotate the credential')}`);
    if (/^\s*(?:\*\s*|\/\/\s*|#\s*)?(?:co-authored-by:\s*.*(?:claude|cursor|gpt|grok|copilot|anthropic|openai)|(?:🤖\s*)?generated with (?:claude|cursor|gpt|grok|copilot))/im.test(text) && !f.startsWith('.githooks/') && !f.startsWith('scripts/check-story') && !f.startsWith('docs/conventions')) problems.push(`${f} carries an AI attribution line${fix('remove it (AGENTS.md); the commit-msg hook strips trailers, files must not carry them either')}`);
  }
}
for (const n of notes) console.log(`· ${n}`);
if (fail(problems)) process.exit(1);
console.log(`story-check ok (${key ?? 'no key'}, ${files.length} files)`);
