// Performance budgets as hard failures (ADR-0013), in two tiers (ADR-0022): product budgets on
// reference hardware (MARXY_PERF_ENV=reference), an envelope plus a per-runner baseline in CI
// (MARXY_PERF_ENV=ci). Amendment 1 splits the CI metric. Amendment 2: reference records
// median(cold_launches) over k ≥ 5 certified cold launches and never compares it to a product
// ceiling. Reads fixtures/perf-budgets.json and results/perf.json. `--selftest` runs every rule
// over inline fixtures; `--assert-budgets-unchanged <ref>` compares the budgets file byte for byte.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { SELFTEST_CASE_NAMES as MEASURE_CASE_NAMES, MIN_WARM_RUNS, MIN_COLD_LAUNCHES, median } from './measure-startup.mjs';

const METRICS = ['cold_start_first_text_ms', 'open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms'];
// ADR-0022 set 10 %; MARXY-83 widened it to 30 % after identical code measured 1901 ms and 2113 ms warm
// on two macos-latest machines (11 % apart, webview initialisation being 95 % of each launch). A band
// narrower than the runner population's spread gates on machine assignment, not on the code. The ×5
// envelope still catches a real regression, and a breach is re-measured once before it fails.
const BASELINE_TOLERANCE = 1.3;
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

// Reference-tier sufficiency (ADR-0022 Amendment 2): a certified cold round, not a warm median
// compared to a withdrawn ceiling. The CI recordSufficiency stays for the 1+8 launch shape.
export function referenceSufficiency(results) {
  const fails = [];
  if (!results.cold_procedure) fails.push('cold_procedure is absent or empty; a record must state what made each launch cold ("process-cold only" is a legitimate answer)');
  const stat = results.cold_launches;
  const n = results.cold_launches_n;
  if (!Array.isArray(stat) || typeof n !== 'number' || n < MIN_COLD_LAUNCHES || stat.length < MIN_COLD_LAUNCHES) {
    fails.push(`cold_launches_n is ${n ?? 'absent'}; the reference statistic needs at least ${MIN_COLD_LAUNCHES} certified cold launches`);
  } else if (n !== stat.length) {
    fails.push(`cold_launches_n ${n} does not count cold_launches (${stat.length})`);
  }
  if (results.cold_start_first_text_ms == null) {
    fails.push('cold_start_first_text_ms is absent; the reference statistic is the median of cold_launches and a record without it is not enough to gate on');
  }
  if (Array.isArray(stat)) {
    const unused = (Array.isArray(results.launches) ? results.launches : []).filter(l => l.cold === true);
    for (const ms of stat) {
      const i = unused.findIndex(l => l.ms === ms);
      if (i === -1) {
        fails.push('a launch not certified cold appears inside the cold statistic');
        break;
      }
      unused.splice(i, 1);
    }
  }
  return fails;
}

// Pure so --selftest can drive it: results === null means results/perf.json was absent.
export function evaluate({ envClass, budgets, results, runnerClass }) {
  const out = [];
  const fails = [];
  if (!results) return { ok: false, out, fails: ['results/perf.json missing; run scripts/measure-startup.mjs first'] };
  if (results.env_class !== envClass) fails.push(`results/perf.json env_class is ${results.env_class ?? 'absent'}, expected ${envClass}`);

  const warm = results.warm_start_first_text_ms;
  const cold = results.cold_start_first_text_ms;

  if (envClass === 'reference') {
    if (Array.isArray(results.cold_launches)) {
      fails.push(...referenceSufficiency(results));
      const marked = results.cold_launches.filter(v => typeof v === 'number');
      const med = median(marked);
      if (med != null) out.push(`cold start (median of ${results.cold_launches_n} certified cold launches, ${results.cold_procedure}): ${med} ms — recorded; no product ceiling`);
    } else {
      // Old-shape records still get the Amendment 1 sufficiency checks so those named cases survive;
      // they cannot pass, because they have no certified cold round.
      fails.push(...recordSufficiency(results));
      fails.push(`cold_launches_n is ${results.cold_launches_n ?? 'absent'}; the reference statistic needs at least ${MIN_COLD_LAUNCHES} certified cold launches`);
    }
    for (const k of METRICS.slice(1)) {
      const v = results[k];
      if (v == null) continue;
      if (v > budgets.product[k]) fails.push(`${k}: ${v} ms > ${budgets.product[k]} ms (product budget)`);
      else out.push(`${k}: ${v} ms ≤ ${budgets.product[k]} ms (product budget)`);
    }
    return { ok: fails.length === 0, out, fails };
  }

  fails.push(...recordSufficiency(results));
  if (cold != null) out.push(`cold start (launch 1, ${results.cold_procedure}): ${cold} ms — recorded and printed; ${CI_COLD_CEILING_STORY} derives the ceiling it will be held to`);
  if (results.cold_warm_ratio != null) out.push(`cold/warm ratio: ${results.cold_warm_ratio}× (launch 1 against the median of launches 2..${results.runs_n})`);

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
    if (warm > baselineCeiling) fails.push(`warm_start_first_text_ms (median of launches 2..${results.runs_n}): ${warm} ms exceeds the baseline ceiling ${round(baselineCeiling)} ms (baseline ${ci.baseline_ms} ms + 30 %) by ${round(warm - baselineCeiling)} ms`);
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
    console.error(`perf gate: ${path} differs from ${ref}; MARXY-69 does not change a number in ${path}`);
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
const COLD5 = [2400, 2300, 2500, 2450, 2350]; // median 2400
const certified = ms => ms.map((v, i) => ({ index: i + 1, ms: v, ok: typeof v === 'number', cold: true, exit_code: 0, stderr_tail: '' }));
const referenceCold = (over = {}) => ({
  env_class: 'reference',
  runner_class: null,
  cold_start_first_text_ms: 2400,
  warm_start_first_text_ms: null,
  cold_warm_ratio: null,
  cold_procedure: 'process-cold only',
  cold_launches: COLD5,
  cold_launches_n: 5,
  runs: COLD5,
  warm_runs: [],
  warm_runs_n: 0,
  runs_n: 5,
  usable_runs: 5,
  launches: certified(COLD5),
  ...over,
});

// The names from the MARXY-55 suite are required to survive, adapted only where a key was renamed:
// a rule that stops being checked has been deleted whatever the file says.
const MARXY_55_CASE_NAMES = [
  'ci: inside both rules passes',
  'ci: above the envelope fails',
  'ci: 31 % above the baseline fails even far below the envelope',
  'reference: 501 ms fails the product budget',
  'reference: missing results fails',
  'reference: results measured in ci mode fails',
  'ci: unknown runner class fails',
  'ci: a null baseline still enforces the envelope',
  'ci: a null baseline passes under the envelope',
];

const has = (fails, re) => fails.some(f => re.test(f));

function referenceEvaluateSource(text) {
  const marker = "if (envClass === 'reference')";
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return '';
}
const SELFTEST_CASES = [
  { name: 'ci: inside both rules passes', envClass: 'ci', results: result(), expect: 0 },
  { name: 'ci: above the envelope fails', envClass: 'ci', results: result({ warm_start_first_text_ms: 10_500 }), expect: 1, assert: f => has(f, /exceeds the envelope 10000 ms/) },
  { name: 'ci: 31 % above the baseline fails even far below the envelope', envClass: 'ci', results: result({ runner_class: 'macos-latest', warm_start_first_text_ms: 2490 }), expect: 1, assert: f => has(f, /exceeds the baseline ceiling 2471.3 ms/) },
  { name: 'reference: 501 ms fails the product budget', envClass: 'reference', results: referenceCold({ typeset_viewport_ms: 501 }), expect: 1, assert: f => has(f, /501 ms > 100 ms \(product budget\)/) },
  { name: 'reference: missing results fails', envClass: 'reference', results: null, expect: 1 },
  { name: 'reference: results measured in ci mode fails', envClass: 'reference', results: result({ warm_start_first_text_ms: 400 }), expect: 1, assert: f => has(f, /env_class is ci, expected reference/) },
  { name: 'ci: unknown runner class fails', envClass: 'ci', results: result({ runner_class: 'windows-latest' }), expect: 1 },
  { name: 'ci: a null baseline still enforces the envelope', envClass: 'ci', results: result({ runner_class: 'no-baseline', warm_start_first_text_ms: 2600 }), expect: 1, assert: f => has(f, /exceeds the envelope 2500 ms/) },
  { name: 'ci: a null baseline passes under the envelope', envClass: 'ci', results: result({ runner_class: 'no-baseline', warm_start_first_text_ms: 2400 }), expect: 0 },
  { name: 'ci: the rule names the quantity it gates as a warm start', envClass: 'ci', results: result({ warm_start_first_text_ms: 10_100 }), expect: 1, assert: f => has(f, /warm_start_first_text_ms \(median of launches 2\.\.9\)/) },
  { name: 'ci: usable_runs below runs_n fails', envClass: 'ci', results: result({ usable_runs: 1 }), expect: 1, assert: f => has(f, /only 1 of 9 launches produced a first_text mark/) },
  { name: 'reference: usable_runs below runs_n fails', envClass: 'reference', results: referenceResult({ usable_runs: 0, runs: [] }), expect: 1, assert: f => has(f, /of 9 launches produced a first_text mark/) },
  { name: 'ci: a missing cold_start_first_text_ms fails', envClass: 'ci', results: result({ cold_start_first_text_ms: null }), expect: 1, assert: f => has(f, /cold_start_first_text_ms is absent/) },
  { name: 'reference: a missing cold_start_first_text_ms fails', envClass: 'reference', results: referenceCold({ cold_start_first_text_ms: null }), expect: 1, assert: f => has(f, /cold_start_first_text_ms is absent/) },
  { name: 'ci: an absent or empty cold_procedure fails', envClass: 'ci', results: result({ cold_procedure: '' }), expect: 1, assert: f => has(f, /cold_procedure is absent or empty/) },
  { name: 'reference: an absent or empty cold_procedure fails', envClass: 'reference', results: referenceCold({ cold_procedure: '' }), expect: 1, assert: f => has(f, /cold_procedure is absent or empty/) },
  { name: 'ci: fewer than eight warm launches fails', envClass: 'ci', results: result({ warm_runs_n: 7 }), expect: 1, assert: f => has(f, /warm median needs at least 8 launches/) },
  { name: 'reference: fewer than eight warm launches fails', envClass: 'reference', results: referenceResult({ warm_runs_n: 7 }), expect: 1, assert: f => has(f, /warm median needs at least 8 launches/) },
  { name: 'ci: the cold metric is recorded and printed but held to no ceiling', envClass: 'ci', results: result({ cold_start_first_text_ms: 99_000 }), expect: 0, assertOut: o => o.some(l => /cold start \(launch 1/.test(l) && /99000 ms/.test(l) && /MARXY-70/.test(l)) },
  { name: 'reference: five certified cold launches with a recorded procedure exits 0', envClass: 'reference', results: referenceCold(), expect: 0 },
  { name: 'reference: a 501 ms cold median with a 500 ms product number exits 0', envClass: 'reference', results: referenceCold({
    cold_launches: [501, 501, 501, 501, 501],
    cold_launches_n: 5,
    cold_start_first_text_ms: 501,
    runs: [501, 501, 501, 501, 501],
    launches: certified([501, 501, 501, 501, 501]),
  }), expect: 0 },
  { name: 'reference: the placeholder unenforceable failure is gone and a 501 ms median does not trip it', envClass: 'reference', results: referenceCold({
    cold_launches: [501, 501, 501, 501, 501],
    cold_launches_n: 5,
    cold_start_first_text_ms: 501,
    runs: [501, 501, 501, 501, 501],
    launches: certified([501, 501, 501, 501, 501]),
  }), expect: 0, assert: f => f.length === 0 },
  { name: 'reference: cold_launches_n below 5 fails', envClass: 'reference', results: referenceCold({
    cold_launches: [2400, 2300, 2500],
    cold_launches_n: 3,
    runs: [2400, 2300, 2500],
    runs_n: 3,
    usable_runs: 3,
    launches: certified([2400, 2300, 2500]),
  }), expect: 1, assert: f => has(f, /cold_launches_n is 3/) },
  { name: 'reference: a launch not certified cold inside the cold statistic fails', envClass: 'reference', results: referenceCold({
    cold_launches: [2400, 2300, 2500, 2450, 400],
    cold_start_first_text_ms: 2300,
    launches: [
      ...certified([2400, 2300, 2500, 2450]),
      { index: 5, ms: 400, ok: true, cold: false, exit_code: 0, stderr_tail: '' },
    ],
  }), expect: 1, assert: f => has(f, /not certified cold/) },
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

  const PLACEHOLDER_CASE = 'reference: a warm median under the product budget still fails, naming the story that restores enforcement';
  report(!SELFTEST_CASES.some(c => c.name === PLACEHOLDER_CASE), 'reference: the MARXY-63 placeholder case is gone');

  const MARXY_63_CASE_NAMES = [
    ...MARXY_55_CASE_NAMES,
    'ci: the rule names the quantity it gates as a warm start',
    'ci: usable_runs below runs_n fails',
    'reference: usable_runs below runs_n fails',
    'ci: a missing cold_start_first_text_ms fails',
    'reference: a missing cold_start_first_text_ms fails',
    'ci: an absent or empty cold_procedure fails',
    'reference: an absent or empty cold_procedure fails',
    'ci: fewer than eight warm launches fails',
    'reference: fewer than eight warm launches fails',
    'ci: the cold metric is recorded and printed but held to no ceiling',
  ];
  for (const name of MARXY_63_CASE_NAMES) {
    if (!SELFTEST_CASES.some(c => c.name === name)) { bad++; console.error(`selftest FAIL: the MARXY-63 case "${name}" is no longer in the suite`); }
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
  let mainProduct = null;
  try {
    mainProduct = JSON.stringify(JSON.parse(execFileSync('git', ['show', 'origin/main:fixtures/perf-budgets.json'], { encoding: 'utf8' })).product);
  } catch { /* origin/main may be missing in a shallow clone; the case then fails on purpose */ }
  report(
    mainProduct === JSON.stringify(shipped.product),
    'budgets: every number in the product object is byte-identical to origin/main',
    mainProduct == null ? 'could not read origin/main:fixtures/perf-budgets.json' : undefined,
  );

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

  const source = readFileSync(new URL('./gate-perf.mjs', import.meta.url), 'utf8');
  const refBlock = referenceEvaluateSource(source);
  report(
    refBlock.length > 0 && !refBlock.includes('product.cold_start_first_text_ms'),
    'reference: a comparison against product.cold_start_first_text_ms fails the selftest',
    refBlock.length ? 'the reference path of evaluate() compares against product.cold_start_first_text_ms' : 'could not find the reference branch of evaluate()',
  );

  const placeholder = ['not currently ', 'enforceable'].join('');
  const leftover = ['gate-perf.mjs', 'measure-startup.mjs']
    .filter(f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').includes(placeholder));
  report(leftover.length === 0, 'scripts: the product-budget placeholder leaves no residue', leftover.join(', '));

  // No case may be lost: the two suites together are asserted against a floor on their own size.
  const cases = ran + MEASURE_CASE_NAMES.length;
  if (cases < 30) { bad++; console.error(`selftest FAIL: ${cases} named cases across both suites, which must be at least 30`); }
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
const runnerClass = process.env.MARXY_RUNNER_CLASS || undefined;
let verdict = evaluate({ envClass, budgets, results, runnerClass });
for (const line of verdict.out) console.log(line);
// A shared runner's noise is one-sided and transient: a single warm median over the envelope or the
// baseline ceiling is confirmed by measuring once more before it fails the job. Only those two rules
// earn a second look; a record that is insufficient, or a reference-tier breach, fails at once.
const onlyBreach = verdict.fails.length > 0 && verdict.fails.every(f => /exceeds the (envelope|baseline ceiling)/.test(f));
if (!verdict.ok && envClass === 'ci' && onlyBreach && results && !results.confirmed) {
  console.log(`::warning::perf gate: ${verdict.fails.join('; ')} — re-measuring once to confirm`);
  const m = await import('./measure-startup.mjs');
  const launches = await m.measureLaunches({ log: console.log });
  const again = { ...m.perfRecord(m.summarise(launches), { envClass, runnerClass, launches }), confirmed: true, first_attempt: { warm_start_first_text_ms: results.warm_start_first_text_ms, cold_start_first_text_ms: results.cold_start_first_text_ms } };
  writeFileSync(resultsPath, JSON.stringify(again, null, 2) + '\n');
  verdict = evaluate({ envClass, budgets, results: again, runnerClass });
  for (const line of verdict.out) console.log(`(confirmation) ${line}`);
}
if (!verdict.ok) { console.error('perf gate failed:\n - ' + verdict.fails.join('\n - ')); process.exit(1); }
console.log(`perf gate ok${results?.confirmed ? ' (after one confirming re-measure)' : ''}`);
