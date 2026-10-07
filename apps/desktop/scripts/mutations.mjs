// The desktop mutation checks (A-10): run a suite with a named mutation switched on in product code and
// pass only when the tests that guard it fail by name and nothing else does.
//
// Before this, `test` re-ran the four palette files with the mutation on and asserted the exit status
// was 1 (`( MARXY_86_MUTATION=… ; test $? -eq 1 )`). Status 1 is also what a syntax error, a crashed
// file or an unrelated failing test gives, so the check passed for reasons that had nothing to do with
// the mutation, and its ✖ lines sat in every green run of `test` (audit 04 §3, point 1). Here the TAP
// stream is read test by test: every named test must fail, the named skips must skip, every other test
// must pass, and a file that cannot load is a failure because it is not a named test.
//
// usage: node scripts/mutations.mjs        (pnpm --filter @marxy/desktop test:mutations)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SEARCH_PREPARED_BODY_MUTATION } from '../src/palette/search.ts';

const desktop = fileURLToPath(new URL('..', import.meta.url));

/** Each mutation: the env hook product code reads, the files to run, and the tests it must turn red. */
export const MUTATIONS = [
  {
    name: SEARCH_PREPARED_BODY_MUTATION,
    env: { MARXY_86_MUTATION: SEARCH_PREPARED_BODY_MUTATION },
    files: ['src/palette/session.test.ts', 'src/palette/search.test.ts', 'src/palette/search-perf.test.ts', 'src/palette/keys.test.ts'],
    mustFail: [
      'search on a 20,000-entry index runs every query and finds what is there',
      'a query matches title, path and headings',
      'a heading match beats a lower-quality title match even when the title score is high',
      'heading hits jump to the heading byte offset',
      'current root results come before another root',
      'a file read yesterday outranks one read months ago on a near-equal match',
      'a decomposed (NFD) file name matches a composed (NFC) query and the reverse',
      'empty query shows MRU newest first',
      'empty query keeps pinned documents on top',
      'of two equal matches the one the session read more recently ranks first',
      'a hit opened in root /b moves the current root, and /b hits come before /a hits',
      "51 equal matches in a non-recent root do not push out a recent root's match",
      'with few matches outside the current root a recent root still comes first',
      'a non-recent root with higher scores does not outrank a recent root under the cap',
      'two recent roots keep their recent order ahead of a non-recent root with many matches',
      'within one root a higher score still wins when the root is not recent',
    ],
    mustSkip: [`mutation ${SEARCH_PREPARED_BODY_MUTATION}: searchPrepared is live when the env hook is unset`],
  },
];

const unescape = (s) => s.replace(/\\#/g, '#').replace(/\\\\/g, '\\');

/** Top-level results of a node:test TAP stream, in order: `{ name, outcome }`, outcome pass | fail | skip | todo. */
export function parseTap(tap) {
  const results = [];
  for (const line of tap.split('\n')) {
    const m = /^(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (!m) continue;
    const outcome = m[3] === 'SKIP' ? 'skip' : m[3] === 'TODO' ? 'todo' : m[1] === 'ok' ? 'pass' : 'fail';
    results.push({ name: unescape(m[2]), outcome });
  }
  return results;
}

/** The verdict on one mutation run: `{ ok, errors }`. `status` is the child's exit status (null on a signal). */
export function judge({ tap, status }, spec) {
  const errors = [];
  if (status === null) errors.push('the test run was killed by a signal');
  if (!/^# fail \d+$/m.test(tap)) errors.push('the test run printed no summary: it crashed before it finished');
  const results = parseTap(tap);
  if (results.length === 0) errors.push('no test reported a result');
  const byName = new Map();
  for (const r of results) byName.set(r.name, [...(byName.get(r.name) ?? []), r.outcome]);
  for (const name of spec.mustFail) {
    const got = byName.get(name);
    if (!got) errors.push(`named test did not run: ${name}`);
    else if (got.some((o) => o !== 'fail')) errors.push(`named test did not fail under the mutation (${got.join(', ')}): ${name}`);
  }
  for (const name of spec.mustSkip ?? []) {
    const got = byName.get(name);
    if (!got) errors.push(`named skip did not run: ${name}`);
    else if (got.some((o) => o !== 'skip')) errors.push(`named skip did not skip (${got.join(', ')}): ${name}`);
  }
  const named = new Set([...spec.mustFail, ...(spec.mustSkip ?? [])]);
  for (const r of results) {
    if (named.has(r.name)) continue;
    if (r.outcome !== 'pass') errors.push(`unnamed test ${r.outcome === 'fail' ? 'failed' : `reported ${r.outcome}`} under the mutation: ${r.name}`);
  }
  return { ok: errors.length === 0, errors };
}

function runMutation(spec) {
  const child = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--experimental-strip-types', '--test-reporter=tap', ...spec.files],
    { cwd: desktop, env: { ...process.env, ...spec.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (child.error) return { ok: false, errors: [`could not start node --test: ${child.error.message}`] };
  const verdict = judge({ tap: child.stdout, status: child.status }, spec);
  if (!verdict.ok && child.stderr.trim()) verdict.errors.push(`stderr:\n${child.stderr.trim()}`);
  return verdict;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let failed = false;
  for (const spec of MUTATIONS) {
    const { ok, errors } = runMutation(spec);
    if (ok) {
      console.log(`✓ mutation ${spec.name}: ${spec.mustFail.length} named test(s) failed, every other test passed`);
    } else {
      failed = true;
      console.error(`✗ mutation ${spec.name}:\n - ${errors.join('\n - ')}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
