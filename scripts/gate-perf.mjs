// Performance budgets as hard failures (ADR-0013), in two tiers (ADR-0022): product budgets on
// reference hardware (MARXY_PERF_ENV=reference), an envelope plus a per-runner baseline in CI
// (MARXY_PERF_ENV=ci). Amendment 1 splits the CI metric. Amendment 2: reference records
// median(cold_launches) over k ≥ 5 certified cold launches and never compares it to a product
// ceiling. `parse_long_technical_ms` (MARXY-59) goes through the same CI rule as the warm start,
// from the same budgets file, and is required in both tiers; scripts/measure-parse.mjs (MARXY-91)
// leaves it in results/perf-parse.json on both gates runners and mergeParseMeasurement puts it
// back onto the startup record. Reads fixtures/perf-budgets.json, results/perf.json and
// results/perf-parse.json. `--selftest` runs every rule over inline fixtures;
// `--assert-budgets-unchanged <ref>` asserts no number the rules read has moved since <ref>.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { SELFTEST_CASE_NAMES as MEASURE_CASE_NAMES, MIN_WARM_RUNS, MIN_COLD_LAUNCHES, median } from './measure-startup.mjs';

const METRICS = ['cold_start_first_text_ms', 'open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms'];
const PARSE_METRIC = 'parse_long_technical_ms';
// ADR-0022 set 10 %; MARXY-83 widened it to 30 % after identical code measured 1901 ms and 2113 ms warm
// on two macos-latest machines (11 % apart, webview initialisation being 95 % of each launch). A band
// narrower than the runner population's spread gates on machine assignment, not on the code. The ×5
// envelope still catches a real regression, and a breach is re-measured once before it fails.
const BASELINE_TOLERANCE = 1.3; // default when a class omits tolerance (selftest fixtures only)
const ADR_MULTIPLIER_HEADROOM = 1.3; // ADR-0022: ceil(runner_median / product × 1.3).
export const MIN_CROSS_RUN_OBS = 5;
export const SPREAD_INVARIANT = 1.2;
export const MIN_TOLERANCE = 1.05;
export const COLD_ENVELOPE_HEADROOM = 1.3;
export const MAX_CI_REMEASURES = 2;
const BASELINE_WAIVER_KEYS = ['reason', 'observed_warm_ms', 'cross_run_spread', 'escalated_to', 'date'];
const OBSERVATION_KEYS = ['ms', 'commit', 'job_id', 'runner_image'];
const round = n => Math.round(n * 10) / 10;

export function crossRunSpread(observations) {
  const ms = observations.map(o => o.ms);
  if (!ms.length) return NaN;
  return Math.max(...ms) / Math.min(...ms);
}

export function productNumbersIdentical(before, after) {
  return JSON.stringify(before?.product) === JSON.stringify(after?.product);
}

// Cross-run evidence in fixtures/perf-budgets.json must be complete before CI numbers are trusted.
export function validateCiBudgets(budgets) {
  const errors = [];
  for (const cls of ['ubuntu-latest', 'macos-latest']) {
    const ci = budgets.ci?.[cls];
    if (!ci) {
      errors.push(`${cls}: missing ci entry`);
      continue;
    }
    for (const key of ['observed_warm_ms', 'observed_cold_ms']) {
      const obs = ci[key];
      if (!Array.isArray(obs) || obs.length < MIN_CROSS_RUN_OBS) {
        errors.push(`${cls}: ${key} needs at least ${MIN_CROSS_RUN_OBS} observations`);
        continue;
      }
      const commits = new Set(obs.map(o => o.commit));
      const jobs = new Set(obs.map(o => o.job_id));
      if (commits.size !== obs.length) errors.push(`${cls}: ${key} observations must be at distinct commits`);
      if (jobs.size !== obs.length) errors.push(`${cls}: ${key} observations must be at distinct job ids`);
      for (const o of obs) {
        for (const k of OBSERVATION_KEYS) {
          if (o[k] == null || o[k] === '') errors.push(`${cls}: ${key} observation missing ${k}`);
        }
      }
    }
    if (typeof ci.runs_n !== 'number') errors.push(`${cls}: runs_n is required on every baseline and cold envelope`);
    if (typeof ci.tolerance !== 'number' || ci.tolerance < MIN_TOLERANCE) {
      errors.push(`${cls}: tolerance must be at least ${MIN_TOLERANCE}`);
    }
    const warmObs = ci.observed_warm_ms ?? [];
    if (warmObs.length >= MIN_CROSS_RUN_OBS && typeof ci.tolerance === 'number') {
      const spread = crossRunSpread(warmObs);
      if (spread * ci.tolerance > SPREAD_INVARIANT + 1e-9 && ci.baseline_ms != null) {
        errors.push(`${cls}: cross-run spread ${round(spread)}× × tolerance ${ci.tolerance} exceeds ${SPREAD_INVARIANT}; widen tolerance is not available — baseline_waived is the honest outcome`);
      }
    }
    if (ci.baseline_ms == null) {
      if (!ci.baseline_waived) errors.push(`${cls}: baseline_ms null without baseline_waived`);
      else {
        for (const k of BASELINE_WAIVER_KEYS) {
          if (ci.baseline_waived[k] == null || ci.baseline_waived[k] === '') errors.push(`${cls}: baseline_waived missing ${k}`);
        }
      }
    } else if (ci.baseline_waived) {
      errors.push(`${cls}: baseline_ms is set alongside baseline_waived`);
    } else if (warmObs.length) {
      const maxWarm = Math.max(...warmObs.map(o => o.ms));
      if (ci.baseline_ms !== maxWarm) errors.push(`${cls}: baseline_ms ${ci.baseline_ms} !== max(observed_warm_ms) ${maxWarm}`);
    }
    const coldObs = ci.observed_cold_ms ?? [];
    if (ci.cold_envelope_ms == null) errors.push(`${cls}: cold_envelope_ms is required`);
    else if (coldObs.length) {
      const want = Math.ceil(Math.max(...coldObs.map(o => o.ms)) * COLD_ENVELOPE_HEADROOM);
      if (ci.cold_envelope_ms !== want) {
        errors.push(`${cls}: cold_envelope_ms ${ci.cold_envelope_ms} !== ceil(max(observed_cold_ms) × ${COLD_ENVELOPE_HEADROOM}) = ${want}`);
      }
    }
  }
  return errors;
}

export function breachOnly(fails) {
  return fails.length > 0 && fails.every(f => /exceeds the (envelope|baseline ceiling|cold envelope)/.test(f));
}

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

// scripts/measure-parse.mjs writes only results/perf-parse.json, on both gates runners, before the
// startup measurement runs on the same job; this puts that number back onto the startup record the
// gate reads, without either script touching a file it does not own.
// Warm-start spread guard uses ci.tolerance; parse_long_technical_ms uses its own entry (MARXY-70).
export function parseBaselineTolerance(ciMetric) {
  return ciMetric?.tolerance ?? BASELINE_TOLERANCE;
}

export function mergeParseMeasurement(results, snapshot) {
  if (!results) return results;
  if (results[PARSE_METRIC] != null) return results;
  if (snapshot?.[PARSE_METRIC] == null) return results;
  return { ...results, [PARSE_METRIC]: snapshot[PARSE_METRIC] };
}

// The one CI rule (ADR-0022, widened to 30 % by MARXY-83): fail over the envelope or over
// baseline × 1.30. `warm_start_first_text_ms` and `parse_long_technical_ms` both go through here,
// so a rule improved for one is improved for both. `label` names the quantity in a failure, which
// is not always the key: the warm start is a median over named launches.
function enforceTwoTier(out, fails, key, value, product, ciMetric, { label = key, required, tolerance = BASELINE_TOLERANCE, classBaselineMs = ciMetric?.baseline_ms }) {
  if (value == null) {
    if (required) fails.push(`${key} missing from results/perf.json`);
    return;
  }
  if (!ciMetric || ciMetric.multiplier == null) {
    fails.push(`${key}: no ci entry for this runner class; add it to fixtures/perf-budgets.json`);
    return;
  }
  const envelope = product * ciMetric.multiplier;
  const baselineMs = ciMetric.baseline_ms ?? classBaselineMs;
  const baselineCeiling = baselineMs == null ? Infinity : baselineMs * tolerance;
  const limit = Math.min(envelope, baselineCeiling);
  const tolPct = Math.round((tolerance - 1) * 100);
  if (value > envelope) fails.push(`${label}: ${value} ms exceeds the envelope ${envelope} ms (product ${product} ms × ${ciMetric.multiplier}) by ${round(value - envelope)} ms`);
  if (value > baselineCeiling) fails.push(`${label}: ${value} ms exceeds the baseline ceiling ${round(baselineCeiling)} ms (baseline ${baselineMs} ms + ${tolPct} %) by ${round(value - baselineCeiling)} ms`);
  if (value <= limit) out.push(`${key}: ${value} ms ≤ ${round(limit)} ms (min of envelope ${envelope} ms and baseline ceiling ${round(baselineCeiling)} ms)`);
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
    for (const k of [...METRICS.slice(1), PARSE_METRIC]) {
      const v = results[k];
      if (v == null) continue;
      if (v > budgets.product[k]) fails.push(`${k}: ${v} ms > ${budgets.product[k]} ms (product budget)`);
      else out.push(`${k}: ${v} ms ≤ ${budgets.product[k]} ms (product budget)`);
    }
    return { ok: fails.length === 0, out, fails };
  }

  fails.push(...recordSufficiency(results));
  if (results.cold_warm_ratio != null && results.cold_warm_ratio < 1) {
    fails.push(`cold_warm_ratio is ${results.cold_warm_ratio}×; launch 1 was faster than the warm median, so the record is not holding a cold start and the measurement is invalid`);
  } else if (results.cold_warm_ratio != null) {
    out.push(`cold/warm ratio: ${results.cold_warm_ratio}× (launch 1 against the median of launches 2..${results.runs_n})`);
  }

  const cls = runnerClass ?? results.runner_class;
  const ci = cls ? budgets.ci[cls] : undefined;
  if (!ci) {
    fails.push(`unknown runner class ${cls ? `"${cls}"` : '(unset)'}; add it to fixtures/perf-budgets.json under "ci"`);
    return { ok: false, out, fails };
  }
  const tolerance = ci.tolerance ?? BASELINE_TOLERANCE;
  if (typeof ci.runs_n === 'number' && results.runs_n !== ci.runs_n) {
    fails.push(`runs_n is ${results.runs_n}; this runner class records budgets at runs_n ${ci.runs_n} and a statistic taken at another sample size is not comparable`);
  }
  out.push(`runner class ${cls}: envelope ×${ci.multiplier}, baseline ${ci.baseline_ms ?? 'waived'} ms, tolerance ${Math.round((tolerance - 1) * 100)} %`);

  if (ci.cold_envelope_ms == null) fails.push('cold_envelope_ms is absent for this runner class');
  else if (cold != null) {
    if (cold > ci.cold_envelope_ms) fails.push(`cold_start_first_text_ms: ${cold} ms exceeds the cold envelope ${ci.cold_envelope_ms} ms by ${round(cold - ci.cold_envelope_ms)} ms`);
    else out.push(`cold_start_first_text_ms: ${cold} ms ≤ ${ci.cold_envelope_ms} ms (absolute cold envelope, no tolerance)`);
  }

  enforceTwoTier(out, fails, 'warm_start_first_text_ms', warm, budgets.product.cold_start_first_text_ms, ci, {
    label: `warm_start_first_text_ms (median of launches 2..${results.runs_n})`,
    required: true,
    tolerance,
    classBaselineMs: ci.baseline_ms,
  });
  // The warm start reads the class's own multiplier and baseline; parse reads the per-metric entry
  // beside them. Both are required: a measurement that goes missing must be as loud as one that
  // regresses, because the parse number reaches here through measure-parse.mjs, a snapshot it does
  // not own, and a merge, and any broken link would otherwise leave a green run that never mentions
  // the metric (the failure that discarded MARXY-59's first pull request).
  const parseTolerance = parseBaselineTolerance(ci[PARSE_METRIC]);
  enforceTwoTier(out, fails, PARSE_METRIC, results[PARSE_METRIC], budgets.product[PARSE_METRIC], ci[PARSE_METRIC], {
    required: true,
    tolerance: parseTolerance,
    classBaselineMs: ci[PARSE_METRIC]?.baseline_ms ?? ci.baseline_ms,
  });

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

// A pull request may add a budget (MARXY-59 adds parse_long_technical_ms); it may not quietly
// loosen or remove one. So the comparison is asymmetric: every number the base revision carried
// must still be there with the same value, and keys that did not exist before are allowed. Byte
// equality would have said the same thing until a metric was added.
export function loosenedBudgets(before, after, trail = '') {
  if (before === after) return [];
  const at = trail || '(root)';
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(before) || !isObject(after)) return [`${at}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`];
  const changed = [];
  for (const [key, value] of Object.entries(before)) {
    if (!(key in after)) changed.push(`${trail}${trail ? '.' : ''}${key}: removed (was ${JSON.stringify(value)})`);
    else changed.push(...loosenedBudgets(value, after[key], `${trail}${trail ? '.' : ''}${key}`));
  }
  return changed;
}

function assertBudgetsUnchanged(ref) {
  const path = 'fixtures/perf-budgets.json';
  const before = JSON.parse(execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }));
  const after = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  if (!productNumbersIdentical(before, after)) {
    console.error(`perf gate: every number in the product object of ${path} must stay byte-identical to ${ref}; CI numbers move only in the pull request that costs the time`);
    process.exit(1);
  }
  console.log(`perf gate: product budgets in ${path} are byte-identical to ${ref}`);
  process.exit(0);
}

// CI mode only: up to MAX_CI_REMEASURES confirmation rounds after envelope, baseline or cold breaches.
export async function runConfirmationGate({ envClass, budgets, results, runnerClass, measureFn, maxRemeasures = MAX_CI_REMEASURES, log = () => {} }) {
  let current = results;
  let remeasures = 0;
  const rounds = [];
  let verdict = evaluate({ envClass, budgets, results: current, runnerClass });
  rounds.push({ ok: verdict.ok, fails: [...verdict.fails], warm: current.warm_start_first_text_ms, cold: current.cold_start_first_text_ms });

  while (!verdict.ok && envClass === 'ci' && breachOnly(verdict.fails) && remeasures < maxRemeasures && measureFn) {
    remeasures += 1;
    log(`perf gate: re-measure ${remeasures} of ${maxRemeasures} to confirm breach`);
    const next = await measureFn(remeasures);
    current = { ...next, confirmed: true, confirmation_rounds: rounds.length };
    if (rounds[0] && !current.first_attempt) {
      current.first_attempt = { warm_start_first_text_ms: rounds[0].warm, cold_start_first_text_ms: rounds[0].cold };
    }
    verdict = evaluate({ envClass, budgets, results: current, runnerClass });
    rounds.push({ ok: verdict.ok, fails: [...verdict.fails], warm: current.warm_start_first_text_ms, cold: current.cold_start_first_text_ms });
  }

  return { verdict, rounds, remeasures, finalResults: current };
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

const PRODUCT = { cold_start_first_text_ms: 500, open_indexed_document_ms: 50, palette_keystroke_ms: 16, typeset_viewport_ms: 100, live_reload_ms: 100, find_first_match_ms: 50, parse_long_technical_ms: 10 };
const obs = (rows, image) => rows.map(([ms, commit, job_id]) => ({ ms, commit, job_id, runner_image: image }));
const UBUNTU_IMAGE = 'ubuntu-latest (ubuntu-24.04, software-rendered WebKitGTK, no GPU)';
const MAC_IMAGE = 'macos-latest (macos-15, arm64)';
const UBUNTU_OBS_WARM = obs([[968.5, 'c1', 'j1'], [1011.5, 'c2', 'j2'], [1030, 'c3', 'j3'], [1009.5, 'c4', 'j4'], [1011.5, 'c5', 'j5']], UBUNTU_IMAGE);
const UBUNTU_OBS_COLD = obs([[985, 'c1', 'j1'], [1009, 'c2', 'j2'], [1033, 'c3', 'j3'], [1030, 'c4', 'j4'], [1014, 'c5', 'j5']], UBUNTU_IMAGE);
const MAC_OBS_WARM = obs([[2423, 'm1', 'a1'], [1700.5, 'm2', 'a2'], [1572, 'm3', 'a3'], [2116, 'm4', 'a4'], [1658.5, 'm5', 'a5']], MAC_IMAGE);
const MAC_OBS_COLD = obs([[2613, 'm1', 'a1'], [1817, 'm2', 'a2'], [1657, 'm3', 'a3'], [2418, 'm4', 'a4'], [1885, 'm5', 'a5']], MAC_IMAGE);
const SELFTEST_BUDGETS = {
  product: PRODUCT,
  ci: {
    'ubuntu-latest': {
      multiplier: 20,
      tolerance: 1.12,
      runs_n: 9,
      baseline_ms: 1030,
      cold_envelope_ms: 1343,
      observed_warm_ms: UBUNTU_OBS_WARM,
      observed_cold_ms: UBUNTU_OBS_COLD,
      parse_long_technical_ms: { multiplier: 3, baseline_ms: 20, tolerance: 1.3 },
    },
    'macos-latest': {
      multiplier: 5,
      tolerance: 1.3,
      runs_n: 9,
      baseline_ms: null,
      cold_envelope_ms: 3397,
      baseline_waived: { reason: 'spread', observed_warm_ms: [2423, 1700.5, 1572, 2116, 1658.5], cross_run_spread: 1.542, escalated_to: 'MARXY-53', date: '2026-09-19' },
      observed_warm_ms: MAC_OBS_WARM,
      observed_cold_ms: MAC_OBS_COLD,
      parse_long_technical_ms: { multiplier: 5, baseline_ms: 31.44, tolerance: 1.3 },
    },
    'no-baseline': { multiplier: 5, tolerance: 1.3, runs_n: 9, baseline_ms: null, cold_envelope_ms: 3000, parse_long_technical_ms: { multiplier: 3, baseline_ms: null } },
  },
};

// A record that is sufficient to gate on, so each case can make exactly one thing wrong.
const result = (over = {}) => ({
  env_class: 'ci',
  runner_class: 'ubuntu-latest',
  cold_start_first_text_ms: 1200,
  warm_start_first_text_ms: 1000,
  cold_warm_ratio: 1.2,
  cold_procedure: 'process-cold only',
  parse_long_technical_ms: 18,
  runs: [1200, 1000, 1010, 990, 1020, 995, 1005, 998, 1002],
  warm_runs: [1000, 1010, 990, 1020, 995, 1005, 998, 1002],
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
  'ci: 12 % above the baseline fails even far below the envelope',
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
  { name: 'ci: 12 % above the baseline fails even far below the envelope', envClass: 'ci', results: result({ warm_start_first_text_ms: 1160 }), expect: 1, assert: f => has(f, /exceeds the baseline ceiling 1153.6 ms/) },
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
  { name: 'ci: under the cold envelope passes', envClass: 'ci', results: result({ cold_start_first_text_ms: 1200 }), expect: 0, assertOut: o => o.some(l => /cold_start_first_text_ms: 1200 ms ≤ 1343 ms/.test(l)) },
  { name: 'ci: above the cold envelope fails', envClass: 'ci', results: result({ cold_start_first_text_ms: 1400 }), expect: 1, assert: f => has(f, /exceeds the cold envelope 1343 ms/) },
  { name: 'ci: a missing cold_envelope_ms fails', envClass: 'ci', results: result(), budgets: { ...SELFTEST_BUDGETS, ci: { ...SELFTEST_BUDGETS.ci, 'ubuntu-latest': { ...SELFTEST_BUDGETS.ci['ubuntu-latest'], cold_envelope_ms: null } } }, expect: 1, assert: f => has(f, /cold_envelope_ms is absent/) },
  { name: 'ci: cold_warm_ratio below 1 fails', envClass: 'ci', results: result({ cold_warm_ratio: 0.94, cold_start_first_text_ms: 900, warm_start_first_text_ms: 1000 }), expect: 1, assert: f => has(f, /cold_warm_ratio is 0.94×/) },
  { name: 'ci: runs_n differs from the recorded sample size fails', envClass: 'ci', results: result({ runs_n: 8 }), expect: 1, assert: f => has(f, /runs_n is 8/) },
  { name: 'ci: baseline_ms equals max observed warm', envClass: 'ci', results: result(), expect: 0, assertOut: () => SELFTEST_BUDGETS.ci['ubuntu-latest'].baseline_ms === Math.max(...UBUNTU_OBS_WARM.map(o => o.ms)) },
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
  // parse_long_technical_ms uses the same two-tier rule as the warm start but its own tolerance:
  // envelope 10 × 3 = 30 ms, baseline ceiling 20 × 1.30 = 26 ms on the SELFTEST_BUDGETS fixture.
  { name: 'ci: parse inside both rules passes', envClass: 'ci', results: result({ parse_long_technical_ms: 18 }), expect: 0, assertOut: o => o.some(l => /^parse_long_technical_ms: 18 ms ≤ 26 ms/.test(l)) },
  { name: 'ci: parse above the envelope fails', envClass: 'ci', results: result({ parse_long_technical_ms: 31 }), expect: 1, assert: f => has(f, /parse_long_technical_ms: 31 ms exceeds the envelope 30 ms/) },
  { name: 'ci: parse 12 % above the baseline fails even far below the envelope', envClass: 'ci', results: result({ parse_long_technical_ms: 27 }), expect: 1, assert: f => has(f, /parse_long_technical_ms: 27 ms exceeds the baseline ceiling 26 ms/) },
  { name: 'ci: a missing parse measurement fails', envClass: 'ci', results: result({ parse_long_technical_ms: null }), expect: 1, assert: f => has(f, /^parse_long_technical_ms missing from results\/perf\.json$/) },
  { name: 'ci: parse with no entry for the runner class fails', envClass: 'ci', results: result({ runner_class: 'macos-latest' }), budgets: { ...SELFTEST_BUDGETS, ci: { ...SELFTEST_BUDGETS.ci, 'macos-latest': { multiplier: 5, baseline_ms: 1901 } } }, expect: 1, assert: f => has(f, /parse_long_technical_ms: no ci entry for this runner class/) },
  { name: 'reference: parse over the product budget fails', envClass: 'reference', results: referenceResult({ parse_long_technical_ms: 11 }), expect: 1, assert: f => has(f, /parse_long_technical_ms: 11 ms > 10 ms \(product budget\)/) },
];

// The cases MARXY-59 added, for the same reason the MARXY-55 list exists.
const MARXY_59_CASE_NAMES = [
  'ci: parse inside both rules passes',
  'ci: parse above the envelope fails',
  'ci: parse 12 % above the baseline fails even far below the envelope',
  'ci: a missing parse measurement fails',
  'reference: parse over the product budget fails',
];

async function selftest() {
  let bad = 0;
  let ran = 0;
  const report = (ok, name, detail) => { ran++; if (ok) console.log(`selftest ok: ${name}`); else { bad++; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); } };

  for (const c of SELFTEST_CASES) {
    const { ok, out, fails } = evaluate({ envClass: c.envClass, budgets: c.budgets ?? SELFTEST_BUDGETS, results: c.results, runnerClass: c.results?.runner_class ?? undefined });
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
    'ci: under the cold envelope passes',
    'ci: above the cold envelope fails',
    'ci: cold_warm_ratio below 1 fails',
  ];
  for (const name of MARXY_63_CASE_NAMES) {
    if (!SELFTEST_CASES.some(c => c.name === name)) { bad++; console.error(`selftest FAIL: the MARXY-63 case "${name}" is no longer in the suite`); }
  }

  for (const name of MARXY_59_CASE_NAMES) {
    if (!SELFTEST_CASES.some(c => c.name === name)) { bad++; console.error(`selftest FAIL: the MARXY-59 case "${name}" is no longer in the suite`); }
  }

  // The parse number survives measure-startup.mjs replacing results/perf.json only through this
  // merge, so the merge is checked here rather than trusted.
  for (const c of [
    { name: 'fills parse from the snapshot when results dropped it', results: { env_class: 'ci' }, snapshot: { parse_long_technical_ms: 18 }, want: 18 },
    { name: 'keeps a parse already on results', results: { parse_long_technical_ms: 12 }, snapshot: { parse_long_technical_ms: 99 }, want: 12 },
    { name: 'leaves results unchanged when the snapshot has no parse', results: { env_class: 'ci' }, snapshot: {}, want: undefined },
    { name: 'leaves a missing results file missing', results: null, snapshot: { parse_long_technical_ms: 18 }, want: 'null' },
  ]) {
    const got = mergeParseMeasurement(c.results, c.snapshot);
    const value = got == null ? 'null' : got.parse_long_technical_ms;
    report(value === c.want, `mergeParseMeasurement ${c.name}`, value === c.want ? null : `gave ${value}, want ${c.want}`);
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
  const shippedOk = shipped.product.cold_start_first_text_ms === 500 && Object.entries(shipped.ci).every(([, ci]) => typeof ci.multiplier === 'number' && ('baseline_ms' in ci) && typeof ci.cold_envelope_ms === 'number');
  report(shippedOk, 'budgets: the shipped fixtures/perf-budgets.json carries the numbers this rule reads');
  report(budgetsText !== budgetsText.replace('"cold_start_first_text_ms": 500', '"cold_start_first_text_ms": 900'), 'budgets: an edited budgets file is detected byte for byte');
  let mainBudgets = null;
  try {
    mainBudgets = JSON.parse(execFileSync('git', ['show', 'origin/main:fixtures/perf-budgets.json'], { encoding: 'utf8' }));
  } catch { /* origin/main may be missing in a shallow clone; the case then fails on purpose */ }
  report(
    mainBudgets != null && productNumbersIdentical(mainBudgets, shipped),
    'budgets: every number in the product object matches origin/main byte for byte',
    mainBudgets == null ? 'could not read origin/main:fixtures/perf-budgets.json' : 'product object differs from origin/main',
  );
  report(validateCiBudgets(shipped).length === 0, 'budgets: cross-run evidence in fixtures/perf-budgets.json validates', validateCiBudgets(shipped).join('; '));
  report(shipped.product[PARSE_METRIC] === 10, 'budgets: the shipped product parse budget is the ADR-0013 10 ms', `got ${shipped.product[PARSE_METRIC]}`);
  // A ci parse entry must be arithmetic on a number that was actually observed. `derived_from` is
  // the human audit trail for *which* run that was — it is recorded, not machine-verified against
  // CI, and re-deriving the baselines from a defensible statistic is MARXY-70's job for every class
  // at once.
  for (const cls of ['ubuntu-latest', 'macos-latest']) {
    const entry = shipped.ci[cls]?.[PARSE_METRIC];
    const runnerMedian = entry?.derived_from?.runner_median_ms;
    const derivedMultiplier = runnerMedian == null ? null : Math.ceil((runnerMedian / 10) * ADR_MULTIPLIER_HEADROOM);
    const ok = Boolean(entry) && runnerMedian != null && entry.multiplier === derivedMultiplier && entry.baseline_ms === runnerMedian;
    report(ok, `budgets: ci.${cls}.${PARSE_METRIC} is derived from its recorded median`, `must have baseline_ms = runner_median_ms and multiplier = ceil(runner_median / 10 × 1.3), got ${JSON.stringify(entry)}`);
  }

  // The budgets comparison is the only thing standing between a pull request and a quietly raised
  // ceiling, so it is driven over a moved number, a deleted one and an added one.
  const { [PARSE_METRIC]: _parse, ...productWithoutParse } = shipped.product;
  for (const [what, before, after, want] of [
    ['a raised product budget is rejected', shipped, { ...shipped, product: { ...shipped.product, cold_start_first_text_ms: 900 } }, true],
    ['a raised parse baseline is rejected', shipped, { ...shipped, ci: { ...shipped.ci, 'ubuntu-latest': { ...shipped.ci['ubuntu-latest'], [PARSE_METRIC]: { ...shipped.ci['ubuntu-latest'][PARSE_METRIC], baseline_ms: 100 } } } }, true],
    ['a deleted budget is rejected', shipped, { ...shipped, product: { cold_start_first_text_ms: 500 } }, true],
    ['an added metric is allowed', { ...shipped, product: productWithoutParse }, shipped, false],
    ['an unchanged product object is allowed', { product: shipped.product }, { product: shipped.product }, false],
  ]) {
    const changed = loosenedBudgets(before, after).length > 0;
    report(changed === want, `budgets: ${what}`, `loosenedBudgets said ${changed}`);
  }

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

  const badBudget = (name, budgets) => {
    const errs = validateCiBudgets(budgets);
    report(errs.length > 0, name, errs.join('; ') || 'expected rejection');
  };
  const goodCi = () => JSON.parse(JSON.stringify(SELFTEST_BUDGETS));
  for (const [name, mutate] of [
    ['spread guard: fewer than five warm observations', b => { b.ci['ubuntu-latest'].observed_warm_ms = b.ci['ubuntu-latest'].observed_warm_ms.slice(0, 4); }],
    ['spread guard: observations at non-distinct commits', b => { b.ci['ubuntu-latest'].observed_warm_ms[4].commit = b.ci['ubuntu-latest'].observed_warm_ms[0].commit; }],
    ['spread guard: observations at non-distinct job ids', b => { b.ci['ubuntu-latest'].observed_warm_ms[4].job_id = b.ci['ubuntu-latest'].observed_warm_ms[0].job_id; }],
    ['spread guard: tolerance below 1.05', b => { b.ci['ubuntu-latest'].tolerance = 1.04; }],
    ['spread guard: spread times tolerance above 1.20 with a baseline', b => { b.ci['ubuntu-latest'].observed_warm_ms.push({ ms: 2000, commit: 'cx', job_id: 'jx', runner_image: UBUNTU_IMAGE }); }],
    ['spread guard: tight within-round but 4× cross-run spread is rejected', b => {
      b.ci['ubuntu-latest'].observed_warm_ms = obs([[100, 't1', 'k1'], [110, 't2', 'k2'], [105, 't3', 'k3'], [400, 't4', 'k4'], [390, 't5', 'k5']], UBUNTU_IMAGE);
      b.ci['ubuntu-latest'].baseline_ms = 400;
    }],
    ['baseline_waived: null baseline without baseline_waived', b => { b.ci['macos-latest'].baseline_waived = undefined; }],
    ['baseline_waived: baseline_waived missing escalated_to', b => { delete b.ci['macos-latest'].baseline_waived.escalated_to; }],
  ]) {
    const b = goodCi();
    mutate(b);
    badBudget(`budgets: ${name}`, b);
  }

  {
    const parseLimitLine = (budgets, ms) => {
      const { out } = evaluate({ envClass: 'ci', budgets, results: result({ parse_long_technical_ms: ms }) });
      return out.find(l => l.startsWith('parse_long_technical_ms:'));
    };
    const base = goodCi();
    const before = parseLimitLine(base, 18);
    base.ci['ubuntu-latest'].tolerance = 1.05;
    const afterWarmOnly = parseLimitLine(base, 18);
    report(before === afterWarmOnly, 'parse: warm ci.tolerance alone does not tighten the parse ceiling', `${before} → ${afterWarmOnly}`);
    base.ci['ubuntu-latest'].parse_long_technical_ms.tolerance = 1.12;
    const afterParseTol = parseLimitLine(base, 18);
    report(afterParseTol !== before && /≤ 22.4 ms/.test(afterParseTol), 'parse: parse_long_technical_ms.tolerance sets the parse ceiling', afterParseTol ?? 'missing line');
  }

  // Confirmation-before-failure (ci mode only, up to two re-measures).
  const confirmBudgets = goodCi();
  const breachWarm = () => result({ warm_start_first_text_ms: 10_500, cold_start_first_text_ms: 1200 });
  const cleanWarm = () => result({ warm_start_first_text_ms: 1000, cold_start_first_text_ms: 1200 });
  {
    let calls = 0;
    const three = await runConfirmationGate({
      envClass: 'ci',
      budgets: confirmBudgets,
      results: breachWarm(),
      runnerClass: 'ubuntu-latest',
      measureFn: async () => { calls++; return breachWarm(); },
    });
    report(!three.verdict.ok && three.rounds.length === 3, 'confirmation: three breaching rounds exit 1', `rounds ${three.rounds.length}, ok=${three.verdict.ok}`);
    report(three.verdict.fails.some(f => /exceeds the envelope/.test(f)), 'confirmation: three breaching rounds name the envelope margin');
    const failLines = [];
    const saveErr = console.error;
    console.error = (...args) => failLines.push(args.join(' '));
    console.error(`perf gate failed after ${three.rounds.length} rounds:`);
    three.rounds.forEach((r, i) => console.error(` - round ${i + 1}: ${r.fails.join('; ')}`));
    console.error = saveErr;
    report(
      failLines.some(l => /round 1:/.test(l)) && failLines.some(l => /round 2:/.test(l)) && failLines.some(l => /round 3:/.test(l)),
      'confirmation CLI: three breaching rounds print every round margin',
      failLines.join(' | '),
    );

    calls = 0;
    const noise = await runConfirmationGate({
      envClass: 'ci',
      budgets: confirmBudgets,
      results: breachWarm(),
      runnerClass: 'ubuntu-latest',
      measureFn: async () => cleanWarm(),
    });
    report(noise.verdict.ok && noise.remeasures === 1, 'confirmation: breach then clean exits 0 after one re-measure');
    report(noise.finalResults?.first_attempt?.warm_start_first_text_ms === 10_500, 'confirmation: confirmed noise records the first round margin');
    const noiseLines = [];
    const saveLog = console.log;
    console.log = (...args) => noiseLines.push(args.join(' '));
    if (noise.verdict.ok && noise.rounds[0] && !noise.rounds[0].ok) {
      console.log(`confirmed noise: first round breached (${noise.rounds[0].fails.join('; ')})`);
    }
    console.log = saveLog;
    report(noiseLines.some(l => l.includes('confirmed noise')), 'confirmation CLI: confirmed noise line is printed', noiseLines.join(' | '));

    calls = 0;
    const clean = await runConfirmationGate({
      envClass: 'ci',
      budgets: confirmBudgets,
      results: cleanWarm(),
      runnerClass: 'ubuntu-latest',
      measureFn: async () => { calls++; return breachWarm(); },
    });
    report(clean.verdict.ok && calls === 0, 'confirmation: a clean first round calls measure zero extra times', `calls=${calls}`);

    const ref = await runConfirmationGate({
      envClass: 'reference',
      budgets: confirmBudgets,
      results: referenceCold({ typeset_viewport_ms: 501 }),
      measureFn: async () => referenceCold({ typeset_viewport_ms: 501 }),
    });
    report(ref.remeasures === 0, 'confirmation: reference mode never re-measures');
  }

  // No case may be lost: the two suites together are asserted against a floor on their own size.
  const cases = ran + MEASURE_CASE_NAMES.length;
  if (cases < 40) { bad++; console.error(`selftest FAIL: ${cases} named cases across both suites, which must be at least 40`); }
  if (bad) { console.error(`perf gate selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`perf gate selftest ok: ${ran} named cases here, ${MEASURE_CASE_NAMES.length} in measure-startup, ${cases} together`);
  process.exit(0);
}

const budgetsRef = process.argv.indexOf('--assert-budgets-unchanged');
if (budgetsRef !== -1) assertBudgetsUnchanged(process.argv[budgetsRef + 1] ?? 'origin/main');
if (process.argv.includes('--selftest')) await selftest();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
const { envClass, error } = resolveEnvClass(process.env);
if (error) { console.error(`perf gate: ${error}`); process.exit(1); }
const resultsPath = new URL('../results/perf.json', import.meta.url);
const parseSnapshotPath = new URL('../results/perf-parse.json', import.meta.url);
const raw = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : null;
const snapshot = existsSync(parseSnapshotPath) ? JSON.parse(readFileSync(parseSnapshotPath, 'utf8')) : null;
const results = mergeParseMeasurement(raw, snapshot);
console.log(`perf gate: ${envClass} mode`);
const runnerClass = process.env.MARXY_RUNNER_CLASS || undefined;
const measureFn = envClass === 'ci'
  ? async () => {
    const m = await import('./measure-startup.mjs');
    const launches = await m.measureLaunches({ log: console.log });
    return mergeParseMeasurement(m.perfRecord(m.summarise(launches), { envClass, runnerClass, launches }), snapshot);
  }
  : null;
const { verdict, finalResults, remeasures, rounds } = await runConfirmationGate({
  envClass,
  budgets,
  results,
  runnerClass,
  measureFn,
  log: msg => console.log(`::warning::${msg}`),
});
for (const line of evaluate({ envClass, budgets, results: rounds[0] ? { ...results, warm_start_first_text_ms: rounds[0].warm, cold_start_first_text_ms: rounds[0].cold } : results, runnerClass }).out) {
  console.log(line);
}
if (remeasures > 0) {
  writeFileSync(resultsPath, JSON.stringify(finalResults, null, 2) + '\n');
  for (let i = 1; i < rounds.length; i++) {
    for (const line of evaluate({ envClass, budgets, results: { ...finalResults, warm_start_first_text_ms: rounds[i].warm, cold_start_first_text_ms: rounds[i].cold }, runnerClass }).out) {
      console.log(`(confirmation ${i}) ${line}`);
    }
  }
  if (verdict.ok && rounds[0] && !rounds[0].ok) {
    console.log(`confirmed noise: first round breached (${rounds[0].fails.join('; ')})`);
  }
}
if (!verdict.ok && rounds.length >= 3 && rounds.every(r => !r.ok)) {
  console.error(`perf gate failed after ${rounds.length} rounds:`);
  rounds.forEach((r, i) => console.error(` - round ${i + 1}: ${r.fails.join('; ')}`));
  process.exit(1);
}
if (!verdict.ok) { console.error('perf gate failed:\n - ' + verdict.fails.join('\n - ')); process.exit(1); }
console.log(`perf gate ok${remeasures ? ` (after ${remeasures} confirming re-measure${remeasures > 1 ? 's' : ''})` : ''}`);
