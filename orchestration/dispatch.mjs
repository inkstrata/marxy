// Run implementors headlessly through the Cursor CLI, one worktree per story, in parallel.
// usage: node dispatch.mjs KEY [KEY…]   (env CURSOR_AGENT overrides the binary name)
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { ROOT, here, stories, state, saveState, models, slug, typeOf } from './lib.mjs';
const keys = process.argv.slice(2).filter(a => !a.startsWith('--')); if (!keys.length) { console.error('usage: dispatch.mjs KEY… [--low|--minimal|--compute=NAME]'); process.exit(2); }
const m = models(); const bin = process.env.CURSOR_AGENT || 'cursor-agent';
const tpl = readFileSync(here('prompts/implementor.md'), 'utf8');
const wtRoot = `${ROOT}../marxy-wt`; mkdirSync(wtRoot, { recursive: true }); mkdirSync(here('results'), { recursive: true });
const runs = keys.map(async key => {
  const st = stories().find(x => x.Key === key); if (!st) throw new Error(`unknown ${key}`);
  const s = state(); const rec = s.stories[key] ??= { status: 'todo', attempts: 0 };
  const role = rec.attempts >= m.maxAttempts ? m.implementorEscalation : m.implementor;
  const branch = `${typeOf(st)}/${key}-${slug(st.Summary)}`; const wt = `${wtRoot}/${key}`;
  if (!existsSync(wt)) execSync(`git -C "${ROOT}" worktree add -B "${branch}" "${wt}" main`, { stdio: 'inherit' });
  execSync(`cd "${wt}" && pnpm install --frozen-lockfile --silent`, { stdio: 'inherit' });
  rec.status = 'in_progress'; rec.attempts += 1; rec.branch = branch; rec.worktree = wt; rec.model = role.model; saveState(s);
  const notes = existsSync(here(`results/${key}.notes.md`)) ? `\n\n## Reviewer notes from the previous attempt\n\n${readFileSync(here(`results/${key}.notes.md`), 'utf8')}` : '';
  const story = ['Key', 'Summary', 'Labels', 'Paths', 'Description', 'Acceptance'].map(k => `- **${k}:** ${st[k] || '—'}`).join('\n') + notes;
  const prompt = tpl.replaceAll('{{STORY}}', story).replaceAll('{{KEY}}', key) + `\n\nWrite the result file to ${here(`results/${key}.json`)} (absolute path; the main worktree, not yours).`;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text']; if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  const log = here(`results/${key}.log`); const out = [];
  const child = spawn(bin, [...args, prompt], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => out.push(d));
  const timer = setTimeout(() => child.kill('SIGTERM'), m.attemptMinutes * 60_000);
  const code = await new Promise(r => child.on('exit', r)); clearTimeout(timer);
  writeFileSync(log, Buffer.concat(out));
  const resultPath = here(`results/${key}.json`);
  const status = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')).status : 'failed';
  const s2 = state(); s2.stories[key].status = status === 'done' ? 'review' : status === 'blocked' ? 'blocked' : 'todo'; saveState(s2);
  console.log(`${key}: exit ${code}, result ${status}, log ${log}`);
});
await Promise.allSettled(runs);
