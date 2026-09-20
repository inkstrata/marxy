// Run implementors headlessly through the Cursor CLI, one worktree per story, in parallel.
// usage: node dispatch.mjs KEY [KEY…]   (env CURSOR_AGENT overrides the binary name)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, stories, state, saveState, models, slug, typeOf } from './lib.mjs';

export const AUTH_FAILURE_LOG =
  "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.";

export function isAuthFailure({ code, log, resultExists }) {
  if (code === 0 || resultExists) return false;
  return log.toString('utf8').trim() === AUTH_FAILURE_LOG;
}

export function authFailureBulletPrefix(date = new Date().toISOString().slice(0, 10)) {
  return `- [ ] ${date} — **Headless auth failure:**`;
}

/** Restore attempts and todo status after a headless auth failure; does not persist. */
export function applyAuthFailureToStory(s2, key, attemptsBefore) {
  const r2 = s2.stories[key] ??= { status: 'todo', attempts: 0 };
  r2.attempts = attemptsBefore;
  r2.status = 'todo';
  return r2;
}

export function noteAuthFailure(key, needsHumanPath = here('needs-human.md'), now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const prefix = authFailureBulletPrefix(date);
  let content = readFileSync(needsHumanPath, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.startsWith(prefix));
  const suffix = ' — dispatch as an in-app subagent until credentials are fixed.';
  if (idx >= 0) {
    const keys = [...lines[idx].matchAll(/MARXY-\d+/g)].map(m => m[0]);
    if (!keys.includes(key)) keys.push(key);
    keys.sort((a, b) => {
      const na = Number(a.slice(6));
      const nb = Number(b.slice(6));
      return na - nb || a.localeCompare(b);
    });
    lines[idx] = `${prefix} ${keys.join(', ')}${suffix}`;
    content = lines.join('\n');
  } else {
    const sep = content.endsWith('\n') || !content.length ? '' : '\n';
    content = `${content}${sep}${prefix} ${key}${suffix}\n`;
  }
  writeFileSync(needsHumanPath, content);
}

const jira = a => {
  const r = spawnSync(process.execPath, [here('jira.mjs'), ...a], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`jira: not mirrored. Run: node orchestration/jira.mjs ${a.join(' ')}`);
};

async function runDispatch(keys) {
  const m = models();
  const bin = process.env.CURSOR_AGENT || 'cursor-agent';
  const tpl = readFileSync(here('prompts/implementor.md'), 'utf8');
  mkdirSync(resolve(ROOT, '../marxy-wt'), { recursive: true });
  mkdirSync(here('results'), { recursive: true });
  const git = a => execFileSync('git', ['-C', ROOT, ...a], { stdio: 'inherit' });
  // Cut from the main that exists on the remote, not from the orchestrator's local main, which can be
  // behind it and carries the orchestrator's uncommitted board edits besides.
  git(['fetch', '-q', 'origin']);
  const runs = keys.map(async key => {
    const st = stories().find(x => x.Key === key);
    if (!st) throw new Error(`unknown ${key}`);
    const s = state();
    const rec = s.stories[key] ??= { status: 'todo', attempts: 0 };
    const attemptsBefore = rec.attempts;
    const role = rec.attempts >= m.maxAttempts ? m.implementorEscalation : m.implementor;
    const branch = `${typeOf(st)}/${key}-${slug(st.Summary)}`;
    // Stored relative to the repo root, the form every other script resolves it from.
    const rel = `../marxy-wt/${key}`;
    const wt = resolve(ROOT, rel);
    if (!existsSync(wt)) git(['worktree', 'add', '-B', branch, wt, 'origin/main']);
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd: wt, stdio: 'inherit' });
    // A result left by the previous attempt would report this attempt as whatever that one was.
    const resultPath = here(`results/${key}.json`);
    rmSync(resultPath, { force: true });
    rec.status = 'in_progress';
    rec.attempts += 1;
    rec.branch = branch;
    rec.worktree = rel;
    rec.model = role.model;
    rec.started = new Date().toISOString();
    saveState(s);
    jira(['move', key, 'in_progress']);
    const notes = existsSync(here(`results/${key}.notes.md`))
      ? `\n\n## Reviewer notes from the previous attempt\n\n${readFileSync(here(`results/${key}.notes.md`), 'utf8')}`
      : '';
    const story =
      ['Key', 'Summary', 'Labels', 'Paths', 'Description', 'Acceptance'].map(k => `- **${k}:** ${st[k] || '—'}`).join('\n') +
      notes;
    const prompt =
      tpl.replaceAll('{{STORY}}', story).replaceAll('{{KEY}}', key) +
      `\n\nWrite the result file to ${resultPath} (absolute path; the main worktree, not yours).`;
    const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
    if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
    const log = here(`results/${key}.log`);
    const out = [];
    const child = spawn(bin, [...args, prompt], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    const timer = setTimeout(() => child.kill('SIGTERM'), m.attemptMinutes * 60_000);
    const code = await new Promise(r => child.on('exit', r));
    clearTimeout(timer);
    const logBuf = Buffer.concat(out);
    writeFileSync(log, logBuf);
    let result = null;
    try {
      result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
    } catch {
      /* unreadable is failed */
    }
    const resultExists = existsSync(resultPath);
    if (isAuthFailure({ code, log: logBuf, resultExists })) {
      const s2 = state();
      const r2 = applyAuthFailureToStory(s2, key, attemptsBefore);
      saveState(s2);
      jira(['move', key, 'todo']);
      noteAuthFailure(key);
      console.log(`${key}: auth failure (not a real attempt), exit ${code}, now ${r2.status}, log ${log}`);
      return;
    }
    const s2 = state();
    const r2 = s2.stories[key];
    // in_review is the only status the cycle reads for merging, and it needs the PR number to read it.
    if (result?.status === 'done' && Number(result.pr) > 0) {
      r2.status = 'in_review';
      r2.pr = Number(result.pr);
      saveState(s2);
      jira(['pr', key, String(r2.pr)]);
    } else if (result?.status === 'blocked') {
      r2.status = 'blocked';
      saveState(s2);
      jira(['move', key, 'blocked']);
    } else {
      r2.status = 'todo';
      saveState(s2);
      jira(['move', key, 'todo']);
    }
    const why = result?.status === 'done' && !(Number(result.pr) > 0) ? ' (result says done but names no PR)' : '';
    console.log(`${key}: exit ${code}, result ${result?.status ?? 'failed'}${why}, now ${r2.status}, log ${log}`);
  });
  const settled = await Promise.allSettled(runs);
  settled.filter(r => r.status === 'rejected').forEach(r => console.error(String(r.reason)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const keys = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!keys.length) {
    console.error('usage: dispatch.mjs KEY… [--low|--minimal|--high|--compute=NAME]');
    process.exit(2);
  }
  await runDispatch(keys);
}
