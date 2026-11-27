// The work around the checkout, as one command: `pnpm work [command]`.
//   status      where things stand: the base, branches not yet in it, worktrees to clear, the tracker, the newest build
//   init        make the worktrees and builds folders, and work/todo.md if the tree has none
//   start       a new piece of work: a branch and a worktree for it, with dependencies installed
//   list        every worktree with its branch, state and uncommitted changes
//   clean       remove the worktrees and branches whose work is in the base (lists them; --apply does it)
//   todo        the tracker's open rows; --check compares them with the branches
//   installer   build, keep and install the app from a ref (scripts/installer-macos.mjs, scripts/installer-windows.ps1)
//   ask         questions for the owner, answered on a page (scripts/ask.mjs)
// usage: node scripts/work.mjs [status|init|start <name>|list|clean|todo|installer|ask] [options]; --help lists them
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askMain } from './ask.mjs';
import { crossCheck, parseTodo, TEMPLATE } from './lib/todo.mjs';
import { BRANCH_PREFIX, branchFacts, branchState, git, unstarted, workspace } from './lib/workspace.mjs';

export const SCRIPT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const COMMANDS = ['status', 'init', 'start', 'list', 'clean', 'todo', 'installer', 'ask'];

const USAGE = `usage: pnpm work [command] [options]
  status                         the base, open branches, worktrees to clear, the tracker, the newest build (the default)
  init                           make <checkout>-wt/ and builds/, and work/todo.md if the tree has none
  start <name> [--from <ref>] [--no-install]
                                 branch ${BRANCH_PREFIX}<name> and worktree <checkout>-wt/<name>, cut from --from (default: the base)
  list [--dirty]                 every worktree: branch, state, and with --dirty its uncommitted changes
  clean [--apply] [--keep a,b]   worktrees and branches whose commits are all in the base; nothing is removed without --apply
  todo [--check] [--file <path>] the tracker's rows; --check fails on a repeated id or a row whose branch has landed
  installer [<arguments>]        scripts/installer-macos.mjs (macOS) or installer-windows.ps1 (Windows) with the workspace's paths; what follows goes to it as is
  ask [<command>] [<set>]        questions for the owner on a page, and their answers (pnpm work ask --help); what follows goes to it as is
options for every command (before installer or ask, not after): --base <ref> (default main), --root <dir> (another tree of the same repository)`;

/** Parsed command line; throws an Error with a message for a bad one. */
export function parseArgs(argv) {
  const o = { command: 'status', name: null, base: 'main', root: null, from: null, install: true, dirty: false, apply: false, keep: [], check: false, file: null, rest: [], help: false };
  const dashes = argv.indexOf('--');
  if (dashes >= 0) {
    o.rest = argv.slice(dashes + 1);
    argv = argv.slice(0, dashes);
  }
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    // Everything after `installer` or `ask` is that tool's own, with or without a `--` (pnpm 11 drops it).
    if ((a === 'installer' || a === 'ask') && !positional.length) {
      o.command = a;
      o.rest = [...argv.slice(i + 1), ...(dashes >= 0 ? ['--', ...o.rest] : [])];
      if (o.rest[0] === '--') o.rest.shift();
      return o;
    }
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const take = () => {
      if (inline !== null) return inline;
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--base': o.base = take(); break;
      case '--root': o.root = take(); break;
      case '--from': o.from = take(); break;
      case '--file': o.file = take(); break;
      case '--keep': o.keep = take().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--no-install': o.install = false; break;
      case '--dirty': o.dirty = true; break;
      case '--apply': o.apply = true; break;
      case '--check': o.check = true; break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
        positional.push(a);
    }
  }
  if (positional.length) o.command = positional.shift();
  if (!COMMANDS.includes(o.command)) throw new Error(`unknown command ${o.command}; the commands are ${COMMANDS.join(', ')}`);
  if (o.command === 'start') {
    o.name = positional.shift() ?? null;
    if (!o.name) throw new Error('start needs a name');
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(o.name)) throw new Error(`a name is lower-case letters, digits and hyphens, not ${o.name}`);
  }
  if (positional.length) throw new Error(`unexpected argument ${positional[0]}`);
  return o;
}

const pad = (s, n) => String(s).padEnd(n);
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const short = sha => sha.slice(0, 8);

/**
 * Each worktree with its branch's state against the base. The main checkout is 'main'; one on no branch is 'detached'.
 * A merged branch nothing was ever committed on is 'unstarted' (`isUnstarted(branch)`): it was cut before the base moved.
 */
export function describeTrees(trees, facts, isUnstarted = () => false) {
  return trees.map((t, i) => {
    let state = i === 0 ? 'main' : t.prunable ? 'gone' : t.branch === null ? 'detached' : branchState(t.branch, t.head, facts);
    if (state === 'merged' && isUnstarted(t.branch)) state = 'unstarted';
    return { ...t, name: basename(t.path), state };
  });
}

/** What `clean` would remove: worktrees whose branch is merged, and merged branches with no worktree. Only prefixed branches. */
export function cleanPlan(described, facts, keep = [], isUnstarted = () => false) {
  const kept = new Set(keep);
  const ours = b => b?.startsWith(BRANCH_PREFIX) && !kept.has(b) && !kept.has(b.slice(BRANCH_PREFIX.length));
  const trees = described.filter(t => t.state === 'merged' && ours(t.branch) && !kept.has(t.name));
  const held = new Set(described.map(t => t.branch).filter(Boolean));
  const branches = [...facts.heads]
    .filter(([name, sha]) => ours(name) && !held.has(name) && branchState(name, sha, facts) === 'merged' && !isUnstarted(name))
    .map(([name]) => name)
    .sort();
  return { trees, branches };
}

function statusOf(path) {
  return new Promise(done => {
    execFile('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
      done(err ? null : out.split(/\r?\n/).filter(Boolean));
    });
  });
}

/** Uncommitted changes of each path (null when git could not say), a few at a time: a status walks the whole tree. */
async function statuses(paths, jobs = 6) {
  const out = new Map();
  const queue = [...paths];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) out.set(p, await statusOf(p));
  }));
  return out;
}

function newestBuild(dir) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d{8}-\d{4}-/.test(e.name)).map(e => e.name).sort();
  return names.at(-1) ?? null;
}

function readTodo(path) {
  return existsSync(path) ? parseTodo(readFileSync(path, 'utf8')) : null;
}

const stateOfBranch = facts => name => {
  const full = `${BRANCH_PREFIX}${name}`;
  return facts.heads.has(full) ? branchState(full, facts.heads.get(full), facts) : null;
};

async function status(ctx) {
  const { ws, facts, trees } = ctx;
  const subject = git(ctx.root, 'log', '-1', '--format=%s', facts.base).trim();
  console.log(`checkout   ${ws.main}`);
  console.log(`worktrees  ${ws.worktrees}`);
  console.log(`${pad(facts.base, 10)} ${short(facts.baseSha)}  ${subject}`);
  const byBranch = new Map(trees.filter(t => t.branch).map(t => [t.branch, t]));
  const open = [...facts.heads].filter(([n, sha]) => branchState(n, sha, facts) === 'open').map(([n]) => n).sort();
  const dirt = await statuses(open.map(n => byBranch.get(n)?.path).filter(Boolean));
  console.log(`open       ${open.length} branch${open.length === 1 ? '' : 'es'} with commits ${facts.base} lacks`);
  for (const n of open) {
    const ahead = git(ctx.root, 'rev-list', '--count', `${facts.base}..${n}`).trim();
    const tree = byBranch.get(n);
    const changes = tree ? dirt.get(tree.path) : null;
    const where = tree ? relative(ws.dir, tree.path) : 'no worktree';
    console.log(`  ${pad(n, 30)} ${pad(`${ahead} ahead`, 10)} ${pad(where, 28)} ${tree ? (changes?.length ? `${changes.length} uncommitted` : 'clean') : ''}`);
  }
  const count = s => trees.filter(t => t.state === s).length;
  const plan = cleanPlan(trees, facts, [], ctx.isUnstarted);
  if (count('unstarted')) console.log(`unstarted  ${trees.filter(t => t.state === 'unstarted').map(t => t.name).join(', ')}: cut from an earlier ${facts.base}, nothing committed yet`);
  if (count('at-base')) console.log(`at ${pad(facts.base, 7)} ${count('at-base')} worktrees on ${facts.base}'s commit: new, or fast-forwarded into it`);
  if (plan.trees.length || plan.branches.length) console.log(`merged     ${plan.trees.length} worktrees and ${plan.branches.length} bare branches are in ${facts.base}: pnpm work clean`);
  if (count('detached')) console.log(`detached   ${trees.filter(t => t.state === 'detached').map(t => t.name).join(', ')}`);
  if (count('gone')) console.log(`gone       ${count('gone')} worktrees whose folder is missing: git worktree prune`);
  const rows = readTodo(ws.todo);
  if (!rows) console.log(`todo       no tracker at ${ws.todo}: pnpm work init`);
  else {
    const x = crossCheck(rows, stateOfBranch(facts));
    console.log(`todo       ${rows.length} rows: ${x.inFlight.length} in flight, ${x.waiting.length} waiting${x.landed.length ? `, ${x.landed.length} landed and still listed (pnpm work todo --check)` : ''}`);
  }
  const build = newestBuild(ws.builds);
  console.log(`builds     ${build ? `newest ${build}` : `none in ${ws.builds}`}`);
  return 0;
}

function init(ctx) {
  const { ws } = ctx;
  for (const dir of [ws.worktrees, ws.builds, ws.work]) {
    if (existsSync(dir)) console.log(`exists   ${dir}`);
    else {
      mkdirSync(dir, { recursive: true });
      console.log(`made     ${dir}`);
    }
  }
  if (existsSync(ws.todo)) console.log(`exists   ${ws.todo}`);
  else {
    writeFileSync(ws.todo, TEMPLATE);
    console.log(`wrote    ${ws.todo}`);
  }
  return 0;
}

function pnpmInstall(cwd) {
  // pnpm is a .cmd shim on Windows; these arguments have no spaces or shell characters.
  const win = process.platform === 'win32';
  const args = ['install', '--offline', '--frozen-lockfile'];
  const r = win ? spawnSync(['pnpm', ...args].join(' '), { cwd, stdio: 'inherit', shell: true }) : spawnSync('pnpm', args, { cwd, stdio: 'inherit' });
  return r.status === 0;
}

function start(ctx, o) {
  const { ws, facts } = ctx;
  const branch = `${BRANCH_PREFIX}${o.name}`;
  const path = join(ws.worktrees, o.name);
  const from = o.from ?? facts.base;
  if (facts.heads.has(branch)) throw new Error(`branch ${branch} exists already`);
  if (existsSync(path)) throw new Error(`${path} exists already`);
  mkdirSync(ws.worktrees, { recursive: true });
  git(ws.main, 'worktree', 'add', '-b', branch, path, from);
  const at = short(git(path, 'rev-parse', 'HEAD').trim());
  console.log(`branch   ${branch}, cut from ${from} (${at})`);
  console.log(`worktree ${path}`);
  if (o.install && !pnpmInstall(path)) {
    console.log('pnpm install --offline failed; run pnpm install in the worktree');
    return 1;
  }
  console.log(`next     work there; pnpm verify --tier changed${from === facts.base ? '' : ` --base ${from}`} before you call it done`);
  return 0;
}

async function list(ctx, o) {
  const { ws, trees } = ctx;
  const dirt = o.dirty ? await statuses(trees.filter(t => t.state !== 'gone').map(t => t.path)) : null;
  for (const t of trees) {
    const changes = dirt?.get(t.path);
    const tail = !dirt ? '' : changes === null || changes === undefined ? '?' : changes.length ? `${changes.length} uncommitted` : 'clean';
    console.log(`${pad(relative(ws.dir, t.path) || '.', 30)} ${pad(t.branch ?? '(detached)', 30)} ${pad(short(t.head), 9)} ${pad(t.state, 9)} ${tail}`);
  }
  const tally = {};
  for (const t of trees) tally[t.state] = (tally[t.state] ?? 0) + 1;
  console.log(`\n${trees.length} worktrees: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return 0;
}

function removeTree(main, path) {
  const r = spawnSync('git', ['-C', main, 'worktree', 'remove', path], { encoding: 'utf8' });
  if (r.status === 0) return;
  // git stops part-way on a deep node_modules or a build folder on Windows; the tree was checked clean, so the rest goes too.
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  git(main, 'worktree', 'prune');
}

async function clean(ctx, o) {
  const { ws, facts, trees } = ctx;
  const plan = cleanPlan(trees, facts, o.keep, ctx.isUnstarted);
  const dirt = await statuses(plan.trees.map(t => t.path));
  const removable = [];
  const skipped = [];
  for (const t of plan.trees) {
    const changes = dirt.get(t.path);
    if (same(t.path, ctx.root)) skipped.push([t, 'this command is running in it']);
    else if (changes === null || changes === undefined) skipped.push([t, 'git could not read its state']);
    else if (changes.length) skipped.push([t, `${changes.length} uncommitted: ${changes.slice(0, 3).map(l => l.slice(3)).join(', ')}${changes.length > 3 ? ', ...' : ''}`]);
    else removable.push(t);
  }
  const verb = o.apply ? 'removed ' : 'would go';
  let failed = 0;
  for (const t of removable) {
    if (o.apply) {
      try {
        removeTree(ws.main, t.path);
        git(ws.main, 'branch', '-d', t.branch);
      } catch (e) {
        failed++;
        console.log(`FAILED   ${pad(relative(ws.dir, t.path), 30)} ${String(e.stderr || e.message).trim().split('\n')[0]}`);
        continue;
      }
    }
    console.log(`${verb} ${pad(relative(ws.dir, t.path), 30)} ${t.branch}`);
  }
  for (const b of plan.branches) {
    if (o.apply) {
      try {
        git(ws.main, 'branch', '-d', b);
      } catch (e) {
        failed++;
        console.log(`FAILED   ${pad('(branch only)', 30)} ${b}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
        continue;
      }
    }
    console.log(`${verb} ${pad('(branch only)', 30)} ${b}`);
  }
  for (const [t, why] of skipped) console.log(`kept     ${pad(relative(ws.dir, t.path), 30)} ${t.branch}: ${why}`);
  const total = removable.length + plan.branches.length;
  console.log(`\n${removable.length} worktrees and ${plan.branches.length} bare branches ${o.apply ? 'removed' : `are in ${facts.base}`}; ${skipped.length} kept${failed ? `; ${failed} failed` : ''}${!o.apply && total ? '\nnothing was removed: pnpm work clean --apply' : ''}`);
  return failed ? 1 : 0;
}

function todo(ctx, o) {
  const path = o.file ? resolve(o.file) : ctx.ws.todo;
  const rows = readTodo(path);
  if (!rows) {
    console.log(`no tracker at ${path}: pnpm work init`);
    return 1;
  }
  const state = stateOfBranch(ctx.facts);
  let section = null;
  for (const r of rows) {
    if (r.section !== section) console.log(`${section === null ? '' : '\n'}${r.section}`);
    section = r.section;
    const marks = r.branches.map(b => `${b}: ${state(b) ?? 'no branch yet'}`).join(', ');
    const what = r.what.length > 78 ? `${r.what.slice(0, 75)}...` : r.what;
    console.log(`  ${pad(r.id, 5)} ${pad(what, 78)} ${marks}`);
  }
  const x = crossCheck(rows, state);
  console.log(`\n${rows.length} rows: ${x.inFlight.length} in flight, ${x.waiting.length} waiting, ${x.landed.length} landed`);
  if (!o.check) return 0;
  for (const d of x.duplicates) console.log(`✗ ${d.id} is used on lines ${d.lines.join(' and ')}`);
  for (const r of x.landed) console.log(`✗ ${r.id} (line ${r.line}): ${r.branches.join(', ')} is in ${ctx.facts.base}; remove the row`);
  const problems = x.duplicates.length + x.landed.length;
  console.log(problems ? `todo: ${problems} to fix in ${path}` : 'todo: the tracker and the branches agree');
  return problems ? 1 : 0;
}

function installer(ctx, o) {
  const { ws } = ctx;
  if (process.platform === 'darwin') {
    const script = join(SCRIPT_ROOT, 'scripts', 'installer-macos.mjs');
    const args = [script, '--repo', ws.main, '--worktree', join(ws.worktrees, 'app'), '--out', ws.builds, ...o.rest];
    return spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1;
  }
  if (process.platform !== 'win32') {
    console.log('installer: macOS and Windows only; elsewhere run pnpm --filter @marxy/desktop bundle');
    return 1;
  }
  const script = join(SCRIPT_ROOT, 'scripts', 'installer-windows.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Repo', ws.main, '-Worktree', join(ws.worktrees, 'exe'), '-OutRoot', ws.builds, ...o.rest];
  return spawnSync('powershell', args, { stdio: 'inherit' }).status ?? 1;
}

export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`work: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  const root = resolve(o.root ?? SCRIPT_ROOT);
  try {
    const ws = workspace(root);
    if (o.command === 'init') return init({ root, ws });
    if (o.command === 'installer') return installer({ root, ws }, o);
    if (o.command === 'ask') return await askMain(o.rest, root);
    const facts = branchFacts(root, o.base);
    const isUnstarted = name => unstarted(root, name);
    const ctx = { root, ws, facts, isUnstarted, trees: describeTrees(ws.trees, facts, isUnstarted) };
    if (o.command === 'start') return start(ctx, o);
    if (o.command === 'list') return await list(ctx, o);
    if (o.command === 'clean') return await clean(ctx, o);
    if (o.command === 'todo') return todo(ctx, o);
    return await status(ctx);
  } catch (e) {
    console.error(`work: ${String(e.stderr || e.message).trim()}`);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
