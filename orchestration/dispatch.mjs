// Run implementors headlessly through the Cursor CLI, one worktree per story, in parallel.
// usage: node dispatch.mjs KEY [KEY…]   (env CURSOR_AGENT overrides the binary name)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, here, stories, state, saveState, models, slug, typeOf, cursorAgentBin } from './lib.mjs';
import { logDispatch, logImplementFail } from './model-stats.mjs';

/** @param {{ code: number | null, result: { status?: string, notes?: string, pr?: number } | null, timedOut?: boolean, attemptMinutes: number }} ctx */
export function implementFailReason({ code, result, timedOut, attemptMinutes }) {
  if (timedOut) return `timeout (${attemptMinutes}m)`;
  if (!result) return code ? `no result file (exit ${code})` : 'no result file';
  if (result.status === 'blocked') {
    const n = String(result.notes ?? '').trim().split('\n')[0];
    return n ? `blocked: ${n.slice(0, 120)}` : 'blocked';
  }
  if (result.status === 'done' && !(Number(result.pr) > 0)) return 'done but no PR';
  if (result.status && result.status !== 'done') {
    const n = String(result.notes ?? '').trim().split('\n')[0];
    return n ? `${result.status}: ${n.slice(0, 120)}` : result.status;
  }
  if (code) return `exit ${code}`;
  return 'implementor did not finish';
}
const keys = process.argv.slice(2).filter(a => !a.startsWith('--')); if (!keys.length) { console.error('usage: dispatch.mjs KEY… [--low|--minimal|--high|--compute=NAME]'); process.exit(2); }
const m = models();
const bin = cursorAgentBin();
if (!bin) {
  console.error('cursor-agent not found: install the Cursor CLI, add ~/.local/bin to PATH, or set CURSOR_AGENT');
  process.exit(2);
}
process.env.CURSOR_AGENT = bin;
const tpl = readFileSync(here('prompts/implementor.md'), 'utf8');
mkdirSync(resolve(ROOT, '../marxy-wt'), { recursive: true }); mkdirSync(here('results'), { recursive: true });
const git = a => execFileSync('git', ['-C', ROOT, ...a], { stdio: 'inherit' });
const jira = a => { const r = spawnSync(process.execPath, [here('jira.mjs'), ...a], { encoding: 'utf8' }); if (r.status !== 0) console.error(`jira: not mirrored. Run: node orchestration/jira.mjs ${a.join(' ')}`); };
// Cut from the main that exists on the remote, not from the orchestrator's local main, which can be
// behind it and carries the orchestrator's uncommitted board edits besides.
git(['fetch', '-q', 'origin']);
const runs = keys.map(async key => {
  const st = stories().find(x => x.Key === key); if (!st) throw new Error(`unknown ${key}`);
  const s = state(); const rec = s.stories[key] ??= { status: 'todo', attempts: 0 };
  const role = rec.attempts >= m.maxAttempts ? m.implementorEscalation : m.implementor;
  const branch = `${typeOf(st)}/${key}-${slug(st.Summary)}`;
  // Stored relative to the repo root, the form every other script resolves it from.
  const rel = `../marxy-wt/${key}`; const wt = resolve(ROOT, rel);
  if (!existsSync(wt)) git(['worktree', 'add', '-B', branch, wt, 'origin/main']);
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd: wt, stdio: 'inherit' });
  // A result left by the previous attempt would report this attempt as whatever that one was.
  const resultPath = here(`results/${key}.json`);
  rmSync(resultPath, { force: true });
  rec.status = 'in_progress'; rec.attempts += 1; rec.branch = branch; rec.worktree = rel; rec.model = role.model; rec.started = new Date().toISOString(); saveState(s);
  logDispatch({
    key,
    compute: m.compute ?? 'default',
    model: role.model,
    attempt: rec.attempts,
    escalation: role === m.implementorEscalation,
  });
  jira(['move', key, 'in_progress']);
  const notes = existsSync(here(`results/${key}.notes.md`)) ? `\n\n## Reviewer notes from the previous attempt\n\n${readFileSync(here(`results/${key}.notes.md`), 'utf8')}` : '';
  const story = ['Key', 'Summary', 'Labels', 'Paths', 'Description', 'Acceptance'].map(k => `- **${k}:** ${st[k] || '—'}`).join('\n') + notes;
  const prompt = tpl.replaceAll('{{STORY}}', story).replaceAll('{{KEY}}', key) + `\n\nWrite the result file to ${resultPath} (absolute path; the main worktree, not yours).`;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text']; if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  const log = here(`results/${key}.log`); const out = [];
  const child = spawn(bin, [...args, prompt], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => out.push(d));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, m.attemptMinutes * 60_000);
  const code = await new Promise(r => child.on('exit', r)); clearTimeout(timer);
  writeFileSync(log, Buffer.concat(out));
  let result = null;
  try { result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null; } catch { /* unreadable is failed */ }
  const s2 = state(); const r2 = s2.stories[key];
  // in_review is the only status the cycle reads for merging, and it needs the PR number to read it.
  if (result?.status === 'done' && Number(result.pr) > 0) {
    r2.status = 'in_review'; r2.pr = Number(result.pr); saveState(s2); jira(['pr', key, String(r2.pr)]);
  } else if (result?.status === 'blocked') {
    r2.status = 'blocked'; saveState(s2); jira(['move', key, 'blocked']);
  } else {
    r2.status = 'todo'; saveState(s2); jira(['move', key, 'todo']);
  }
  const succeeded = r2.status === 'in_review';
  if (!succeeded) {
    const reason = implementFailReason({ code, result, timedOut, attemptMinutes: m.attemptMinutes });
    logImplementFail({
      key,
      reason,
      model: role.model,
      compute: m.compute ?? 'default',
      attempt: r2.attempts,
      exitCode: code,
    });
  }
  const why = result?.status === 'done' && !(Number(result.pr) > 0) ? ' (result says done but names no PR)' : '';
  console.log(`${key}: exit ${code}, result ${result?.status ?? 'failed'}${why}, now ${r2.status}, log ${log}`);
});
const settled = await Promise.allSettled(runs);
settled.filter(r => r.status === 'rejected').forEach(r => console.error(String(r.reason)));
