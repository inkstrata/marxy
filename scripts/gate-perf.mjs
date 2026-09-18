// Performance budgets as hard failures (ADR-0013), in two tiers (ADR-0022): product budgets on
// reference hardware (MARXY_PERF_ENV=reference), an envelope plus a per-runner baseline in CI
// (MARXY_PERF_ENV=ci). Amendment 1 splits the metric: the CI rule keeps every number it had and now
// reads `warm_start_first_text_ms`, the quantity it has always measured, while
// `cold_start_first_text_ms` is launch 1 alone — recorded, printed, and required to be present, but
// held to no ceiling until MARXY-70 derives one. Reads fixtures/perf-budgets.json and
// results/perf.json (written by scripts/measure-startup.mjs). `--selftest` runs every rule over
// inline fixtures; `--assert-budgets-unchanged <ref>` compares the budgets file byte for byte.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { SELFTEST_CASE_NAMES as MEASURE_CASE_NAMES, MIN_WARM_RUNS } from './measure-startup.mjs';

const METRICS = ['cold_start_first_text_ms', 'open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms'];
const BASELINE_TOLERANCE = 1.1; // ADR-0022: a runner may drift 10 % before it is a regression.
const COLD_ENFORCEMENT_STORY = 'MARXY-69';
const CI_COLD_CEILING_STORY = 'MARXY-70';
const round = n => Math.round(n * 10) / 10;

// Which tier to enforce. CI must say so explicitly, so a misconfigured workflow fails loudly
// instead of silently measuring rented hardware against a product budget.
export function resolveEnvClass(env) {
  const raw = env.MARXY_PERF_ENV;
  if (raw && raw !== 'reference' && raw !== 'ci') return { error: `MARXY_PERF_ENV must be "reference" or "ci", got "${raw}"` };
  if (env.CI && raw !== 'ci') return { error: `CI is set, so MARXY_PERF_ENV must be "ci" (got ${raw ? `"${raw}"` : 'unset'})` };
  return { envClass: raw ?? 'reference' };
}

// Whether the record is a measurement at all. Asked in both tiers and before any budget, because a
// short sample and a missing cold number are how a measurement disappears without anything going red.
export function recordSufficiency(results) {
  const fails = [];
  if (typeof results.usable_runs !== 'number' || typeof results.runs_n !== 'number') fails.push('results/perf.json carries no usable_runs and runs_n; the record predates the metric split (ADR-0022 Amendment 1)');
  else if (results.usable_runs < results.runs_n) fails.push(`only ${results.usable_runs} of ${results.runs_n} launches produced a first_text mark; the launches that did not are recorded with their exit code and stderr, and a statistic over the survivors is not the statistic it claims to be`);
  if (results.cold_start_first_text_ms == null) fails.push('cold_start_first_text_ms is absent; launch 1 is the only cold observation there is and a record without it is not enough to gate on');
  if (!results.cold_procedure) fails.push('cold_procedure is absent or empty; a record must state what made launch 1 cold ("process-cold only" is a legitimate answer)');
  if (typeof results.warm_runs_n !== 'number' || results.warm_runs_n < MIN_WARM_RUNS) fails.push(`warm_runs_n is ${results.warm_runs_n ?? 'absent'}; the warm median needs at least ${MIN_WARM_RUNS} launches behind it`);
  return fails;
}

// Pure so --selftest can drive it: results === null means results/perf.json was absent.
export function evaluate({ envClass, budgets, results, runnerClass }) {
  const out = [];
  const fails = [];
  if (!results) return { ok: false, out, fails: ['results/perf.json missing; run scripts/measure-startup.mjs first'] };
  if (results.env_class !== envClass) fails.push(`results/perf.json env_class is ${results.env_class ?? 'absent'}, expected ${envClass}`);
  fails.push(...recordSufficiency(results));

  const warm = results.warm_start_first_text_ms;
  const cold = results.cold_start_first_text_ms;
  if (cold != null) out.push(`cold start (launch 1, ${results.cold_procedure}): ${cold} ms — recorded and printed; ${CI_COLD_CEILING_STORY} derives the ceiling it will be held to`);
  if (results.cold_warm_ratio != null) out.push(`cold/warm ratio: ${results.cold_warm_ratio}× (launch 1 against the median of launches 2..${results.runs_n})`);

  if (envClass === 'reference') {
    if (warm == null) fails.push('warm_start_first_text_ms missing from results/perf.json');
    else if (warm > budgets.product.cold_start_first_text_ms) fails.push(`warm_start_first_text_ms: ${warm} ms > ${budgets.product.cold_start_first_text_ms} ms (product budget)`);
    else out.push(`warm_start_first_text_ms: ${warm} ms ≤ ${budgets.product.cold_start_first_text_ms} ms (product budget)`);
    for (const k of METRICS.slice(1)) {
      const v = results[k];
      if (v == null) continue;
      if (v > budgets.product[k]) fails.push(`${k}: ${v} ms > ${budgets.product[k]} ms (product budget)`);
      else out.push(`${k}: ${v} ms ≤ ${budgets.product[k]} ms (product budget)`);
    }
    // Reference mode is the tier the release runbook trusts, and it cannot currently do the job it
    // claims: the number above is a warm start, and the ADR-0013 budget is about a cold one. Until
    // MARXY-69 measures k ≥ 5 cold launches, the honest outcome is a red run before a tag.
    fails.push(`the ADR-0013 product cold-start budget (${budgets.product.cold_start_first_text_ms} ms) is not currently enforceable: the number compared above is a warm start, and the only cold observation in this record is one unrepeated launch (${results.cold_procedure}). ${COLD_ENFORCEMENT_STORY} restores enforcement by measuring a median over k ≥ 5 cold launches; until it lands, a tag cut on this run has not measured what the reader feels`);
    return { ok: false, out, fails };
  }

  const cls = runnerClass ?? results.runner_class;
  const ci = cls ? budgets.ci[cls] : undefined;
  if (!ci) {
    fails.push(`unknown runner class ${cls ? `"${cls}"` : '(unset)'}; add it to fixtures/perf-budgets.json under "ci"`);
    return { ok: false, out, fails };
  }
  out.push(`runner class ${cls}: envelope ×${ci.multiplier}, baseline ${ci.baseline_ms ?? 'none'} ms`);

  if (warm == null) {
    fails.push('warm_start_first_text_ms missing from results/perf.json');
  } else {
    const envelope = budgets.product.cold_start_first_text_ms * ci.multiplier;
    const baselineCeiling = ci.baseline_ms == null ? Infinity : ci.baseline_ms * BASELINE_TOLERANCE;
    const limit = Math.min(envelope, baselineCeiling);
    if (warm > envelope) fails.push(`warm_start_first_text_ms (median of launches 2..${results.runs_n}): ${warm} ms exceeds the envelope ${envelope} ms (product ${budgets.product.cold_start_first_text_ms} ms × ${ci.multiplier}) by ${round(warm - envelope)} ms`);
    if (warm > baselineCeiling) fails.push(`warm_start_first_text_ms (median of launches 2..${results.runs_n}): ${warm} ms exceeds the baseline ceiling ${round(baselineCeiling)} ms (baseline ${ci.baseline_ms} ms + 10 %) by ${round(warm - baselineCeiling)} ms`);
    if (warm <= limit) out.push(`warm_start_first_text_ms: ${warm} ms ≤ ${round(limit)} ms (min of envelope ${envelope} ms and baseline ceiling ${round(baselineCeiling)} ms)`);
  }

  // The remaining product budgets still gate in CI, against the same runner envelope: a check
  // that stops running is a check that has been removed.
  for (const k of METRICS.slice(1)) {
    const v = results[k];
    if (v == null) continue;
    const envelope = budgets.product[k] * ci.multiplier;
    if (v > envelope) fails.push(`${k}: ${v} ms exceeds the envelope ${envelope} ms (product ${budgets.product[k]} ms × ${ci.multiplier}) by ${round(v - envelope)} ms`);
    else out.push(`${k}: ${v} ms ≤ ${envelope} ms (envelope)`);
  }
  return { ok: fails.length === 0, out, fails };
}

// This story may not move a number in the budgets file, and the cheapest proof is the file itself
// compared byte for byte with the revision it is supposed to match.
function assertBudgetsUnchanged(ref) {
  const path = 'fixtures/perf-budgets.json';
  const before = execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  const after = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  if (before !== after) {
    console.error(`perf gate: ${path} differs from ${ref}; MARXY-63 changes which key the rule reads, never a number it reads`);
    process.exit(1);
  }
  console.log(`perf gate: ${path} is byte-identical to ${ref} (${after.length} bytes)`);
  process.exit(0);
}

// The gate and the measurement must stay required on both runner classes: a gate that can be
// skipped or forced green is measurement theatre.
export function checkWorkflow(text) {
  const errors = [];
  const gates = text.slice(text.indexOf('\n  gates:'));
  for (const os of ['macos-latest', 'ubuntu-latest']) {
    if (!new RegExp(`os:.*${os}`).test(gates)) errors.push(`.github/workflows/ci.yml: the gates matrix does not include ${os}`);
  }
  if (!/fail-fast:\s*false/.test(gates)) errors.push('.github/workflows/ci.yml: the gates matrix must keep fail-fast: false so both runner classes report');
  const steps = gates.split(/\n      - /).slice(1);
  const guarded = steps.filter(s => /measure-startup\.mjs|gate:perf|gate-perf\.mjs/.test(s) && !/upload-artifact/.test(s));
  for (const needle of ['measure-startup.mjs', 'gate:perf', '--selftest']) {
    if (!guarded.some(s => s.includes(needle))) errors.push(`.github/workflows/ci.yml: no gates step runs ${needle}`);
  }
  for (const s of guarded) {
    const head = s.split('\n')[0].trim();
    if (/continue-on-error/.test(s)) errors.push(`.github/workflows/ci.yml: "${head}" carries continue-on-error`);
    if (/\|\|\s*true/.test(s)) errors.push(`.github/workflows/ci.yml: "${head}" swallows its exit code with || true`);
    if (/^\s*if:/m.test(s)) errors.push(`.github/workflows/ci.yml: "${head}" is conditional, so it is not required on both runner classes`);
  }
  if (/continue-on-error/.test(text)) errors.push('.github/workflows/ci.yml: continue-on-error appears in the workflow');
  return errors;
}

const PRODUCT = { cold_start_first_text_ms: 500, open_indexed_document_ms: 50, palette_keystroke_ms: 16, typeset_viewport_ms: 100, live_reload_ms: 100, find_first_match_ms: 50 };
const SELFTEST_BUDGETS = {
  product: PRODUCT,
  ci: {
    'ubuntu-latest': { multiplier: 20, baseline_ms: 7719 },
    'macos-latest': { multiplier: 5, baseline_ms: 1901 },
    'no-baseline': { multiplier: 5, baseline_ms: null },
  },
};

// A record that is sufficient to gate on, so each case can make exactly one thing wrong.
const result = (over = {}) => ({
  env_class: 'ci',
  runner_class: 'ubuntu-latest',
  cold_start_first_text_ms: 9000,
  warm_start_first_text_ms: 7000,
  cold_warm_ratio: 1.29,
  cold_procedure: 'process-cold only',
  runs: [9000, 7000, 7100, 6900, 7200, 6950, 7050, 6980, 7020],
  warm_runs: [7000, 7100, 6900, 7200, 6950, 7050, 6980, 7020],
  warm_runs_n: 8,
  runs_n: 9,
  usable_runs: 9,
  ...over,
});
const referenceResult = (over = {}) => result({ env_class: 'reference', runner_class: null, warm_start_first_text_ms: 480, cold_start_first_text_ms: 2400, ...over });

// The names from the MARXY-55 suite are required to survive, adapted only where a key was renamed:
// a rule that stops being checked has been deleted whatever the file says.
const MARXY_55_CASE_NAMES = [
  'ci: inside both rules passes',
  'ci: above the envelope fails',
  'ci: 11 % above the baseline fails even far below the envelope',
  'reference: 501 ms fails the product budget',
  'reference: missing results fails',
  'reference: results measured in ci mode fails',
  'ci: unknown runner class fails',
  'ci: a null baseline still enforces the envelope',
  'ci: a null baseline passes under the envelope',
];

const has = (fails, re) => fails.some(f => re.test(f));
const SELFTEST_CASES = [
  { name: 'ci: inside both rules passes', envClass: 'ci', results: result(), expect: 0 },
  { name: 'ci: above the envelope fails', envClass: 'ci', results: result({ warm_start_first_text_ms: 10_500 }), expect: 1, assert: f => has(f, /exceeds the envelope 10000 ms/) },
  { name: 'ci: 11 % above the baseline fails even far below the envelope', envClass: 'ci', results: result({ warm_start_first_text_ms: 8568 }), expect: 1, assert: f => has(f, /exceeds the baseline ceiling 8490.9 ms/) },
  { name: 'reference: 501 ms fails the product budget', envClass: 'reference', results: referenceResult({ warm_start_first_text_ms: 501 }), expect: 1, assert: f => has(f, /501 ms > 500 ms \(product budget\)/) },
  { name: 'reference: missing results fails', envClass: 'reference', results: null, expect: 1 },
  { name: 'reference: results measured in ci mode fails', envClass: 'reference', results: result({ warm_start_first_text_ms: 400 }), expect: 1, assert: f => has(f, /env_class is ci, expected reference/) },
  { name: 'ci: unknown runner class fails', envClass: 'ci', results: result({ runner_class: 'windows-latest' }), expect: 1 },
  { name: 'ci: a null baseline still enforces the envelope', envClass: 'ci', results: result({ runner_class: 'no-baseline', warm_start_first_text_ms: 2600 }), expect: 1, assert: f => has(f, /exceeds the envelope 2500 ms/) },
  { name: 'ci: a null baseline passes under the envelope', envClass: 'ci', results: result({ runner_class: 'no-baseline', warm_start_first_text_ms: 2400 }), expect: 0 },
  { name: 'ci: the rule names the quantity it gates as a warm start', envClass: 'ci', results: result({ warm_start_first_text_ms: 8568 }), expect: 1, assert: f => has(f, /warm_start_first_text_ms \(median of launches 2\.\.9\)/) },
  { name: 'ci: usable_runs below runs_n fails', envClass: 'ci', results: result({ usable_runs: 1 }), expect: 1, assert: f => has(f, /only 1 of 9 launches produced a first_text mark/) },
  { name: 'reference: usable_runs below runs_n fails', envClass: 'reference', results: referenceResult({ usable_runs: 0, runs: [] }), expect: 1, assert: f => has(f, /of 9 launches produced a first_text mark/) },
  { name: 'ci: a missing cold_start_first_text_ms fails', envClass: 'ci', results: result({ cold_start_first_text_ms: null }), expect: 1, assert: f => has(f, /cold_start_first_text_ms is absent/) },
  { name: 'reference: a missing cold_start_first_text_ms fails', envClass: 'reference', results: referenceResult({ cold_start_first_text_ms: null }), expect: 1, assert: f => has(f, /cold_start_first_text_ms is absent/) },
  { name: 'ci: an absent or empty cold_procedure fails', envClass: 'ci', results: result({ cold_procedure: '' }), expect: 1, assert: f => has(f, /cold_procedure is absent or empty/) },
  { name: 'reference: an absent or empty cold_procedure fails', envClass: 'reference', results: referenceResult({ cold_procedure: undefined }), expect: 1, assert: f => has(f, /cold_procedure is absent or empty/) },
  { name: 'ci: fewer than eight warm launches fails', envClass: 'ci', results: result({ warm_runs_n: 7 }), expect: 1, assert: f => has(f, /warm median needs at least 8 launches/) },
  { name: 'reference: fewer than eight warm launches fails', envClass: 'reference', results: referenceResult({ warm_runs_n: 7 }), expect: 1, assert: f => has(f, /warm median needs at least 8 launches/) },
  { name: 'reference: a warm median under the product budget still fails, naming the story that restores enforcement', envClass: 'reference', results: referenceResult(), expect: 1, assert: f => has(f, /not currently enforceable/) && has(f, /MARXY-69/) },
  { name: 'ci: the cold metric is recorded and printed but held to no ceiling', envClass: 'ci', results: result({ cold_start_first_text_ms: 99_000 }), expect: 0, assertOut: o => o.some(l => /cold start \(launch 1/.test(l) && /99000 ms/.test(l) && /MARXY-70/.test(l)) },
];

function selftest() {
  let bad = 0;
  let ran = 0;
  const report = (ok, name, detail) => { ran++; if (ok) console.log(`selftest ok: ${name}`); else { bad++; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); } };

  for (const c of SELFTEST_CASES) {
    const { ok, out, fails } = evaluate({ envClass: c.envClass, budgets: SELFTEST_BUDGETS, results: c.results, runnerClass: c.results?.runner_class ?? undefined });
    const code = ok ? 0 : 1;
    let detail = null;
    if (code !== c.expect) detail = `exit ${code}, want ${c.expect}${fails.length ? `: ${fails.join(' / ')}` : ''}`;
    else if (c.assert && !c.assert(fails)) detail = `the expected reason is not in ${JSON.stringify(fails)}`;
    else if (c.assertOut && !c.assertOut(out)) detail = `the expected line is not in ${JSON.stringify(out)}`;
    report(!detail, c.name, detail);
  }

  for (const name of MARXY_55_CASE_NAMES) {
    if (!SELFTEST_CASES.some(c => c.name === name)) { bad++; console.error(`selftest FAIL: the MARXY-55 case "${name}" is no longer in the suite`); }
  }

  // The env-class resolution rules are part of the contract, so they are checked too.
  for (const c of [
    { env: {}, want: 'reference' },
    { env: { MARXY_PERF_ENV: 'ci' }, want: 'ci' },
    { env: { CI: 'true' }, want: 'error' },
    { env: { CI: 'true', MARXY_PERF_ENV: 'reference' }, want: 'error' },
    { env: { CI: 'true', MARXY_PERF_ENV: 'ci' }, want: 'ci' },
    { env: { MARXY_PERF_ENV: 'laptop' }, want: 'error' },
  ]) {
    const r = resolveEnvClass(c.env);
    const got = r.error ? 'error' : r.envClass;
    report(got === c.want, `resolveEnvClass(${JSON.stringify(c.env)}) → ${c.want}`, got === c.want ? null : `got ${got}`);
  }

  // The rules are only worth anything if the shipped budgets and the workflow obey them.
  const budgetsText = readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8');
  const shipped = JSON.parse(budgetsText);
  const shippedOk = shipped.product.cold_start_first_text_ms === 500 && Object.entries(shipped.ci).every(([, ci]) => typeof ci.multiplier === 'number' && ('baseline_ms' in ci));
  report(shippedOk, 'budgets: the shipped fixtures/perf-budgets.json carries the numbers this rule reads');
  report(budgetsText !== budgetsText.replace('"cold_start_first_text_ms": 500', '"cold_start_first_text_ms": 900'), 'budgets: an edited budgets file is detected byte for byte');

  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  report(checkWorkflow(workflow).length === 0, 'workflow: the measurement, the selftests and the perf gate are required on both runner classes, with no continue-on-error and no || true', checkWorkflow(workflow).join('; '));
  // The workflow check is only worth running if it can fail, so it is run against the workflow with
  // each of the softenings it exists to forbid put back in.
  for (const [what, mutated] of [
    ['continue-on-error on the perf gate step', workflow.replace('      - name: Perf gate', '      - name: Perf gate\n        continue-on-error: true')],
    ['|| true on the measurement step', workflow.replace('        run: node scripts/measure-startup.mjs\n', '        run: node scripts/measure-startup.mjs || true\n')],
    ['the perf gate skipped on one runner class', workflow.replace('        run: pnpm gate:perf\n', "        if: runner.os == 'Linux'\n        run: pnpm gate:perf\n")],
    ['macos-latest dropped from the matrix', workflow.replace('os: [macos-latest, ubuntu-latest]', 'os: [ubuntu-latest]')],
  ]) {
    report(checkWorkflow(mutated).length > 0, `workflow: ${what} is rejected`);
  }

  // The withdrawn statistic must leave no residue behind it (delta 2026-09-18, decision 1). The
  // needles are assembled rather than written out, so that this check is not itself the last match.
  const needles = [['floor', '_ms'], ['floor', ' statistic'], ['minimum', ' of the']].map(parts => parts.join(''));
  const residue = ['gate-perf.mjs', 'measure-startup.mjs']
    .map(f => [f, readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')])
    .filter(([, text]) => needles.some(n => text.includes(n)))
    .map(([f]) => f);
  report(residue.length === 0, 'scripts: the withdrawn statistic leaves no residue', residue.join(', '));

  // No case may be lost: the two suites together are asserted against a floor on their own size.
  const cases = ran + MEASURE_CASE_NAMES.length;
  if (cases < 24) { bad++; console.error(`selftest FAIL: ${cases} named cases across both suites, which must be at least 24`); }
  if (bad) { console.error(`perf gate selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`perf gate selftest ok: ${ran} named cases here, ${MEASURE_CASE_NAMES.length} in measure-startup, ${cases} together`);
  process.exit(0);
}

const budgetsRef = process.argv.indexOf('--assert-budgets-unchanged');
if (budgetsRef !== -1) assertBudgetsUnchanged(process.argv[budgetsRef + 1] ?? 'origin/main');
if (process.argv.includes('--selftest')) selftest();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
const { envClass, error } = resolveEnvClass(process.env);
if (error) { console.error(`perf gate: ${error}`); process.exit(1); }
const resultsPath = new URL('../results/perf.json', import.meta.url);
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : null;
console.log(`perf gate: ${envClass} mode`);
const { ok, out, fails } = evaluate({ envClass, budgets, results, runnerClass: process.env.MARXY_RUNNER_CLASS || undefined });
for (const line of out) console.log(line);
if (!ok) { console.error('perf gate failed:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('perf gate ok');
