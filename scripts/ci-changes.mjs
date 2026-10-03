// Change detection for CI: which categories of file changed between the base and HEAD, so a job that
// cannot be affected by the diff does not run (A-09, docs/research/audit-2026-10/04-tests-and-gates.md
// §6.1). Plain path classification and nothing else: no cache, no record of earlier runs. Writes one
// GITHUB_OUTPUT line per category and prints the same as JSON.
//
// usage: node scripts/ci-changes.mjs <base-ref>
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The outputs, in the order the `changes` job declares them. Every one is always written. */
export const OUTPUTS = ['docs_only', 'web', 'typography', 'rust', 'fleet', 'lockfile'];

// Prose only. orchestration/*.mjs and *.json are the fleet's code and board, and docs/plan's CSV is
// the board every gate reads: all used to count as docs, so a PR touching only them skipped `fast`
// and no orchestration test or board check ran in CI — which is how a red needs-human test reached
// main (MARXY-191).
//
// Some prose is also read by a test or gate, and a change to it can turn that test red: the loop
// script, agent prompts and git hooks are code; task cards are checked by check-cards; AGENTS.md,
// orchestration/README.md and the process docs are asserted by orchestration/docs.test.mjs and
// friends. A PR touching only those used to skip every one of the checks that guard them (MARXY-246).
const BOARD_OR_CODE = /^(orchestration\/.*\.(mjs|js|json|sh)$|orchestration\/prompts\/|orchestration\/README\.md$|\.githooks\/|docs\/plan\/jira-issues\.csv$|docs\/plan\/tasks\/|docs\/(sdlc|hygiene|plan|ci-contract)\.md$|AGENTS\.md$)/;
const isDoc = f => !BOARD_OR_CODE.test(f) && (/^(docs\/|orchestration\/|\.cursor\/|\.githooks\/|README\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$|AGENTS\.md$|LICENSE$|\.editorconfig$|\.gitattributes$|fonts\/.*\/(LICENSE|README)|docs\/.*\.png$)/.test(f) || (/\.md$/.test(f) && !f.startsWith('fixtures/')));

// Anything the browser job's gates and the desktop suite can see (unchanged by A-09).
const WEB = /^(packages\/|apps\/desktop\/(src\/|test\/|index\.html|app\.html|vite\.config|package\.json|scripts)|fixtures\/|scripts\/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|mise\.toml)/;

// What gate:aesthetics and gate:specimen render: the theme, the typesetter, the corpus, the fonts and
// the gates themselves, and everything gate-aesthetics.mjs loads into the page: the headless render
// entry (apps/desktop/src/render/headless.ts, built by src/render/vite.config.ts) and every module
// its import graph reaches in core (through @marxy/core's index: parse, render, sanitise, buffer,
// contracts, index model, outline, source map) and in the desktop app (theme/offset.ts), the
// @font-face sheet and the WebKit launcher. ci-changes.test.mjs walks that graph and fails when it
// reaches a file this set misses. Highlighting, the idle-work scheduler and selection are listed
// too: the rendered page uses them, though the static graph from headless.ts does not reach them today.
const TYPOGRAPHY = new RegExp('^(' + [
  'packages/theme/', 'packages/typeset/', 'fixtures/', 'fonts/', 'scripts/specimen/',
  'scripts/gate-aesthetics\\.mjs$', 'scripts/playwright-webkit\\.mjs$', 'apps/desktop/index\\.html$',
  'packages/core/src/(index\\.ts$|render/|sanitize/|parse/|buffer/|contracts/|index-model/|outline/|sourcemap/|highlight/)',
  'apps/desktop/src/(render/|fonts/|theme/|selection/|startup/idle-work\\.ts$)',
].join('|') + ')');

// What the Rust job builds and runs: the Tauri crate (tauri.conf.json and Cargo.lock live in it), the
// Vite config whose output the binary embeds, the command-line smoke, and the toolchain pins.
const RUST = /^(apps\/desktop\/src-tauri\/|apps\/desktop\/vite\.config\.ts$|apps\/desktop\/scripts\/smoke|mise\.toml$)/;

// What `pnpm test:fleet` runs or reads: the fleet's own code, the scripts it imports (open-pr,
// check-pr, done, scripts/lib), the commit rules, and the board-or-code prose above, which
// orchestration/docs.test.mjs and friends assert. orchestration/ alone would leave a pull request
// that touches only AGENTS.md running `fast` without the one test that guards AGENTS.md. Prose that is
// docs only (orchestration/needs-human.md) stays docs only: `fast` does not run at all.
const FLEET = /^(orchestration\/|scripts\/|commitlint\.config\.mjs$)/;

// A dependency moved: the manifests and either lockfile, wherever they sit.
const LOCKFILE = /(^|\/)(package\.json|pnpm-lock\.yaml|Cargo\.lock)$/;

/**
 * Which categories `files` (paths relative to the repository root) touch. A change under .github/
 * sets every category except docs_only, so a pull request that changes the workflows runs every job
 * they define; an unknown diff (git failed, `<unknown>`) is treated the same way.
 */
export function classify(files) {
  if (files.some(f => f.startsWith('.github/') || f === '<unknown>')) {
    return { docs_only: false, web: true, typography: true, rust: true, fleet: true, lockfile: true };
  }
  const any = re => files.some(f => re.test(f));
  return {
    docs_only: files.length > 0 && files.every(isDoc),
    web: any(WEB),
    typography: files.some(f => !isDoc(f) && TYPOGRAPHY.test(f)),
    rust: any(RUST),
    fleet: files.some(f => !isDoc(f) && (FLEET.test(f) || BOARD_OR_CODE.test(f))),
    lockfile: any(LOCKFILE),
  };
}

function gitDiffNames(a, b) {
  const names = args => execFileSync('git', ['diff', '--name-only', ...args], { encoding: 'utf8' }).split('\n').filter(Boolean);
  try { return names([`${a}...${b}`]); }
  catch { try { return names([a, b]); } catch { return ['<unknown>']; } }
}

// Only as a command: importing classify() must not read git or write outputs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2];
  if (!base) { console.error('usage: node scripts/ci-changes.mjs <base-ref>'); process.exit(2); }
  const files = gitDiffNames(base, 'HEAD');
  const out = classify(files);
  if (process.env.GITHUB_OUTPUT) for (const k of OUTPUTS) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${out[k]}\n`);
  console.log(`ci-changes: ${JSON.stringify({ ...out, changed: files.length })}${out.docs_only ? ' — docs only: every product job is skipped' : ''}`);
}
