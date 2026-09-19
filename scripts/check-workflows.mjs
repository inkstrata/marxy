// Which third-party code runs in our CI. usage: node scripts/check-workflows.mjs
//
// A GitHub Action runs with the workflow's token on the machine that builds what we ship, so each one
// is a dependency in the most sensitive position we have. MARXY-74 added a caching action for apt
// packages; it restored files without their pkg-config metadata and every Rust build on the Linux
// runner failed, which is the cheap version of what a bad action can do. The list below is the set we
// accept, each pinned to a major version, and anything else fails this check rather than arriving with
// a pull request nobody read closely.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix } from './lib/repo.mjs';

const ALLOWED = new Set([
  'actions/checkout',
  'actions/cache',
  'actions/upload-artifact',
  'actions/download-artifact',
  'actions/github-script',
  'jdx/mise-action',
  'dtolnay/rust-toolchain',
  'Swatinem/rust-cache',
  'softprops/action-gh-release',
  // The Tauri project's own action, building the thing it maintains; already in release.yml.
  'tauri-apps/tauri-action',
]);

const dir = join(ROOT, '.github/workflows');
const problems = [];
let used = 0;
for (const name of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), 'utf8');
  for (const [, spec] of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    used++;
    const [action, version] = spec.split('@');
    if (action.startsWith('./')) continue;
    if (!ALLOWED.has(action)) problems.push(`.github/workflows/${name}: uses "${spec}"${fix('run the command directly, or add the action to ALLOWED in scripts/check-workflows.mjs and say in the pull request why we accept it')}`);
    else if (!version) problems.push(`.github/workflows/${name}: "${action}" is not pinned to a version${fix('pin it, e.g. @v4')}`);
  }
}

const ciYml = readFileSync(join(dir, 'ci.yml'), 'utf8');

// The failure this check exists for was invisible until a cargo build script traced it, so ask the
// question directly and in one line: can pkg-config see the library the webview needs?
if (!ciYml.includes('pkg-config --exists glib-2.0')) {
  problems.push(`.github/workflows/ci.yml: the Linux job does not check that pkg-config can resolve glib-2.0 before the Rust steps${fix('add a step running pkg-config --exists glib-2.0, so a missing dependency is one line rather than a build-script trace')}`);
}

// Criterion 3: dbus stays on the Linux dep step. MARXY-74 added it because the Linux cold-start
// stall it fixed is measured (MARXY-63); grepping the whole file would still pass if the token
// moved to a comment, so read that step's apt-get package list and require the name.
const depStep = ciYml.match(/^[ \t]*- name: Linux webview and X deps\n([\s\S]*?)(?=^[ \t]*- |\z)/m);
const installLine = depStep?.[1].match(/apt-get install[^\n]*/)?.[0] ?? '';
const depPackages = installLine.split(/\s+/).filter(t => t && t !== 'sudo' && t !== 'apt-get' && t !== 'install' && !t.startsWith('-'));
if (!depStep) {
  problems.push(`.github/workflows/ci.yml: no Linux webview and X deps step${fix('keep the apt-get step that installs the webview libraries and dbus')}`);
} else if (!depPackages.includes('dbus')) {
  problems.push(`.github/workflows/ci.yml: the Linux dep step's package list does not include dbus${fix('add dbus to the apt-get install line; the Linux cold-start stall it fixes is measured')}`);
}

if (fail(problems)) process.exit(1);
console.log(`workflows ok (${used} action use(s), all allow-listed and pinned; glib-2.0 probed; dbus on the Linux dep step)`);
