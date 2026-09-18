// Performance budgets as hard failures (ADR-0013), in two tiers (ADR-0022): product budgets on
// reference hardware (MARXY_PERF_ENV=reference), an envelope plus a per-runner baseline in CI
// (MARXY_PERF_ENV=ci). Amendment 1: CI gates the measured floor against a recorded per-class
// tolerance whose detection power is asserted, and confirms a breach by re-measuring before failing.
// Reads fixtures/perf-budgets.json and results/perf.json (written by scripts/measure-startup.mjs).
// `--selftest` runs every rule over inline fixtures; `--assert-product-unchanged <ref>` compares the
// `product` object byte for byte against another revision.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const METRICS = ['cold_start_first_text_ms', 'open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms'];
export const MIN_OBSERVED_FLOORS = 5; // a tolerance argued from fewer floors than this is a guess
export const MIN_TOLERANCE = 1.05;
export const DETECTION_BOUND = 1.2; // spread × tolerance: the "does not hide a 20 % regression" promise
export const MAX_ROUNDS = 3; // one measurement plus at most two confirmations, in the same job
export const WAIVER_KEYS = ['reason', 'observed_floors_ms', 'escalated_to', 'date'];
const round = n => Math.round(n * 10) / 10;

// Which tier to enforce. CI must say so explicitly, so a misconfigured workflow fails loudly
// instead of silently measuring rented hardware against a product budget.
export function resolveEnvClass(env) {
  const raw = env.MARXY_PERF_ENV;
  if (raw && raw !== 'reference' && raw !== 'ci') return { error: `MARXY_PERF_ENV must be "reference" or "ci", got "${raw}"` };
  if (env.CI && raw !== 'ci') return { error: `CI is set, so MARXY_PERF_ENV must be "ci" (got ${raw ? `"${raw}"` : 'unset'})` };
  return { envClass: raw ?? 'reference' };
}

// A configuration that cannot catch the regression it exists to catch is a failure of the gate, not
// a property of the diff: it is checked before any measurement is compared to anything.
export function validateClassConfig(cls, ci) {
  const errors = [];
  const where = `fixtures/perf-budgets.json ci."${cls}"`;
  if (typeof ci.multiplier !== 'number' || !(ci.multiplier > 0)) errors.push(`${where}: multiplier must be a positive number`);
  if (!Number.isInteger(ci.runs_n)) errors.push(`${where}: runs_n must be the integer launch count the floors were measured at`);
  const floors = ci.observed_floors_ms;
  if (!Array.isArray(floors) || floors.some(f => typeof f !== 'number')) {
    errors.push(`${where}: observed_floors_ms must be an array of numbers measured on main`);
    return errors;
  }
  if (floors.length < MIN_OBSERVED_FLOORS) errors.push(`${where}: observed_floors_ms has ${floors.length} floors, need at least ${MIN_OBSERVED_FLOORS}`);
  if (typeof ci.tolerance !== 'number' || ci.tolerance < MIN_TOLERANCE) errors.push(`${where}: tolerance must be a number of at least ${MIN_TOLERANCE}, got ${ci.tolerance}`);
  for (const k of ['commit', 'runner_image', 'runs_n']) {
    if (ci.derived_from?.[k] == null) errors.push(`${where}: derived_from.${k} is missing`);
  }
  if (ci.baseline_ms === null) {
    const w = ci.baseline_waived;
    if (!w || typeof w !== 'object') errors.push(`${where}: baseline_ms is null without a baseline_waived record; a class loses the baseline rule only explicitly`);
    else for (const k of WAIVER_KEYS) if (w[k] == null || (Array.isArray(w[k]) && !w[k].length) || w[k] === '') errors.push(`${where}: baseline_waived.${k} is missing`);
  } else if (floors.length) {
    const top = Math.max(...floors);
    if (ci.baseline_ms !== top) errors.push(`${where}: baseline_ms is ${ci.baseline_ms}, but max(observed_floors_ms) is ${top}`);
    const spread = Math.max(...floors) / Math.min(...floors);
    const power = spread * (ci.tolerance ?? Infinity);
    if (power > DETECTION_BOUND + 1e-9) errors.push(`${where}: floor spread ${round(spread)}× × tolerance ${ci.tolerance} = ${round(power)} exceeds ${DETECTION_BOUND}, so the rule would hide a 20 % regression; either the floors are too noisy for a baseline (waive it) or the tolerance is too wide`);
  }
  return errors;
}

// One round against the rules. `errors` are reasons the round is not a measurement at all and are
// never re-measured away; `breaches` are budget exceedances, which CI confirms before failing.
export function evaluateRound({ envClass, budgets, results, runnerClass }) {
  const out = [];
  const errors = [];
  const breaches = [];
  if (!results) return { out, errors: ['results/perf.json missing; run scripts/measure-startup.mjs first'], breaches };
  if (results.env_class !== envClass) errors.push(`results/perf.json env_class is ${results.env_class ?? 'absent'}, expected ${envClass}`);

  if (envClass === 'reference') {
    const median = results.median_ms;
    if (median == null) errors.push('median_ms missing from results/perf.json');
    else if (median > budgets.product.cold_start_first_text_ms) breaches.push({ label: `cold_start_first_text_ms: median ${median} ms > ${budgets.product.cold_start_first_text_ms} ms (product budget)`, margin: round(median - budgets.product.cold_start_first_text_ms) });
    else out.push(`cold_start_first_text_ms: median ${median} ms ≤ ${budgets.product.cold_start_first_text_ms} ms (product budget)`);
    for (const k of METRICS.slice(1)) {
      const v = results[k];
      if (v == null) continue;
      if (v > budgets.product[k]) breaches.push({ label: `${k}: ${v} ms > ${budgets.product[k]} ms (product budget)`, margin: round(v - budgets.product[k]) });
      else out.push(`${k}: ${v} ms ≤ ${budgets.product[k]} ms (product budget)`);
    }
    return { out, errors, breaches };
  }

  const cls = runnerClass ?? results.runner_class;
  const ci = cls ? budgets.ci[cls] : undefined;
  if (!ci) {
    errors.push(`unknown runner class ${cls ? `"${cls}"` : '(unset)'}; add it to fixtures/perf-budgets.json under "ci"`);
    return { out, errors, breaches };
  }
  errors.push(...validateClassConfig(cls, ci));
  if (errors.length) return { out, errors, breaches };
  out.push(`runner class ${cls}: envelope ×${ci.multiplier}, baseline ${ci.baseline_ms ?? `waived (${ci.baseline_waived?.reason})`}, tolerance ${ci.tolerance}, runs_n ${ci.runs_n}`);

  if (results.runs_n !== ci.runs_n) errors.push(`results/perf.json runs_n is ${results.runs_n ?? 'absent'}, but ${cls}'s floors were recorded at runs_n ${ci.runs_n}; a minimum of N is only comparable to a baseline taken at the same N`);
  if (typeof results.usable_runs !== 'number' || results.usable_runs < ci.runs_n - 1) errors.push(`results/perf.json usable_runs is ${results.usable_runs ?? 'absent'}, below the ${ci.runs_n - 1} post-warm-up launches the round asked for; a floor over fewer launches is not a floor`);
  if (results.cold_plausible === false) errors.push(`results/perf.json floor ${results.floor_ms} ms is ${results.cold_ratio}× below the round's median ${results.median_ms} ms; the launches were not uniformly cold, so the minimum is not a cold floor`);
  const floor = results.floor_ms;
  if (floor == null) errors.push('floor_ms missing from results/perf.json');
  if (errors.length) return { out, errors, breaches };

  const envelope = budgets.product.cold_start_first_text_ms * ci.multiplier;
  const baselineCeiling = ci.baseline_ms == null ? Infinity : round(ci.baseline_ms * ci.tolerance);
  const limit = Math.min(envelope, baselineCeiling);
  if (floor > envelope) breaches.push({ label: `cold_start_first_text_ms: floor ${floor} ms exceeds the envelope ${envelope} ms (product ${budgets.product.cold_start_first_text_ms} ms × ${ci.multiplier})`, margin: round(floor - envelope) });
  if (floor > baselineCeiling) breaches.push({ label: `cold_start_first_text_ms: floor ${floor} ms exceeds the baseline ceiling ${baselineCeiling} ms (baseline ${ci.baseline_ms} ms × ${ci.tolerance})`, margin: round(floor - baselineCeiling) });
  if (floor <= limit) out.push(`cold_start_first_text_ms: floor ${floor} ms ≤ ${round(limit)} ms (min of envelope ${envelope} ms and baseline ceiling ${baselineCeiling === Infinity ? 'none' : `${baselineCeiling} ms`})`);

  // The remaining product budgets still gate in CI, against the same runner envelope: a check
  // that stops running is a check that has been removed.
  for (const k of METRICS.slice(1)) {
    const v = results[k];
    if (v == null) continue;
    const env = budgets.product[k] * ci.multiplier;
    if (v > env) breaches.push({ label: `${k}: ${v} ms exceeds the envelope ${env} ms (product ${budgets.product[k]} ms × ${ci.multiplier})`, margin: round(v - env) });
    else out.push(`${k}: ${v} ms ≤ ${env} ms (envelope)`);
  }
  return { out, errors, breaches };
}

// A breach is confirmed before it is a failure: in CI a breaching round is re-measured, up to
// MAX_ROUNDS in the same job, and the gate fails only when every round breaches. The pass path is
// loud — the breaching round and its margin are printed and recorded — so noise stays countable.
export async function runGate({ envClass, budgets, results, runnerClass, measure, maxRounds = MAX_ROUNDS }) {
  const out = [];
  const fails = [];
  const rounds = [];
  let current = results;
  const limit = envClass === 'ci' && measure ? maxRounds : 1;
  for (let i = 0; i < limit; i++) {
    const r = evaluateRound({ envClass, budgets, results: current, runnerClass });
    rounds.push({ round: i + 1, floor_ms: current?.floor_ms ?? null, median_ms: current?.median_ms ?? null, breaches: r.breaches });
    for (const line of r.out) out.push(limit > 1 ? `round ${i + 1}: ${line}` : line);
    if (r.errors.length) return { ok: false, out, fails: r.errors, rounds };
    if (!r.breaches.length) {
      if (i > 0) out.push(`confirmed noise: round 1 breached — ${rounds[0].breaches.map(b => `${b.label} by ${b.margin} ms`).join('; ')} — but round ${i + 1} did not reproduce it`);
      return { ok: true, out, fails, rounds };
    }
    if (i + 1 < limit) {
      out.push(`round ${i + 1} breached; re-measuring before failing (ADR-0022 Amendment 1)`);
      current = await measure();
    }
  }
  for (const r of rounds) for (const b of r.breaches) fails.push(`round ${r.round}: ${b.label} by ${b.margin} ms`);
  return { ok: false, out, fails, rounds };
}

// The `product` object is the reader's promise and this story may not move it: compared byte for
// byte against another revision of the file, not field by field, so a reordering is caught too.
export function productSlice(text) {
  const start = text.indexOf('"product"');
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function assertProductUnchanged(ref) {
  const path = 'fixtures/perf-budgets.json';
  const before = execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  const after = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const a = productSlice(before);
  const b = productSlice(after);
  if (a == null || b == null) { console.error(`perf gate: no "product" object in ${path} at ${a == null ? ref : 'HEAD'}`); process.exit(1); }
  if (a !== b) {
    console.error(`perf gate: the product budgets changed against ${ref}; they are the reader's promise and no perf-gate story may move them\n--- ${ref}\n${a}\n--- working tree\n${b}`);
    process.exit(1);
  }
  console.log(`perf gate: the product budgets are byte-identical to ${ref} (${a.length} bytes)`);
  process.exit(0);
}

// The gate and the measurement must stay required on both runner classes: a gate that can be
// skipped or forced green is measurement theatre (ADR-0022 Amendment 1).
export function checkWorkflow(text) {
  const errors = [];
  const gates = text.slice(text.indexOf('\n  gates:'));
  for (const os of ['macos-latest', 'ubuntu-latest']) {
    if (!new RegExp(`os:.*${os}`).test(gates)) errors.push(`.github/workflows/ci.yml: the gates matrix does not include ${os}`);
  }
  if (!/fail-fast:\s*false/.test(gates)) errors.push('.github/workflows/ci.yml: the gates matrix must keep fail-fast: false so both runner classes report');
  const steps = gates.split(/\n      - /).slice(1);
  const guarded = steps.filter(s => /measure-startup\.mjs|gate:perf/.test(s) && !/upload-artifact/.test(s));
  for (const needle of ['measure-startup.mjs', 'gate:perf']) {
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
const derived = { commit: 'deadbee', runner_image: 'selftest', runs_n: 12 };
const WAIVER = { reason: 'selftest', observed_floors_ms: [400, 500, 600, 700, 800], escalated_to: 'ian', date: '2026-09-18' };
const SELFTEST_BUDGETS = {
  product: PRODUCT,
  ci: {
    'ubuntu-latest': { multiplier: 20, baseline_ms: 7719, tolerance: 1.09, runs_n: 12, observed_floors_ms: [7320, 7400, 7500, 7600, 7719], derived_from: derived },
    'macos-latest': { multiplier: 5, baseline_ms: 1901, tolerance: 1.1, runs_n: 12, observed_floors_ms: [1800, 1830, 1860, 1880, 1901], derived_from: derived },
    'no-baseline': { multiplier: 5, baseline_ms: null, tolerance: 1.1, runs_n: 12, observed_floors_ms: [400, 500, 600, 700, 800], derived_from: derived, baseline_waived: WAIVER },
    'few-floors': { multiplier: 20, baseline_ms: 7719, tolerance: 1.09, runs_n: 12, observed_floors_ms: [7600, 7700, 7719], derived_from: derived },
    'baseline-not-max': { multiplier: 20, baseline_ms: 7400, tolerance: 1.09, runs_n: 12, observed_floors_ms: [7320, 7400, 7500, 7600, 7719], derived_from: derived },
    'tolerance-too-small': { multiplier: 20, baseline_ms: 7719, tolerance: 1.01, runs_n: 12, observed_floors_ms: [7320, 7400, 7500, 7600, 7719], derived_from: derived },
    'too-wide': { multiplier: 20, baseline_ms: 7719, tolerance: 1.15, runs_n: 12, observed_floors_ms: [7320, 7400, 7500, 7600, 7719], derived_from: derived },
    'at-the-bound': { multiplier: 20, baseline_ms: 7719, tolerance: 1.137, runs_n: 12, observed_floors_ms: [7320, 7400, 7500, 7600, 7719], derived_from: derived },
    'waiver-no-record': { multiplier: 5, baseline_ms: null, tolerance: 1.1, runs_n: 12, observed_floors_ms: [400, 500, 600, 700, 800], derived_from: derived },
    'waiver-incomplete': { multiplier: 5, baseline_ms: null, tolerance: 1.1, runs_n: 12, observed_floors_ms: [400, 500, 600, 700, 800], derived_from: derived, baseline_waived: { reason: 'x', observed_floors_ms: [400], date: '2026-09-18' } },
  },
};

const ciResult = (runner_class, floor_ms, over = {}) => ({ env_class: 'ci', runner_class, floor_ms, median_ms: Math.round(floor_ms * 1.05), runs: [floor_ms], warmup_ms: 9000, runs_n: 12, usable_runs: 11, cold_ratio: 1.05, cold_plausible: true, rounds: [], ...over });

// Every case is named, and the names from the MARXY-55 suite are required to survive: a rule that
// stops being checked has been deleted whatever the file says.
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

const SELFTEST_CASES = [
  { name: 'ci: inside both rules passes', envClass: 'ci', results: ciResult('ubuntu-latest', 7000), expect: 0 },
  { name: 'ci: above the envelope fails', envClass: 'ci', results: ciResult('ubuntu-latest', 10_500), expect: 1 },
  { name: 'ci: 11 % above the baseline fails even far below the envelope', envClass: 'ci', results: ciResult('ubuntu-latest', 8568), expect: 1 },
  { name: 'reference: 501 ms fails the product budget', envClass: 'reference', results: { env_class: 'reference', median_ms: 501 }, expect: 1 },
  { name: 'reference: missing results fails', envClass: 'reference', results: null, expect: 1 },
  { name: 'reference: results measured in ci mode fails', envClass: 'reference', results: { env_class: 'ci', median_ms: 400 }, expect: 1 },
  { name: 'ci: unknown runner class fails', envClass: 'ci', results: ciResult('windows-latest', 400), expect: 1 },
  { name: 'ci: a null baseline still enforces the envelope', envClass: 'ci', results: ciResult('no-baseline', 2600), expect: 1 },
  { name: 'ci: a null baseline passes under the envelope', envClass: 'ci', results: ciResult('no-baseline', 2400), expect: 0 },
  { name: 'reference: a median under the product budget passes and never re-measures', envClass: 'reference', results: { env_class: 'reference', median_ms: 480 }, expect: 0, remeasures: 0 },
  { name: 'reference: a breach never re-measures', envClass: 'reference', results: { env_class: 'reference', median_ms: 501 }, expect: 1, remeasures: 0 },
  { name: 'ci: floor_ms missing fails', envClass: 'ci', results: ciResult('ubuntu-latest', 7000, { floor_ms: null }), expect: 1 },
  { name: 'ci: a round measured at another runs_n fails', envClass: 'ci', results: ciResult('ubuntu-latest', 7000, { runs_n: 8 }), expect: 1 },
  { name: 'ci: fewer usable launches than the round asked for fails', envClass: 'ci', results: ciResult('ubuntu-latest', 7000, { usable_runs: 6 }), expect: 1 },
  { name: 'ci: a floor implausibly far below the round median fails', envClass: 'ci', results: ciResult('macos-latest', 463, { median_ms: 2400, cold_ratio: 5.2, cold_plausible: false }), expect: 1 },
  { name: 'ci: three breaching rounds fail and name every round', envClass: 'ci', results: ciResult('ubuntu-latest', 10_500), measurements: [ciResult('ubuntu-latest', 10_600), ciResult('ubuntu-latest', 10_700)], expect: 1, remeasures: 2, assert: ({ fails }) => [1, 2, 3].every(n => fails.some(f => f.startsWith(`round ${n}:`) && /exceeds/.test(f))) || 'not every round and margin is named' },
  { name: 'ci: a breach followed by a clean round passes as confirmed noise', envClass: 'ci', results: ciResult('ubuntu-latest', 8568), measurements: [ciResult('ubuntu-latest', 7400)], expect: 0, remeasures: 1, assert: ({ out, rounds }) => (out.some(l => /confirmed noise/.test(l) && /baseline ceiling/.test(l)) && rounds.length === 2) || 'the confirmed-noise line or the recorded rounds are missing' },
  { name: 'ci: a clean first round never re-measures', envClass: 'ci', results: ciResult('ubuntu-latest', 7000), measurements: [ciResult('ubuntu-latest', 7000)], expect: 0, remeasures: 0 },
  { name: 'config: fewer than five observed_floors_ms fails', envClass: 'ci', results: ciResult('few-floors', 7000), expect: 1 },
  { name: 'config: baseline_ms not equal to max(observed_floors_ms) fails', envClass: 'ci', results: ciResult('baseline-not-max', 7000), expect: 1 },
  { name: 'config: a tolerance below 1.05 fails', envClass: 'ci', results: ciResult('tolerance-too-small', 7000), expect: 1 },
  { name: 'config: spread × tolerance above 1.20 fails', envClass: 'ci', results: ciResult('too-wide', 7000), expect: 1 },
  { name: 'config: spread × tolerance at the 1.20 bound passes', envClass: 'ci', results: ciResult('at-the-bound', 7000), expect: 0 },
  { name: 'config: derived_from without runs_n fails', envClass: 'ci', results: ciResult('ubuntu-latest', 7000), budgets: { product: PRODUCT, ci: { 'ubuntu-latest': { ...SELFTEST_BUDGETS.ci['ubuntu-latest'], derived_from: { commit: 'deadbee', runner_image: 'selftest' } } } }, expect: 1 },
  { name: 'waiver: baseline_ms null without baseline_waived fails', envClass: 'ci', results: ciResult('waiver-no-record', 2400), expect: 1 },
  { name: 'waiver: baseline_waived missing a required key fails', envClass: 'ci', results: ciResult('waiver-incomplete', 2400), expect: 1 },
];

async function selftest() {
  let bad = 0;
  const report = (ok, name, detail) => { if (ok) console.log(`selftest ok: ${name}`); else { bad++; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); } };

  for (const c of SELFTEST_CASES) {
    const queue = [...(c.measurements ?? [])];
    let calls = 0;
    const measure = async () => { calls++; return queue.shift() ?? c.results; };
    const { ok, out, fails, rounds } = await runGate({ envClass: c.envClass, budgets: c.budgets ?? SELFTEST_BUDGETS, results: c.results, runnerClass: c.results?.runner_class, measure });
    const code = ok ? 0 : 1;
    let detail = null;
    if (code !== c.expect) detail = `exit ${code}, want ${c.expect}${fails.length ? `: ${fails[0]}` : ''}`;
    else if (c.remeasures != null && calls !== c.remeasures) detail = `re-measured ${calls} time(s), want ${c.remeasures}`;
    else if (c.assert) { const r = c.assert({ out, fails, rounds }); if (r !== true) detail = r; }
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

  // The rules above are only worth anything if the shipped configuration and workflow obey them.
  const shipped = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
  const configErrors = Object.entries(shipped.ci).flatMap(([cls, ci]) => validateClassConfig(cls, ci));
  report(configErrors.length === 0, 'config: the shipped fixtures/perf-budgets.json satisfies every configuration rule', configErrors.join('; '));
  const workflowErrors = checkWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  report(workflowErrors.length === 0, 'workflow: the measurement and the perf gate are required on both runner classes, with no continue-on-error and no || true', workflowErrors.join('; '));
  // The workflow check is only worth running if it can fail, so it is run against the workflow with
  // each of the softenings it exists to forbid put back in.
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const [what, mutated] of [
    ['continue-on-error on the perf gate step', workflow.replace('      - name: Perf gate (CI envelope and baseline, ADR-0022)\n', '      - name: Perf gate (CI envelope and baseline, ADR-0022)\n        continue-on-error: true\n')],
    ['|| true on the measurement step', workflow.replace('        run: node scripts/measure-startup.mjs\n', '        run: node scripts/measure-startup.mjs || true\n')],
    ['the perf gate skipped on one runner class', workflow.replace('        run: pnpm gate:perf\n', "        if: runner.os == 'Linux'\n        run: pnpm gate:perf\n")],
    ['macos-latest dropped from the matrix', workflow.replace('os: [macos-latest, ubuntu-latest]', 'os: [ubuntu-latest]')],
  ]) {
    report(checkWorkflow(mutated).length > 0, `workflow: ${what} is rejected`);
  }
  const edited = JSON.stringify(shipped, null, 2).replace('"cold_start_first_text_ms": 500', '"cold_start_first_text_ms": 900');
  report(productSlice(edited) !== productSlice(JSON.stringify(shipped, null, 2)), 'product: an edited product budget is detected byte for byte');

  const cases = SELFTEST_CASES.length + 13;
  if (cases < 22) { bad++; console.error(`selftest FAIL: ${cases} named cases, the suite must keep at least 22`); }
  if (bad) { console.error(`perf gate selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`perf gate selftest ok: ${cases} named cases`);
  process.exit(0);
}

const productRef = process.argv.indexOf('--assert-product-unchanged');
if (productRef !== -1) assertProductUnchanged(process.argv[productRef + 1] ?? 'origin/main');
if (process.argv.includes('--selftest')) await selftest();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
const { envClass, error } = resolveEnvClass(process.env);
if (error) { console.error(`perf gate: ${error}`); process.exit(1); }
const resultsPath = new URL('../results/perf.json', import.meta.url);
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : null;
console.log(`perf gate: ${envClass} mode`);
const { measureRound } = await import('./measure-startup.mjs');
const measure = async () => {
  const summary = await measureRound({});
  return { ...summary, platform: process.platform, env_class: envClass, runner_class: results?.runner_class ?? null, rounds: [] };
};
const { ok, out, fails, rounds } = await runGate({ envClass, budgets, results, runnerClass: process.env.MARXY_RUNNER_CLASS || undefined, measure });
for (const line of out) console.log(line);
// Every round the gate measured is written back into the artifact, so confirmed-noise passes stay
// countable (delta 2026-09-18, signal 1). results/ is not in the repository; CI never writes to it.
if (results) writeFileSync(resultsPath, JSON.stringify({ ...results, rounds }, null, 2));
if (!ok) { console.error('perf gate failed:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('perf gate ok');
