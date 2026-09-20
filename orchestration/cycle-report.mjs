// Per-cycle phase table: delivered, failed, blockers, whether to keep turning.
import { writeTurnLatest } from './orch-store.mjs';

/** @typedef {{ name: string, delivered?: string[], failed?: string[], blockers?: string[] }} TurnPhase */

/** @param {string | string[] | undefined} v */
function cell(v) {
  const parts = Array.isArray(v) ? v : v ? [v] : [];
  if (!parts.length) return '—';
  return parts.map(s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join('; ');
}

/** @param {TurnPhase[]} phases */
export function formatTurnTable(phases, { compute, continueAdvice } = {}) {
  const header = compute
    ? `# Orchestrator turn — compute **${compute}**\n`
    : '# Orchestrator turn\n';
  const lines = [
    header.trimEnd(),
    '',
    '| Phase | Delivered | Failed | Blockers |',
    '| --- | --- | --- | --- |',
    ...phases.map(p =>
      `| ${p.name} | ${cell(p.delivered)} | ${cell(p.failed)} | ${cell(p.blockers)} |`,
    ),
    '',
    `**Keep turning:** ${continueAdvice ?? '—'}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * @param {{
 *   phases: TurnPhase[],
 *   compute?: string,
 *   inProgress?: string[],
 *   readyCount?: number,
 *   needsReview?: string[],
 *   planDue?: boolean,
 *   humanOpen?: number,
 *   held?: string[],
 *   implementFailed?: string[],
 * }} ctx
 */
export function adviseContinue(ctx) {
  const inProgress = ctx.inProgress ?? [];
  const ready = ctx.readyCount ?? 0;
  const review = ctx.needsReview ?? [];
  const held = ctx.held ?? [];
  const failed = ctx.implementFailed ?? [];

  if (ctx.planDue && ready > 0) {
    return 'pause — planner due before new dispatch';
  }
  if (failed.length && inProgress.length) {
    return 'yes — failures logged; other work in flight';
  }
  if (inProgress.length || ready > 0) return 'yes';
  if (review.length || held.some(h => /held|behind|waiting on CI|review needed/i.test(h))) {
    return 'yes — merge/review queue active';
  }
  if (held.length) return 'slow — waiting on CI, order, or holds';
  if (!inProgress.length && ready === 0 && !review.length) {
    return 'no — nothing ready or in progress';
  }
  return 'yes';
}

/** @param {TurnPhase} phase */
export function printPhaseRow(phase) {
  const line = `| ${phase.name} | ${cell(phase.delivered)} | ${cell(phase.failed)} | ${cell(phase.blockers)} |`;
  console.log(line);
}

/**
 * @param {TurnPhase[]} phases
 * @param {{ compute?: string, home?: string } & Parameters<typeof adviseContinue>[0]} ctx
 */
export function writeTurnReport(phases, ctx) {
  const advice = adviseContinue(ctx);
  const table = formatTurnTable(phases, { compute: ctx.compute, continueAdvice: advice });
  writeTurnLatest(table, { home: ctx.home });
  console.log('');
  console.log(table);
  return advice;
}

/** Parse dispatch.mjs stdout for implementor outcomes. */
export function parseDispatchLines(text) {
  /** @type {{ delivered: string[], failed: string[] }} */
  const out = { delivered: [], failed: [] };
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^([A-Z]+-\d+): exit (\d+), result (\S+.*?), now (\S+)/);
    if (!m) continue;
    const [, key, code, result, now] = m;
    if (now === 'in_review') out.delivered.push(`${key} → PR`);
    else out.failed.push(`${key}: ${result}${code !== '0' ? ` (exit ${code})` : ''}`);
  }
  return out;
}
