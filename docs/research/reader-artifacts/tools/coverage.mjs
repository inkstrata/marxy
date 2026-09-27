// How much of the Reader Artifacts Handbook the board has used, from coverage.json and the live
// board. Run from the repository root:
//
//   node docs/research/reader-artifacts/tools/coverage.mjs            # summary and open units
//   node docs/research/reader-artifacts/tools/coverage.mjs --all      # every unit
//   node docs/research/reader-artifacts/tools/coverage.mjs --key MARXY-n
//
// Status comes from the fleet's event log (orchestration/machine.mjs `board`, read-only), never from
// a number written into a document (AGENTS.md). A unit is **landed** when every key it names is done,
// **filed** when it has keys and some are not done yet, and otherwise carries its disposition
// (applied, deferred to a v1.1 bundle, or declined). `tools/check.mjs` is what keeps the ledger
// complete; this only reports it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..', '..');
const coverage = JSON.parse(readFileSync(join(root, 'coverage.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;

let statusOf = () => 'unknown';
try {
  const { board } = await import(join(repo, 'orchestration/machine.mjs'));
  const b = board({ write: false });
  statusOf = (k) => b.stories?.[k]?.status ?? 'todo';
} catch (e) {
  console.error(`board unavailable (${e.message.split('\n')[0]}); statuses show as unknown`);
}

const state = (u) => {
  if (!u.keys?.length) return u.disposition;
  const s = u.keys.map(statusOf);
  if (s.every((x) => x === 'done')) return 'landed';
  return u.disposition === 'partial' ? 'partial, filed' : 'filed';
};

const units = coverage.units.filter((u) => !only || u.keys?.includes(only));
const rows = units.map((u) => ({ ...u, state: state(u) }));
const count = (pred) => rows.filter(pred).length;
const total = rows.length;
const pct = (n) => `${Math.round((100 * n) / (total || 1))} %`;

const settled = count((r) => ['landed', 'applied', 'declined'].includes(r.state));
const filed = count((r) => r.state.includes('filed') || r.state === 'landed');
console.log(`Reader Artifacts Handbook coverage${only ? ` for ${only}` : ''}: ${total} units`);
console.log(`  every unit has a disposition (tools/check.mjs fails otherwise), so a new spec row, operation or draft is unplanned until it is added to coverage.json`);
console.log(`  on the board: ${filed} (${pct(filed)}) · landed: ${count((r) => r.state === 'landed')} · applied before the handbook: ${count((r) => r.state === 'applied')}`);
console.log(`  deferred to v1.1: ${count((r) => r.disposition === 'deferred')} · declined: ${count((r) => r.state === 'declined')} · settled (landed, applied or declined): ${settled} (${pct(settled)})`);

const byKind = {};
for (const r of rows) (byKind[r.kind] ??= []).push(r);
console.log('\n| Kind | Units | Landed | Filed | Applied | Deferred | Declined |\n| --- | --- | --- | --- | --- | --- | --- |');
for (const [k, list] of Object.entries(byKind)) {
  const c = (s) => list.filter((r) => (s === 'filed' ? r.state.includes('filed') : s === 'deferred' ? r.disposition === 'deferred' : r.state === s)).length;
  console.log(`| ${k} | ${list.length} | ${c('landed')} | ${c('filed')} | ${c('applied')} | ${c('deferred')} | ${c('declined')} |`);
}

const show = args.includes('--all') || only ? rows : rows.filter((r) => r.state.includes('filed'));
if (show.length) {
  console.log(`\n${args.includes('--all') || only ? 'Units' : 'Open units (filed, not landed)'}:`);
  for (const r of show) console.log(`  ${r.state.padEnd(15)} ${r.id.padEnd(30)} ${(r.keys ?? []).map((k) => `${k}:${statusOf(k)}`).join(' ') || r.bundle || ''}`);
}
const bundles = Object.entries(coverage.bundles ?? {});
if (!only && bundles.length) {
  console.log('\nDeferred bundles (file when v1.1 opens):');
  for (const [name] of bundles) console.log(`  ${name.padEnd(20)} ${rows.filter((r) => r.bundle === name).length} unit(s)`);
}
