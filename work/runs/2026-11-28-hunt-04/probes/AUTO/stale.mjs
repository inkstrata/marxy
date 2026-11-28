import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2];
const { runStale } = await import(pathToFileURL(join(repo, 'scripts/lib/stale-run.mjs')).href);
const { workspace, git } = await import(pathToFileURL(join(repo, 'scripts/lib/workspace.mjs')).href);
const t = mkdtempSync(join(tmpdir(), 'hunt-auto-'));
process.env.MARXY_STATE_DIR = join(t, 'state');
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=a@b.c', '-c', 'user.name=x', ...a], { encoding: 'utf8' });
sh(t, 'init', '--bare', '-b', 'main', 'origin.git');
const main = join(t, 'main'); sh(t, 'clone', 'origin.git', 'main');
writeFileSync(join(main, '.gitignore'), '.env\n'); writeFileSync(join(main, 'a.txt'), 'a');
sh(main, 'add', '-A'); sh(main, 'commit', '-m', 'init'); sh(main, 'push', 'origin', 'HEAD:main'); sh(main, 'branch', '-u', 'origin/main');
const wtDir = join(t, 'main-wt'); mkdirSync(wtDir);
// A: untracked, not ignored, under a folder named dist, plus one under target
sh(main, 'worktree', 'add', '-b', 'agent/a', join(wtDir, 'a'));
mkdirSync(join(wtDir, 'a', 'docs', 'dist'), { recursive: true });
writeFileSync(join(wtDir, 'a', 'docs', 'dist', 'notes.md'), 'REAL UNSAVED WORK');
writeFileSync(join(wtDir, 'a', 'newfile.md'), 'kept');
// B: only ignored file
sh(main, 'worktree', 'add', '-b', 'agent/b', join(wtDir, 'b'));
writeFileSync(join(wtDir, 'b', '.env'), 'SECRET_LOCAL=1');
const ws = workspace(main, { MARXY_WORKTREES: wtDir });
const r = runStale({ ws, root: main }, { apply: true, now: Date.now() + 60 * 864e5 });
console.log(r.lines.join('\n'), r.removed, r.archived);
console.log('a exists', existsSync(join(wtDir, 'a')), 'b exists', existsSync(join(wtDir, 'b')));
const arch = join(process.env.MARXY_STATE_DIR, 'archive', 'worktrees');
for (const d of readdirSync(arch)) { console.log(d); console.log(execFileSync('tar', ['-tf', 'untracked.tar'], { cwd: join(arch, d), encoding: 'utf8' })); }
