// The verdict of the `ci` job, the one status check branch protection requires (A-09). It runs after
// every other job of ci.yml whatever happened to them, so it reports on every pull request, including
// docs-only and path-filtered ones. A skipped job is fine. A failed or cancelled one is not, and
// neither is a `changes` job that did not answer every output: a missing answer would skip the job
// it gates, and the skip would pass.
//
// usage (in ci.yml): NEEDS='${{ toJSON(needs) }}' node scripts/ci-verdict.mjs
import { fileURLToPath } from 'node:url';
import { OUTPUTS } from './ci-changes.mjs';

const mark = result => (result === 'success' ? '✓' : result === 'skipped' ? '·' : '✗');

/** `needs` is GitHub's `toJSON(needs)`: `{ job: { result, outputs } }`. Returns `{ ok, lines, errors }`. */
export function verdict(needs) {
  const lines = Object.entries(needs).map(([job, v]) => `${mark(v?.result)} ${job}: ${v?.result}`);
  const errors = [];
  const changes = needs.changes;
  if (!changes) errors.push('changes: missing from needs');
  else if (changes.result !== 'success') errors.push(`changes: ${changes.result}`);
  else {
    const unanswered = OUTPUTS.filter(k => changes.outputs?.[k] !== 'true' && changes.outputs?.[k] !== 'false');
    if (unanswered.length) errors.push(`changes did not answer: ${unanswered.join(', ')}`);
  }
  for (const [job, v] of Object.entries(needs)) {
    if (job === 'changes') continue;
    if (v?.result !== 'success' && v?.result !== 'skipped') errors.push(`${job}: ${v?.result}`);
  }
  return { ok: errors.length === 0, lines, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let needs;
  try { needs = JSON.parse(process.env.NEEDS ?? ''); }
  catch { console.error('ci-verdict: NEEDS is not the JSON of toJSON(needs)'); process.exit(1); }
  const { ok, lines, errors } = verdict(needs);
  for (const line of lines) console.log(line);
  if (!ok) { console.error(`failed: ${errors.join('; ')}`); process.exit(1); }
  console.log('ci: every job that ran succeeded');
}
