// Builds Marxy.app from a ref, checks its seal, keeps a copy, installs it, registers it with Launch Services and
// puts a `marxy` command on the PATH. The macOS counterpart of installer-windows.ps1. Run it as
// `pnpm work installer [-- <arguments>]`, which passes the workspace's paths; run alone it takes them from where
// this file is.
//   --ref <branch or commit>   what to build (default origin/main after a fetch, else main); main is merged in when
//                              the ref lacks it
//   --dmg                      also make the DMG (tauri's DMG step drives Finder, so it is off by default)
//   --dest <dir>               where to install (default /Applications, or ~/Applications when that is not writable)
//   --cli-dir <dir>            where the `marxy` command goes (default ~/.local/bin when it is on the PATH)
//   --no-install               stop once the copy is kept
//   --no-cli                   install without writing the `marxy` command
//   --no-launch                install without opening the app
// The Windows spellings -Ref, -NoInstall and -NoLaunch are accepted too.
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = 'Marxy.app';
export const BUNDLE_ID = 'dev.marxy.app';
export const SHIM_MARK = "Written by marxy's scripts/installer-macos.mjs";
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const HERE = dirname(fileURLToPath(import.meta.url));

/** Parsed arguments; throws an Error with a message for a bad one. */
export function parseInstallerArgs(argv) {
  const o = { ref: null, dmg: false, dest: null, cliDir: null, install: true, cli: true, launch: true, repo: null, worktree: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') && argv[i].includes('=') ? argv[i].split(/=(.*)/s, 2) : [argv[i], null];
    const take = () => {
      if (inline !== null) return inline;
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--ref': case '-Ref': o.ref = take(); break;
      case '--dmg': o.dmg = true; break;
      case '--dest': o.dest = take(); break;
      case '--cli-dir': o.cliDir = take(); break;
      case '--no-install': case '-NoInstall': o.install = false; break;
      case '--no-cli': o.cli = false; break;
      case '--no-launch': case '-NoLaunch': o.launch = false; break;
      case '--repo': case '-Repo': o.repo = take(); break;
      case '--worktree': case '-Worktree': o.worktree = take(); break;
      case '--out': case '-OutRoot': o.out = take(); break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return o;
}

/** `builds/` folder name for a build: the same `<yyyymmdd>-<hhmm>-<commit>` shape `pnpm work status` looks for. */
export function buildFolderName(date, sha) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}-${sha}`;
}

/** Where to install: `--dest`, else /Applications when Marxy is already there or it is writable, else ~/Applications. */
export function pickDest(dest, { home = homedir(), exists = existsSync, writable = isWritable } = {}) {
  if (dest) return resolve(dest);
  if (exists(join('/Applications', APP)) || writable('/Applications')) return '/Applications';
  return join(home, 'Applications');
}

/** Where the `marxy` command goes: `--cli-dir`, else ~/.local/bin when it is on the PATH, else nowhere (null). */
export function pickCliDir(cliDir, { home = homedir(), path = process.env.PATH ?? '' } = {}) {
  if (cliDir) return resolve(cliDir);
  const local = join(home, '.local', 'bin');
  return path.split(delimiter).some(d => d && resolve(d) === local) ? local : null;
}

/** The `marxy` command: opens its arguments in the installed app through Launch Services, as Finder would. */
export function shimText(appPath) {
  const q = `'${appPath.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh
# marxy: open files in the installed Marxy. ${SHIM_MARK}; run it again to update, delete this file to remove.
app=${q}
if [ ! -d "$app" ]; then echo "marxy: $app is not installed" >&2; exit 1; fi
if [ "$#" -eq 0 ]; then exec open "$app"; fi
exec open -a "$app" "$@"
`;
}

/** True when `path` is free to write the command to: absent, or a command this script wrote. */
export function shimIsOurs(path, read = p => readFileSync(p, 'utf8')) {
  if (!existsSync(path)) return true;
  try {
    return read(path).includes(SHIM_MARK);
  } catch {
    return false;
  }
}

/**
 * Bundle paths that `lsregister -dump` lists for `id`, other than `keep`: build folders, old worktrees, mounted DMGs
 * and paths long gone. Any of them can answer Finder's Open With in place of the installed copy.
 */
export function otherRegistrations(dump, keep, id = BUNDLE_ID) {
  const found = new Set();
  let path = null;
  for (const line of dump.split('\n')) {
    if (/^-{10,}/.test(line)) path = null;
    const p = /^path:\s+(.*?)(?: \(0x[0-9a-f]+\))?\s*$/.exec(line);
    if (p) path = p[1];
    const i = /^identifier:\s+(\S+)/.exec(line);
    if (!i || !path) continue;
    // Only a record's own first identifier names its bundle; later ones belong to records nested in it.
    if (i[1] === id && resolve(path) !== resolve(keep)) found.add(path);
    path = null;
  }
  return [...found].sort();
}

function isWritable(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const step = m => console.log(`\n== ${m}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status ?? r.signal ?? r.error?.message})`);
}
const out = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryOut = (cmd, args, opts) => {
  try {
    return out(cmd, args, opts);
  } catch {
    return null;
  }
};
const git = (repo, ...args) => out('git', ['-C', repo, ...args]);
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** PIDs of processes running the app at `appPath` (only that copy: dev builds run from target folders). */
function pidsOf(appPath) {
  const list = tryOut('pgrep', ['-f', `${appPath}/Contents/MacOS/`]);
  return list ? list.split('\n').map(Number).filter(Boolean) : [];
}

/** A polite quit first, so the app saves its layout; a TERM, then a KILL, only if it does not exit. */
function quitInstalled(appPath) {
  if (!pidsOf(appPath).length) return;
  console.log(`asking ${appPath} to quit`);
  spawnSync('osascript', ['-e', `tell application "${appPath}" to quit`], { stdio: 'ignore', timeout: 10_000 });
  for (const signal of [null, 'SIGTERM', 'SIGKILL']) {
    if (signal) for (const pid of pidsOf(appPath)) try { process.kill(pid, signal); } catch {}
    for (let t = 0; t < 16 && pidsOf(appPath).length; t++) sleep(500);
    if (!pidsOf(appPath).length) return;
  }
  throw new Error(`${appPath} is still running`);
}

/** Proves the bundle is sealed (an unsealed ad-hoc bundle is killed on launch on Apple silicon) and says what it is. */
function checkBundle(appPath) {
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  // codesign -dv writes its report to stderr.
  const details = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' }).stderr ?? '';
  if (!/Sealed Resources/.test(details)) throw new Error(`${appPath} has no sealed resources`);
  const plist = join(appPath, 'Contents', 'Info.plist');
  const id = out('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist]);
  if (id !== BUNDLE_ID) throw new Error(`${appPath} is ${id}, not ${BUNDLE_ID}`);
  const version = out('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]);
  const types = Number(out('plutil', ['-extract', 'CFBundleDocumentTypes', 'raw', plist]));
  if (!(types > 0)) throw new Error(`${appPath} declares no document types, so Finder cannot open files with it`);
  const signature = /Signature=(\S+)/.exec(details)?.[1] ?? 'unknown';
  console.log(`sealed: ${appPath} (${id} ${version}, ${types} document types, signature ${signature})`);
  return { version, signature };
}

function newest(dir, pattern, since) {
  if (!existsSync(dir)) return null;
  const hits = readdirSync(dir).filter(n => pattern.test(n)).map(n => join(dir, n)).filter(p => statSync(p).mtimeMs >= since - 5000);
  return hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

export function installerMain(argv) {
  const o = parseInstallerArgs(argv);
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^\/\/ ?/gm, ''));
    return 0;
  }
  if (process.platform !== 'darwin') throw new Error('installer-macos: macOS only');
  const repo = resolve(o.repo ?? join(HERE, '..'));
  const worktree = resolve(o.worktree ?? `${repo}-wt/app`);
  const outRoot = resolve(o.out ?? join(repo, 'builds'));

  // --- which source -----------------------------------------------------------------------------------------------
  step('Resolving the source');
  if (spawnSync('git', ['-C', repo, 'fetch', '--quiet', 'origin'], { stdio: 'inherit' }).status !== 0) console.log('fetch failed; building from local refs');
  const mainRef = tryOut('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', 'origin/main^{commit}']) ? 'origin/main' : 'main';
  const ref = o.ref ?? mainRef;
  // Pinned once: other work moves these refs, and a build must be of the commits it reports.
  const refFull = tryOut('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!refFull) throw new Error(`no such ref: ${ref}`);
  const mainFull = git(repo, 'rev-parse', `${mainRef}^{commit}`);
  console.log(`ref ${ref} (${refFull.slice(0, 7)}), ${mainRef} ${mainFull.slice(0, 7)}`);

  // --- the build worktree (this script's own; never edit it by hand) ------------------------------------------------
  step(`Preparing ${worktree}`);
  if (!existsSync(join(worktree, '.git'))) run('git', ['-C', repo, 'worktree', 'add', '--detach', worktree, mainFull]);
  if (git(worktree, 'status', '--porcelain', '--untracked-files=no')) throw new Error(`${worktree} has local changes; it belongs to this script. Inspect it, then clean it.`);
  if (tryOut('git', ['-C', worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'])) run('git', ['-C', worktree, 'merge', '--abort']);
  run('git', ['-C', worktree, 'checkout', '--quiet', '--detach', refFull]);
  // A ref that already contains main needs no merge. Otherwise main comes in so the build has every fix already
  // landed; the merge commit is detached and on no branch.
  if (spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', mainFull, refFull]).status !== 0) {
    const m = spawnSync('git', ['-C', worktree, 'merge', '--no-edit', '--no-ff', '-m', `local build: merge ${mainRef} (${mainFull.slice(0, 7)}) into ${ref} (${refFull.slice(0, 7)})`, mainFull], { stdio: 'inherit' });
    if (m.status !== 0) {
      spawnSync('git', ['-C', worktree, 'merge', '--abort'], { stdio: 'ignore' });
      throw new Error(`${ref} does not merge cleanly with ${mainRef}; build ${mainRef}, or merge it into the branch first`);
    }
  }
  const buildSha = git(worktree, 'rev-parse', '--short=7', 'HEAD');

  step('Installing dependencies');
  if (spawnSync('pnpm', ['install', '--frozen-lockfile', '--offline'], { cwd: worktree, stdio: 'inherit' }).status !== 0) {
    console.log('offline install failed; trying online');
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree });
  }

  // --- build ------------------------------------------------------------------------------------------------------
  step(`Building ${APP}${o.dmg ? ' and the DMG' : ''} (a cold Rust release build takes a while)`);
  const desktop = join(worktree, 'apps', 'desktop');
  const started = Date.now();
  run('pnpm', ['build:web'], { cwd: desktop });
  run(join(desktop, 'node_modules', '.bin', 'tauri'), ['build', '--bundles', o.dmg ? 'app,dmg' : 'app', '--', '--locked'], { cwd: desktop });
  const bundleDir = join(desktop, 'src-tauri', 'target', 'release', 'bundle');
  const built = join(bundleDir, 'macos', APP);
  if (!existsSync(built) || statSync(built).mtimeMs < started - 5000) throw new Error(`no new ${APP} in ${dirname(built)}`);
  const dmg = o.dmg ? newest(join(bundleDir, 'dmg'), /\.dmg$/, started) : null;
  if (o.dmg && !dmg) throw new Error(`no new DMG in ${join(bundleDir, 'dmg')}`);

  step('Checking the bundle');
  const { version, signature } = checkBundle(built);

  // --- keep a copy (zipped, so Launch Services never registers it) --------------------------------------------------
  const kept = join(outRoot, buildFolderName(new Date(), buildSha));
  mkdirSync(kept, { recursive: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', built, join(kept, `${APP}.zip`)]);
  if (dmg) copyFileSync(dmg, join(kept, basename(dmg)));
  const lines = [
    `ref:       ${ref} (${refFull.slice(0, 7)})`,
    `main:      ${mainRef} (${mainFull.slice(0, 7)})`,
    `built:     ${buildSha}${buildSha !== refFull.slice(0, 7) ? ` (local merge of ${mainRef} into the ref)` : ''}`,
    `version:   ${version}`,
    `signature: ${signature}`,
    `date:      ${new Date().toISOString()}`,
  ];
  writeFileSync(join(kept, 'BUILD.txt'), `${lines.join('\n')}\n`);
  console.log(`kept in ${kept}`);

  if (!o.install) {
    step('Done');
    return 0;
  }

  // --- install ----------------------------------------------------------------------------------------------------
  const dest = pickDest(o.dest);
  const installed = join(dest, APP);
  step(`Installing to ${installed}`);
  mkdirSync(dest, { recursive: true });
  quitInstalled(installed);
  // Staged beside the target (same volume, so the swap is two renames) under names Launch Services does not
  // take for bundles.
  const staged = join(dest, `${APP}.installing`);
  const old = join(dest, `${APP}.previous`);
  rmSync(staged, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  run('ditto', [built, staged]);
  if (existsSync(installed)) renameSync(installed, old);
  renameSync(staged, installed);
  rmSync(old, { recursive: true, force: true });
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', installed], { stdio: 'ignore' });
  checkBundle(installed);
  // Register the installed copy now, so Finder's Open With and the file-type defaults see this build at once, and
  // forget every other copy: the build folder (registered by the system shortly after it is written), old
  // worktrees and DMGs once mounted.
  // The build folder's bundle goes (the zip keeps it; the Rust build cache stays), since the system would register it
  // again after any sweep. A path can hold more than one record, so sweep until none is left.
  run(LSREGISTER, ['-f', installed]);
  rmSync(built, { recursive: true, force: true });
  const swept = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const others = otherRegistrations(out(LSREGISTER, ['-dump'], { maxBuffer: 1 << 30 }), installed);
    if (!others.length) break;
    for (const p of others) {
      spawnSync(LSREGISTER, ['-u', p], { stdio: 'ignore' });
      swept.add(p);
    }
  }
  if (swept.size) console.log(`unregistered ${swept.size} other ${APP} cop${swept.size === 1 ? 'y' : 'ies'} from Launch Services`);

  if (o.cli) {
    const cliDir = pickCliDir(o.cliDir);
    if (!cliDir) {
      console.log('marxy command: skipped, ~/.local/bin is not on the PATH (pass --cli-dir <dir>)');
    } else {
      const shim = join(cliDir, 'marxy');
      if (!shimIsOurs(shim)) {
        console.log(`marxy command: skipped, ${shim} exists and was not written by this script`);
      } else {
        mkdirSync(cliDir, { recursive: true });
        writeFileSync(shim, shimText(installed), { mode: 0o755 });
        console.log(`marxy command: ${shim}`);
      }
    }
  }

  if (o.launch) {
    run('open', [installed]);
    console.log(`opened ${installed}`);
  }
  step('Done');
  console.log(`installed ${installed} (${buildSha}); copy in ${kept}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = installerMain(process.argv.slice(2));
  } catch (e) {
    console.error(`installer: ${e.message}`);
    process.exitCode = 1;
  }
}
