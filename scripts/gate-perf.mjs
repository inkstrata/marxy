// Performance budgets as hard failures (ADR-0013), in two tiers (ADR-0022): product budgets on
// reference hardware (MARXY_PERF_ENV=reference), an envelope plus a per-runner baseline in CI
// (MARXY_PERF_ENV=ci). Reads fixtures/perf-budgets.json and results/perf.json (startup from
// scripts/measure-startup.mjs; parse from packages/core/src/parse/parse.test.ts). `--selftest`
// runs the rules over inline fixtures and touches no files.
import { readFileSync, existsSync } from 'node:fs';

const METRICS = ['cold_start_first_text_ms', 'open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms'];
const PARSE_METRIC = 'parse_long_technical_ms';
const BASELINE_TOLERANCE = 1.1; // ADR-0022: a runner may drift 10 % before it is a regression.
const ADR_MULTIPLIER_HEADROOM = 1.3; // ADR-0022: ceil(runner_median / product × 1.3).
const round = n => Math.round(n * 10) / 10;

// Which tier to enforce. CI must say so explicitly, so a misconfigured workflow fails loudly
// instead of silently measuring rented hardware against a product budget.
export function resolveEnvClass(env) {
  const raw = env.MARXY_PERF_ENV;
  if (raw && raw !== 'reference' && raw !== 'ci') return { error: `MARXY_PERF_ENV must be "reference" or "ci", got "${raw}"` };
  if (env.CI && raw !== 'ci') return { error: `CI is set, so MARXY_PERF_ENV must be "ci" (got ${raw ? `"${raw}"` : 'unset'})` };
  return { envClass: raw ?? 'reference' };
}

// measure-startup.mjs replaces results/perf.json; the parse test also writes a snapshot so the
// number still reaches the gate. Pure so --selftest can drive it without touching the disk.
export function mergeParseMeasurement(results, snapshot) {
  if (!results) return results;
  if (results[PARSE_METRIC] != null) return results;
  if (snapshot?.[PARSE_METRIC] == null) return results;
  return { ...results, [PARSE_METRIC]: snapshot[PARSE_METRIC] };
}

// Shared two-tier rule (ADR-0022): fail over the envelope or over baseline × 1.10.
function enforceTwoTier(out, fails, key, value, product, ciMetric, { required }) {
  if (value == null) {
    if (required) fails.push(`${key} missing from results/perf.json`);
    return;
  }
  if (!ciMetric || ciMetric.multiplier == null) {
    fails.push(`${key}: no ci entry for this runner class; add it to fixtures/perf-budgets.json`);
    return;
  }
  const envelope = product * ciMetric.multiplier;
  const baselineCeiling = ciMetric.baseline_ms == null ? Infinity : ciMetric.baseline_ms * BASELINE_TOLERANCE;
  const limit = Math.min(envelope, baselineCeiling);
  if (value > envelope) fails.push(`${key}: ${value} ms exceeds the envelope ${envelope} ms (product ${product} ms × ${ciMetric.multiplier}) by ${round(value - envelope)} ms`);
  if (value > baselineCeiling) fails.push(`${key}: ${value} ms exceeds the baseline ceiling ${round(baselineCeiling)} ms (baseline ${ciMetric.baseline_ms} ms + 10 %) by ${round(value - baselineCeiling)} ms`);
  if (value <= limit) out.push(`${key}: ${value} ms ≤ ${round(limit)} ms (min of envelope ${envelope} ms and baseline ceiling ${round(baselineCeiling)} ms)`);
}

// Pure so --selftest can drive it: results === null means results/perf.json was absent.
export function evaluate({ envClass, budgets, results, runnerClass }) {
  const out = [];
  const fails = [];
  if (!results) return { ok: false, out, fails: ['results/perf.json missing; run scripts/measure-startup.mjs first'] };
  if (results.env_class !== envClass) fails.push(`results/perf.json env_class is ${results.env_class ?? 'absent'}, expected ${envClass}`);

  if (envClass === 'reference') {
    for (const k of [...METRICS, PARSE_METRIC]) {
      const v = results[k];
      if (v == null) continue;
      if (v > budgets.product[k]) fails.push(`${k}: ${v} ms > ${budgets.product[k]} ms (product budget)`);
      else out.push(`${k}: ${v} ms ≤ ${budgets.product[k]} ms (product budget)`);
    }
    return { ok: fails.length === 0, out, fails };
  }

  const cls = runnerClass ?? results.runner_class;
  const ci = cls ? budgets.ci[cls] : undefined;
  if (!ci) {
    fails.push(`unknown runner class ${cls ? `"${cls}"` : '(unset)'}; add it to fixtures/perf-budgets.json under "ci"`);
    return { ok: false, out, fails };
  }
  out.push(`runner class ${cls}: envelope ×${ci.multiplier}, baseline ${ci.baseline_ms ?? 'none'} ms`);

  enforceTwoTier(out, fails, 'cold_start_first_text_ms', results.cold_start_first_text_ms, budgets.product.cold_start_first_text_ms, ci, { required: true });
  enforceTwoTier(out, fails, PARSE_METRIC, results[PARSE_METRIC], budgets.product[PARSE_METRIC], ci[PARSE_METRIC], { required: false });

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

const SELFTEST_BUDGETS = {
  product: { cold_start_first_text_ms: 500, open_indexed_document_ms: 50, palette_keystroke_ms: 16, typeset_viewport_ms: 100, live_reload_ms: 100, find_first_match_ms: 50, parse_long_technical_ms: 10 },
  ci: {
    'ubuntu-latest': { multiplier: 20, baseline_ms: 7719, parse_long_technical_ms: { multiplier: 3, baseline_ms: 20 } },
    'macos-latest': { multiplier: 5, baseline_ms: 1901, parse_long_technical_ms: { multiplier: 5, baseline_ms: 31.44 } },
    'no-baseline': { multiplier: 5, baseline_ms: null },
  },
};

const SELFTEST_CASES = [
  { name: 'ci: inside both rules passes', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 7000 }, expect: 0 },
  { name: 'ci: above the envelope fails', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 10_500 }, expect: 1 },
  { name: 'ci: 11 % above the baseline fails even far below the envelope', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 8568 }, expect: 1 },
  { name: 'reference: 501 ms fails the product budget', envClass: 'reference', results: { env_class: 'reference', cold_start_first_text_ms: 501 }, expect: 1 },
  { name: 'reference: missing results fails', envClass: 'reference', results: null, expect: 1 },
  { name: 'reference: results measured in ci mode fails', envClass: 'reference', results: { env_class: 'ci', cold_start_first_text_ms: 400 }, expect: 1 },
  { name: 'ci: unknown runner class fails', envClass: 'ci', results: { env_class: 'ci', runner_class: 'windows-latest', cold_start_first_text_ms: 400 }, expect: 1 },
  { name: 'ci: a null baseline still enforces the envelope', envClass: 'ci', results: { env_class: 'ci', runner_class: 'no-baseline', cold_start_first_text_ms: 2600 }, expect: 1 },
  { name: 'ci: a null baseline passes under the envelope', envClass: 'ci', results: { env_class: 'ci', runner_class: 'no-baseline', cold_start_first_text_ms: 2400 }, expect: 0 },
  // parse_long_technical_ms uses the same two-tier rule as cold start (envelope 10×3=30, baseline ceiling 22).
  { name: 'ci: parse inside both rules passes', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 7000, parse_long_technical_ms: 18 }, expect: 0 },
  { name: 'ci: parse above the envelope fails', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 7000, parse_long_technical_ms: 31 }, expect: 1 },
  { name: 'ci: parse 11 % above the baseline fails even far below the envelope', envClass: 'ci', results: { env_class: 'ci', runner_class: 'ubuntu-latest', cold_start_first_text_ms: 7000, parse_long_technical_ms: 23 }, expect: 1 },
];

function selftest() {
  let bad = 0;
  for (const c of SELFTEST_CASES) {
    const { ok } = evaluate({ envClass: c.envClass, budgets: SELFTEST_BUDGETS, results: c.results, runnerClass: c.results?.runner_class });
    const code = ok ? 0 : 1;
    if (code !== c.expect) { bad++; console.error(`selftest FAIL (exit ${code}, want ${c.expect}): ${c.name}`); }
    else console.log(`selftest ok (exit ${code}): ${c.name}`);
  }
  // The env-class resolution rules are part of the contract, so they are checked too.
  const envCases = [
    { env: {}, want: 'reference' },
    { env: { MARXY_PERF_ENV: 'ci' }, want: 'ci' },
    { env: { CI: 'true' }, want: 'error' },
    { env: { CI: 'true', MARXY_PERF_ENV: 'reference' }, want: 'error' },
    { env: { CI: 'true', MARXY_PERF_ENV: 'ci' }, want: 'ci' },
    { env: { MARXY_PERF_ENV: 'laptop' }, want: 'error' },
  ];
  for (const c of envCases) {
    const r = resolveEnvClass(c.env);
    const got = r.error ? 'error' : r.envClass;
    if (got !== c.want) { bad++; console.error(`selftest FAIL: resolveEnvClass(${JSON.stringify(c.env)}) gave ${got}, want ${c.want}`); }
    else console.log(`selftest ok: resolveEnvClass(${JSON.stringify(c.env)}) → ${got}`);
  }
  const mergeCases = [
    { name: 'fills parse from the snapshot when results dropped it', results: { env_class: 'ci' }, snapshot: { parse_long_technical_ms: 18 }, want: 18 },
    { name: 'keeps a parse already on results', results: { parse_long_technical_ms: 12 }, snapshot: { parse_long_technical_ms: 99 }, want: 12 },
    { name: 'leaves results unchanged when the snapshot has no parse', results: { env_class: 'ci' }, snapshot: {}, want: undefined },
    { name: 'leaves a missing results file missing', results: null, snapshot: { parse_long_technical_ms: 18 }, want: 'null' },
  ];
  for (const c of mergeCases) {
    const got = mergeParseMeasurement(c.results, c.snapshot);
    const value = got == null ? 'null' : got.parse_long_technical_ms;
    if (value !== c.want) { bad++; console.error(`selftest FAIL: mergeParseMeasurement ${c.name} gave ${value}, want ${c.want}`); }
    else console.log(`selftest ok: mergeParseMeasurement ${c.name}`);
  }
  // The committed file must carry the parse product budget and an ADR-0022-derived ci entry
  // per runner class. A multiplier that is not ceil(runner_median / 10 × 1.3) is invented.
  const real = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
  if (real.product.parse_long_technical_ms !== 10) {
    bad++;
    console.error(`selftest FAIL: product.parse_long_technical_ms is ${real.product.parse_long_technical_ms}, want 10`);
  } else {
    console.log('selftest ok: product.parse_long_technical_ms is 10');
  }
  for (const cls of ['ubuntu-latest', 'macos-latest']) {
    const entry = real.ci[cls]?.parse_long_technical_ms;
    const median = entry?.derived_from?.runner_median_ms;
    const derived = median == null ? null : Math.ceil((median / 10) * ADR_MULTIPLIER_HEADROOM);
    if (!entry || entry.multiplier !== derived || entry.baseline_ms !== median || median == null) {
      bad++;
      console.error(`selftest FAIL: ci.${cls}.parse_long_technical_ms must have baseline_ms = runner_median_ms and multiplier = ceil(runner_median / 10 × 1.3) (got ${JSON.stringify(entry)})`);
    } else {
      console.log(`selftest ok: ci.${cls}.parse_long_technical_ms multiplier ${entry.multiplier} from median ${median}`);
    }
  }
  const extra = mergeCases.length + 1 + 2;
  if (bad) { console.error(`perf gate selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`perf gate selftest ok: ${SELFTEST_CASES.length + envCases.length + extra} cases`);
  process.exit(0);
}

if (process.argv.includes('--selftest')) selftest();

const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
const { envClass, error } = resolveEnvClass(process.env);
if (error) { console.error(`perf gate: ${error}`); process.exit(1); }
const resultsPath = new URL('../results/perf.json', import.meta.url);
const parseSnapshotPath = new URL('../results/perf-parse.json', import.meta.url);
const raw = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : null;
const snapshot = existsSync(parseSnapshotPath) ? JSON.parse(readFileSync(parseSnapshotPath, 'utf8')) : null;
const results = mergeParseMeasurement(raw, snapshot);
console.log(`perf gate: ${envClass} mode`);
const { ok, out, fails } = evaluate({ envClass, budgets, results, runnerClass: process.env.MARXY_RUNNER_CLASS || undefined });
for (const line of out) console.log(line);
if (!ok) { console.error('perf gate failed:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('perf gate ok');
