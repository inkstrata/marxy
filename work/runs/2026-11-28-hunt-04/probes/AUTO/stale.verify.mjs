import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2];
const { runStale } = await import(pathToFileURL(join(repo, 'scripts/lib/stale-run.mjs')).href);
const { workspace } = await import(pathToFileURL(join(repo, 'scripts/lib/workspace.mjs')).href);
const t = mkdtempSync(join(tmpdir(), 'verify-auto-'));
process.env.MARXY_STATE_DIR = join(t, 'state');
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=a@b.c', '-c', 'user.name=x', ...a], { encoding: 'utf8' });
sh(t, 'init', '--bare', '-b', 'main', 'origin.git');
sh(t, 'clone', 'origin.git', 'main'); const main = join(t, 'main');
writeFileSync(join(main, 'a.txt'), 'a'); sh(main, 'add', '-A'); sh(main, 'commit', '-m', 'init'); sh(main, 'push', 'origin', 'HEAD:main'); sh(main, 'branch', '-u', 'origin/main');
const wtDir = join(t, 'main-wt'); mkdirSync(wtDir);
sh(main, 'worktree', 'add', '-b', 'agent/a', join(wtDir, 'a'));
const w = join(wtDir, 'a');
// untracked and NOT ignored (no .gitignore here)
for (const d of ['target', 'dist']) { mkdirSync(join(w, 'src', d), { recursive: true }); writeFileSync(join(w, 'src', d, 'unsaved.rs'), 'UNSAVED ' + d); }
console.log('git sees untracked:', sh(w, 'status', '--porcelain', '-uall').trim().split('\n').join(' | '));
const ws = workspace(main, { MARXY_WORKTREES: wtDir });
const r = runStale({ ws, root: main }, { apply: true, now: Date.now() + 60 * 864e5 });
console.log(r.lines.join('\n'));
console.log('worktree exists after:', existsSync(w));
const arch = join(process.env.MARXY_STATE_DIR, 'archive', 'worktrees');
console.log('archives:', existsSync(arch) ? readdirSync(arch).map(d => d + ': ' + readdirSync(join(arch, d)).join(',')) : 'none');
