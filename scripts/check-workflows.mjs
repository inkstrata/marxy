// Which third-party code runs in our CI, and whether our Rust builds are held to Cargo.lock.
// usage: node scripts/check-workflows.mjs [--selftest]
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

// Every cargo build, check, clippy or test, and every tauri build, runs with --locked (MARXY-270), as pnpm
// installs with --frozen-lockfile: without it cargo re-resolves a stale Cargo.lock on the runner and CI
// tests a dependency graph nobody committed. cargo's own flags come before any `--`; tauri build hands
// what follows its `--` to cargo, so --locked has to be there.
function unlocked(command) {
  const found = [];
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const cargo = /\bcargo\s+(build|check|clippy|test)\b(.*)/.exec(part);
    if (cargo && !cargo[2].split(/\s--(?:\s|$)/)[0].split(/\s+/).includes('--locked')) found.push(`cargo ${cargo[1]}`);
    const tauri = /\btauri\s+build\b(.*)/.exec(part);
    if (tauri && !lockedAfterSeparator(tauri[1])) found.push('tauri build');
  }
  return found;
}
const lockedAfterSeparator = args => { const at = args.search(/(?:^|\s)--(?:\s|$)/); return at >= 0 && args.slice(at).split(/\s+/).includes('--locked'); };

/** Unlocked invocations in a workflow's text, as `line: what`; comment lines are skipped. */
function unlockedInWorkflow(text) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    for (const what of unlocked(line.replace(/\s#.*$/, ''))) found.push(`${i + 1}: ${what}`);
    // tauri-action runs `tauri build <args>`, so its args carry the `-- --locked`.
    if (/^\s*(?:-\s*)?uses:\s*tauri-apps\/tauri-action@/.test(line)) {
      const indent = line.search(/\S/);
      let args = null;
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) {
        const m = /^\s*args:\s*(.*)$/.exec(lines[j]);
        if (m) args = m[1];
      }
      if (args === null || !lockedAfterSeparator(args)) found.push(`${i + 1}: tauri-apps/tauri-action args`);
    }
  });
  return found;
}


const codeLines = text => text.split('\n').map((line, i) => [i + 1, line.replace(/(^|\s)#.*$/, '')]).filter(([, line]) => line.trim() !== '');

/**
 * The one place that says no step may be made advisory (A-08): no `continue-on-error`, and no `|| true`
 * in a `run:` step. Before this, nine scripts each asserted it about the one workflow they cared about.
 */
function softened(text) {
  const found = [];
  for (const [n, line] of codeLines(text)) {
    if (/^\s*(?:-\s*)?continue-on-error\s*:/.test(line)) found.push(`${n}: continue-on-error`);
    if (/\|\|\s*true\b/.test(line)) found.push(`${n}: || true`);
  }
  found.push(...conditionalLicenceSteps(text));
  return found;
}

/** A step is the run of lines from its `- ` to the next line indented less than that dash. */
function conditionalLicenceSteps(text) {
  const lines = codeLines(text);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const dash = /^(\s*)-\s/.exec(lines[i][1]);
    if (!dash) continue;
    const indent = dash[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end][1].search(/\S/) > indent || (lines[end][1].search(/\S/) === indent && !/^\s*-\s/.test(lines[end][1])))) end++;
    const step = lines.slice(i, end);
    if (!step.some(([, l]) => /gate-licences|gate:licences/.test(l))) continue;
    for (const [n, l] of step) if (/^\s*(?:-\s*)?if\s*:/.test(l)) found.push(`${n}: if: on a licence gate step`);
  }
  return found;
}

/** `jobs:` split into [name, text] pairs, by the two-space-indented keys under it. */
function jobsOf(text) {
  const at = text.search(/^jobs:\s*$/m);
  if (at < 0) return [];
  const lines = text.slice(at).split('\n').slice(1);
  const jobs = [];
  for (const line of lines) {
    const head = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (head) jobs.push([head[1], []]);
    else if (jobs.length) jobs.at(-1)[1].push(line);
  }
  return jobs.map(([name, body]) => [name, body.join('\n')]);
}

/**
 * Every job that runs cargo (or `tauri build`) on Linux, whatever it is called, probes pkg-config for
 * glib-2.0 and installs dbus. MARXY-74's caching action restored apt packages without their pkg-config
 * metadata, and the failure was invisible until a cargo build script traced it, so ask the question
 * in one line; dbus is on the list because the Linux cold-start stall it fixes is measured (MARXY-63).
 * It was a rule about a job named `gates`; A-09 moves those steps, and the rule stays where the cargo is.
 */
function linuxCargoProblems(text) {
  const found = [];
  for (const [name, body] of jobsOf(text)) {
    const code = codeLines(body).map(([, line]) => line);
    const cargo = code.some(line => /\bcargo\s+(?:build|check|clippy|test|run|install|bench)\b|\btauri\s+build\b/.test(line));
    const runsOn = code.find(line => /^\s*runs-on\s*:/.test(line)) ?? '';
    const linux = /ubuntu|linux/i.test(runsOn) || (/matrix\.os/.test(runsOn) && code.some(line => /\bos\s*:.*ubuntu/.test(line)));
    if (!cargo || !linux) continue;
    if (!code.some(line => /pkg-config\s+--exists\s+glib-2\.0/.test(line))) found.push(`${name}: no pkg-config --exists glib-2.0 probe`);
    const apt = code.filter(line => /apt-get\s+install/.test(line)).join(' ').split(/\s+/);
    if (!apt.includes('dbus')) found.push(`${name}: no apt-get install line with dbus`);
  }
  return found;
}

/**
 * Kept from gate-licences when it stopped asserting what ci.yml looks like (A-08): the licence gate
 * that reads every crate from the cargo registry (--require-registry) is worth nothing before the
 * build has populated that cache, so in any job that runs it, a cargo or tauri build comes first.
 */
function licenceOrderProblems(text) {
  const found = [];
  for (const [name, body] of jobsOf(text)) {
    const steps = body.split(/\n\s*- /).map(step => codeLines(step).map(([, line]) => line).join('\n'));
    const gate = steps.findIndex(step => /gate-licences\.mjs\s+--require-registry/.test(step));
    if (gate < 0) continue;
    const build = steps.findIndex(step => /\bcargo\s+build\b|\btauri\s+build\b|@marxy\/desktop build/.test(step));
    if (build < 0 || build > gate) found.push(`${name}: the --require-registry licence gate runs before any build has filled the cargo cache`);
  }
  return found;
}

const SELFTEST = [
  ['run: cargo build --profile ci', ['1: cargo build']],
  ['run: cargo build --locked --profile ci', []],
  ['run: cd x && cargo fmt --check && cargo clippy --quiet -- -D warnings', ['1: cargo clippy']],
  ['run: cargo clippy --locked --quiet -- -D warnings', []],
  ['run: cargo clippy --quiet -- --locked', ['1: cargo clippy']],
  ['run: cargo test --quiet', ['1: cargo test']],
  ['run: vite build && tauri build --no-bundle', ['1: tauri build']],
  ['run: vite build && tauri build --no-bundle -- --locked', []],
  ['run: tauri build --locked', ['1: tauri build']],
  ['# cargo build without the flag, in a comment', []],
  ['      - uses: tauri-apps/tauri-action@v0\n        with:\n          args: --target x', ['1: tauri-apps/tauri-action args']],
  ['      - uses: tauri-apps/tauri-action@v0\n        with:\n          args: --target x -- --locked', []],
  ['      - uses: tauri-apps/tauri-action@v0\n        env: { A: b }', ['1: tauri-apps/tauri-action args']],
];
const SOFTENED = [
  ['jobs:\n  a:\n    steps:\n      - run: pnpm test\n        continue-on-error: true', ['5: continue-on-error']],
  ['jobs:\n  a:\n    continue-on-error: ${{ matrix.experimental }}\n    steps: []', ['3: continue-on-error']],
  ['      - run: pnpm gate:specimen || true', ['1: || true']],
  ['      - run: pnpm gate:specimen ||true', ['1: || true']],
  ['      - run: |\n          pnpm build\n          pnpm test || true', ['3: || true']],
  ['      - run: pnpm test\n      # continue-on-error: true would make this advisory\n      - run: pnpm lint # || true', []],
  ['      - run: pnpm test || echo true', []],
  ['jobs:\n  g:\n    steps:\n      - name: Licence gate\n        if: runner.os == \'Linux\'\n        run: node scripts/gate-licences.mjs', ['5: if: on a licence gate step']],
  ['jobs:\n  g:\n    steps:\n      - if: runner.os == \'Linux\'\n        run: pnpm gate:licences', ['4: if: on a licence gate step']],
  ['jobs:\n  g:\n    steps:\n      - name: Licence gate\n        run: node scripts/gate-licences.mjs\n      - name: Other\n        if: runner.os == \'Linux\'\n        run: pnpm test', []],
  ['jobs:\n  g:\n    steps:\n      - run: node scripts/gate-licences.mjs\n  h:\n    if: always()\n    steps: []', []],
];
const LINUX_CARGO = [
  ['jobs:\n  rust:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cargo build --locked', ['rust: no pkg-config --exists glib-2.0 probe', 'rust: no apt-get install line with dbus']],
  ['jobs:\n  rust:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sudo apt-get install -y libgtk-3-dev dbus\n      - run: pkg-config --exists glib-2.0\n      - run: cargo build --locked', []],
  ['jobs:\n  rust:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sudo apt-get install -y libgtk-3-dev\n      - run: pkg-config --exists glib-2.0\n      - run: cargo clippy --locked', ['rust: no apt-get install line with dbus']],
  ['jobs:\n  rust:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sudo apt-get install -y dbus\n      - run: cargo test --locked', ['rust: no pkg-config --exists glib-2.0 probe']],
  ['jobs:\n  other-name:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [macos-latest, ubuntu-latest]\n    steps:\n      - run: cd x && cargo test --locked', ['other-name: no pkg-config --exists glib-2.0 probe', 'other-name: no apt-get install line with dbus']],
  ['jobs:\n  mac:\n    runs-on: macos-latest\n    steps:\n      - run: cargo build --locked', []],
  ['jobs:\n  web:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n      # cargo build in a comment', []],
];
const LICENCE_ORDER = [
  ['jobs:\n  g:\n    steps:\n      - run: cargo build --locked\n      - run: node scripts/gate-licences.mjs --require-registry', []],
  ['jobs:\n  g:\n    steps:\n      - run: node scripts/gate-licences.mjs --require-registry\n      - run: cargo build --locked', ['g: the --require-registry licence gate runs before any build has filled the cargo cache']],
  ['jobs:\n  g:\n    steps:\n      - run: node scripts/gate-licences.mjs --require-registry', ['g: the --require-registry licence gate runs before any build has filled the cargo cache']],
  ['jobs:\n  g:\n    steps:\n      - run: node scripts/gate-licences.mjs\n      - run: cargo build --locked', []],
];
const selftestFailures = [
  ...SELFTEST.flatMap(([text, want]) => {
    const got = unlockedInWorkflow(text);
    return JSON.stringify(got) === JSON.stringify(want) ? [] : [`selftest: ${JSON.stringify(text)} gave ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`];
  }),
  ...SOFTENED.flatMap(([text, want]) => JSON.stringify(softened(text)) === JSON.stringify(want) ? [] : [`selftest: ${JSON.stringify(text)} gave ${JSON.stringify(softened(text))}, expected ${JSON.stringify(want)}`]),
  ...LICENCE_ORDER.flatMap(([text, want]) => JSON.stringify(licenceOrderProblems(text)) === JSON.stringify(want) ? [] : [`selftest: ${JSON.stringify(text)} gave ${JSON.stringify(licenceOrderProblems(text))}, expected ${JSON.stringify(want)}`]),
  ...LINUX_CARGO.flatMap(([text, want]) => JSON.stringify(linuxCargoProblems(text)) === JSON.stringify(want) ? [] : [`selftest: ${JSON.stringify(text)} gave ${JSON.stringify(linuxCargoProblems(text))}, expected ${JSON.stringify(want)}`]),
];
if (process.argv.includes('--selftest')) {
  if (fail(selftestFailures)) process.exit(1);
  console.log(`check-workflows selftest ok (${SELFTEST.length + SOFTENED.length + LINUX_CARGO.length + LICENCE_ORDER.length} cases)`);
  process.exit(0);
}

const dir = join(ROOT, '.github/workflows');
const problems = [...selftestFailures];
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
  for (const where of softened(text)) problems.push(`.github/workflows/${name}:${where} makes a step advisory${fix('a step either gates the pull request or is not in the workflow; delete the step, or fix what it finds')}`);
  for (const what of licenceOrderProblems(text)) problems.push(`.github/workflows/${name}: job ${what}${fix('run gate-licences.mjs --require-registry after the build step in the same job')}`);
  for (const what of linuxCargoProblems(text)) problems.push(`.github/workflows/${name}: job ${what}${fix('a Linux job that runs cargo needs the webview libraries: apt-get install dbus and libwebkit2gtk-4.1-dev, then pkg-config --exists glib-2.0, before the Rust steps')}`);
  for (const where of unlockedInWorkflow(text)) problems.push(`.github/workflows/${name}:${where} runs without --locked${fix('add --locked (after `--` for tauri build and tauri-action args) so CI builds the committed Cargo.lock')}`);
}

const nightlyYml = readFileSync(join(dir, 'nightly.yml'), 'utf8');
if (!nightlyYml.includes('built-app-smoke:')) {
  problems.push(`.github/workflows/nightly.yml: no built-app-smoke job${fix('add the MARXY-254 release smoke job after aesthetics-determinism')}`);
} else if (!/timeout-minutes:\s*\d+/.test(nightlyYml.slice(nightlyYml.indexOf('built-app-smoke:')))) {
  problems.push(`.github/workflows/nightly.yml: built-app-smoke has no timeout-minutes${fix('every job carries timeout-minutes (docs/ci-contract.md)')}`);
} else {
  const smokeBlock = nightlyYml.slice(nightlyYml.indexOf('built-app-smoke:'));
  if (!smokeBlock.includes('smoke-built-app.mjs')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not run scripts/smoke-built-app.mjs${fix('drive the release binary with tauri-driver after building it')}`);
  }
  if (!smokeBlock.includes('cargo build --release --features tauri/custom-protocol')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not build a release binary${fix('use cargo build --release --features tauri/custom-protocol')}`);
  }
  const smokeDeps = smokeBlock.match(/apt-get install[^\n]*/)?.[0] ?? '';
  if (!smokeDeps.includes('webkit2gtk-driver')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not install webkit2gtk-driver${fix('apt-get install webkit2gtk-driver for WebKitWebDriver')}`);
  }
  if (!smokeBlock.includes('MARXY_SMOKE_BUILT_REQUIRED=1')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke must set MARXY_SMOKE_BUILT_REQUIRED=1${fix('the smoke skips without a stack; nightly must fail instead')}`);
  }
}

for (const manifest of ['package.json', 'apps/desktop/package.json']) {
  const { scripts = {} } = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  for (const [script, command] of Object.entries(scripts)) {
    for (const what of unlocked(command)) problems.push(`${manifest}: script "${script}" runs ${what} without --locked${fix('add --locked (after `--` for tauri build) so the build uses the committed Cargo.lock')}`);
  }
}

if (fail(problems)) process.exit(1);
console.log(`workflows ok (${used} action use(s), all allow-listed and pinned; every Linux cargo job probes glib-2.0 and installs dbus; no advisory step; nightly built-app smoke wired; every cargo and tauri build locked)`);
