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
export const OUTPUTS = ['docs_only', 'web', 'rust', 'lockfile'];

// What a test or check that stays on the pull-request path reads, plus the fleet's code. G-03 took
// `pnpm test:fleet` off the path (the fleet is paused, ADR-0051), so the orchestration prose that only
// the fleet's tests asserted is plain documentation now: orchestration/README.md, orchestration/prompts/,
// docs/plan/tasks/. What is left here is code, or prose that `fast` itself reads:
//   - orchestration/*.mjs|js|json|sh is the fleet's code, which the conventions job and the scripts
//     tests import (pr-mark, deps.json); a change to it still runs `fast`;
//   - .githooks/ is shell that runs on every commit;
//   - AGENTS.md, docs/{sdlc,hygiene,plan,ci-contract}.md and docs/plan/jira-issues.csv are read by
//     tests that are in `pnpm test` or `pnpm check` (lib/no-ceiling, check-story, smoke-verdict,
//     smoke-built-app, check-one-parse, lib/plan), so a documents-only change to them could turn `fast`
//     red, and the next push to main with it. Widening docs_only over them would break the rule that a
//     job skips only when the diff cannot fail it (docs/hygiene.md).
const READ_BY_FAST = /^(orchestration\/.*\.(mjs|js|json|sh)$|\.githooks\/|docs\/plan\/jira-issues\.csv$|docs\/(sdlc|hygiene|plan|ci-contract)\.md$|AGENTS\.md$)/;
const isDoc = f => !READ_BY_FAST.test(f) && (/^(docs\/|orchestration\/|\.cursor\/|\.claude\/|changelog\.d\/|README\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$|LICENSE$|\.editorconfig$|\.gitattributes$|fonts\/.*\/(LICENSE|README)|docs\/.*\.png$)/.test(f) || (/\.md$/.test(f) && !f.startsWith('fixtures/')));

// Anything the browser job's gates and the desktop lite suite can see. Under scripts/ that is only what
// the job runs or imports: the no-network gate, the WebKit launcher every browser test uses, the perf
// harness's document generator that progressive.test.mjs imports, and the CSP check release-csp.test.mjs
// imports with the two lib files it loads. tauri.conf.json is read by that check: the release CSP is the
// privacy commitment's floor, so an edit to it must start the job that asserts it (before G-03 it did not,
// unless `scripts/` changed too). ci-changes.test.mjs walks the imports of the gate and the lite files and
// fails when one reaches a scripts/ file this set misses.
const WEB = /^(packages\/|apps\/desktop\/(src\/|test\/|index\.html|app\.html|gate\.html|vite\.config|package\.json|scripts|src-tauri\/tauri\.conf\.json$)|fixtures\/|scripts\/(gate-no-network|playwright-webkit|perf-harness|check-csp)\.mjs$|scripts\/lib\/(repo|plan)\.mjs$|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|mise\.toml)/;

// What the Rust job runs on a pull request: fmt, clippy and `cargo test` over the Tauri crate
// (tauri.conf.json and Cargo.lock live in it), and the toolchain pin, whose new clippy lints can fail
// code nobody touched. The binary, the Vite config it embeds and the CLI smoke are built nightly.
const RUST = /^(apps\/desktop\/src-tauri\/|mise\.toml$)/;

// A dependency moved: the manifests and either lockfile, wherever they sit.
const LOCKFILE = /(^|\/)(package\.json|pnpm-lock\.yaml|Cargo\.lock)$/;

/**
 * Which categories `files` (paths relative to the repository root) touch. A change under .github/
 * sets every category except docs_only, so a pull request that changes the workflows runs every job
 * they define; an unknown diff (git failed, `<unknown>`) is treated the same way.
 */
export function classify(files) {
  if (files.some(f => f.startsWith('.github/') || f === '<unknown>')) {
    return { docs_only: false, web: true, rust: true, lockfile: true };
  }
  const any = re => files.some(f => re.test(f));
  return {
    docs_only: files.length > 0 && files.every(isDoc),
    web: any(WEB),
    rust: any(RUST),
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
