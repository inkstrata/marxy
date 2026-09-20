// Fleet model quality: returns, retries, escalations, escalation-model use — by model family.
// usage: node model-stats.mjs [--json|--brief]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { here, readJson, state, models } from './lib.mjs';
import { appendJsonl, storePaths } from './orch-store.mjs';

/** @typedef {'composer'|'grok'|'claude'|'other'|'unknown'} ModelFamily */

/** @param {string | undefined | null} model */
export function modelFamily(model) {
  const m = (model ?? '').toLowerCase();
  if (!m) return 'unknown';
  if (m.includes('composer')) return 'composer';
  if (m.includes('grok')) return 'grok';
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet')) return 'claude';
  return 'other';
}

/** @param {Record<string, unknown>} event @param {{ home?: string }} [opts] */
export function appendModelEvent(event, opts = {}) {
  appendJsonl(storePaths(opts.home).events, event, opts);
}

/**
 * @param {{ key: string, compute: string, model: string, attempt: number, escalation: boolean, role?: string }} detail
 */
export function logDispatch(detail, opts) {
  appendModelEvent({ kind: 'dispatch', role: 'implementor', ...detail }, opts);
}

/** @param {{ key: string, reason: string, model?: string }} detail */
export function logReturn(detail, opts) {
  appendModelEvent({ kind: 'return', ...detail }, opts);
}

/** @param {{ key: string, model?: string }} detail */
export function logEscalate(detail, opts) {
  appendModelEvent({ kind: 'escalate', ...detail }, opts);
}

/** @param {{ key: string, reason: string, model?: string, compute?: string, attempt?: number, exitCode?: number | null }} detail */
export function logImplementFail(detail, opts) {
  appendModelEvent({ kind: 'implement_fail', ...detail }, opts);
  appendJsonl(storePaths(opts?.home).implementFailures, { kind: 'implement_fail', ...detail }, opts);
}

function resultsDir() {
  return here('results');
}

function hasReviewerNotes(key) {
  return existsSync(here(`results/${key}.notes.md`));
}

/** @returns {Record<ModelFamily, { stories: Set<string>, done: number, firstTryDone: number, retryDone: number, returns: number, escalate: number, blocked: number, inFlight: number, totalAttempts: number }>} */
function emptyFamilies() {
  return Object.fromEntries(
    ['composer', 'grok', 'claude', 'other', 'unknown'].map(f => [
      f,
      {
        stories: new Set(),
        done: 0,
        firstTryDone: 0,
        retryDone: 0,
        returns: 0,
        escalate: 0,
        blocked: 0,
        inFlight: 0,
        totalAttempts: 0,
      },
    ]),
  );
}

export function aggregateBoard(board = state()) {
  const byFamily = emptyFamilies();
  const m = models();
  const maxAttempts = m.maxAttempts ?? 2;

  for (const [key, rec] of Object.entries(board.stories ?? {})) {
    const family = modelFamily(rec.model);
    const bucket = byFamily[family];
    bucket.stories.add(key);
    bucket.totalAttempts += rec.attempts ?? 0;

    if (hasReviewerNotes(key)) bucket.returns += 1;

    if (rec.status === 'done') {
      bucket.done += 1;
      if ((rec.attempts ?? 0) <= 1) bucket.firstTryDone += 1;
      else bucket.retryDone += 1;
    } else if (rec.status === 'escalate') {
      bucket.escalate += 1;
    } else if (rec.status === 'blocked') {
      bucket.blocked += 1;
    } else if (rec.status === 'in_progress' || rec.status === 'in_review' || rec.status === 'todo') {
      if ((rec.attempts ?? 0) > 0 && rec.status !== 'todo') bucket.inFlight += 1;
    }

    if ((rec.attempts ?? 0) >= maxAttempts && rec.status !== 'done') {
      bucket.escalationTierEligible = (bucket.escalationTierEligible ?? 0) + 1;
    }
  }

  return { byFamily, maxAttempts, merges: board.merges ?? 0 };
}

function summarizeEvents(home) {
  const eventsPath = storePaths(home).events;
  if (!existsSync(eventsPath)) return { dispatches: 0, returns: 0, escalates: 0, implementFails: 0, byFamily: {} };
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
  const byFamily = {};
  let dispatches = 0;
  let returns = 0;
  let escalates = 0;
  let implementFails = 0;
  let escalationDispatches = 0;
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const family = modelFamily(row.model);
    byFamily[family] ??= { dispatch: 0, return: 0, escalate: 0, escalationDispatch: 0, implementFail: 0 };
    if (row.kind === 'dispatch') {
      dispatches += 1;
      byFamily[family].dispatch += 1;
      if (row.escalation) {
        escalationDispatches += 1;
        byFamily[family].escalationDispatch += 1;
      }
    } else if (row.kind === 'return') {
      returns += 1;
      byFamily[family].return += 1;
    } else if (row.kind === 'escalate') {
      escalates += 1;
      byFamily[family].escalate += 1;
    } else if (row.kind === 'implement_fail') {
      implementFails += 1;
      byFamily[family].implementFail += 1;
    }
  }
  return { dispatches, returns, escalates, implementFails, escalationDispatches, byFamily };
}

function serializeAgg({ byFamily, maxAttempts, merges }) {
  const families = {};
  for (const [family, b] of Object.entries(byFamily)) {
    if (b.stories.size === 0 && !b.done && !b.returns && !b.escalate) continue;
    families[family] = {
      storiesTouched: b.stories.size,
      done: b.done,
      firstTryDone: b.firstTryDone,
      retryDone: b.retryDone,
      reviewerReturns: b.returns,
      escalate: b.escalate,
      blocked: b.blocked,
      inFlight: b.inFlight,
      totalAttempts: b.totalAttempts,
      escalationTierEligible: b.escalationTierEligible ?? 0,
      firstTryRate: b.done ? b.firstTryDone / b.done : null,
      returnRate: b.stories.size ? b.returns / b.stories.size : null,
    };
  }
  return { merges, maxAttempts, families, events: summarizeEvents() };
}

export function reportBrief() {
  const agg = serializeAgg(aggregateBoard());
  const parts = [];
  for (const [family, s] of Object.entries(agg.families)) {
    if (family === 'unknown' && s.storiesTouched === 0) continue;
    const rate =
      s.firstTryRate != null ? `${Math.round(s.firstTryRate * 100)}% first-try` : 'no merges yet';
    parts.push(
      `${family}: ${s.done} done, ${s.reviewerReturns} returns, ${s.escalate} escalate (${rate})`,
    );
  }
  const ev = agg.events;
  if (ev.dispatches) {
    parts.push(
      `events: ${ev.dispatches} dispatches, ${ev.escalationDispatches} on escalation tier`,
    );
  }
  return parts.join('; ') || 'no model-tagged stories yet';
}

function printHuman(agg) {
  console.log('Model fleet stats (board + optional metrics/events.jsonl)\n');
  console.log(`Merges: ${agg.merges}  maxAttempts: ${agg.maxAttempts}\n`);
  for (const [family, s] of Object.entries(agg.families)) {
    console.log(`## ${family}`);
    console.log(`  stories touched: ${s.storiesTouched}`);
    console.log(`  done: ${s.done} (first try: ${s.firstTryDone}, after retry: ${s.retryDone})`);
    console.log(`  reviewer returns (.notes.md): ${s.reviewerReturns}`);
    console.log(`  escalate status: ${s.escalate}`);
    console.log(`  blocked: ${s.blocked}  in flight: ${s.inFlight}`);
    if (s.firstTryRate != null) {
      console.log(`  first-try success rate: ${(s.firstTryRate * 100).toFixed(1)}%`);
    }
    if (s.returnRate != null) {
      console.log(`  return rate (notes / touched): ${(s.returnRate * 100).toFixed(1)}%`);
    }
    console.log('');
  }
  const ev = agg.events;
  const eventsPath = storePaths().events;
  if (ev.dispatches || existsSync(eventsPath)) {
    console.log('Event log:');
    console.log(
      `  dispatches ${ev.dispatches}, escalation-tier dispatches ${ev.escalationDispatches}, logged returns ${ev.returns}, logged escalates ${ev.escalates}`,
    );
  }
  console.log(
    '\nCompare composer vs grok: add composer to models.json, run fleet; re-run this script.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv[2];
  const agg = serializeAgg(aggregateBoard());
  if (arg === '--json') {
    console.log(JSON.stringify(agg, null, 2));
  } else if (arg === '--brief') {
    console.log(reportBrief());
  } else {
    printHuman(agg);
  }
}
