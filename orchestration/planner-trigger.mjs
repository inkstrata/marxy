// Should the planner run now? Prints yes/no with reasons.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { models, phaseOf } from './lib.mjs';
import { board } from './machine.mjs';
import { planAt } from './plan.mjs';

// The fleet's first day can go mostly on its own machinery while a phase has not started:
// MARXY-107 stops ops process work blocking a phase, but nothing else notices it quietly
// taking most of the throughput. Window and majority threshold for that signal (MARXY-120).
const OPS_WINDOW = 10;

/** Why the planner is due, or an empty list. Pure over its inputs so a test can drive it. */
export function plannerReasons({ s = board(), m = models(), all, d, now = Date.now() } = {}) {
  if (!all || !d) { const plan = planAt(); all ??= plan.rows; d ??= plan.deps; }
  const reasons = [];
  // A planner run that ended counts as a pass over the plan even when it found nothing to change and
  // landed no delta; without that, a cadence reason stayed true and restarted Opus every cooldown.
  const ran = s.planner?.lastEnded ? { at: Date.parse(s.planner.lastEnded), merges: s.planner.mergesAtStart ?? 0 } : null;
  if (!s.lastPlan && !ran) reasons.push('never planned');
  const mergesSince = s.merges - Math.max(s.mergesAtLastPlan ?? 0, ran?.merges ?? 0);
  if (mergesSince >= m.plannerEveryMerges) reasons.push(`${mergesSince} merges since last plan`);
  const lastPass = Math.max(Date.parse(s.lastPlan ?? '') || 0, ran?.at ?? 0);
  if (lastPass && (now - lastPass) / 86400000 >= m.plannerEveryDays) reasons.push('plan older than a week');

  // finished (not git history — the board is the source) gives the last OPS_WINDOW
  // merges by recency; a story outside every numbered phase is ops. A merge cycle.mjs tagged
  // planLanded (it landed a docs/plan/deltas/ file, i.e. the planner's own output) is excluded
  // outright, ops or not: otherwise a run of plan landings — the delta itself plus the CSV/deps/
  // jira-map sync that goes with it — pads the ops-majority count on its own output and can
  // make the trigger fire on the very pass that just answered it (MARXY-200).
  const lastFinished = Object.entries(s.stories)
    .filter(([, v]) => v.finished && !v.planLanded && Date.parse(v.finished) > (ran?.at ?? 0))
    .sort(([, a], [, b]) => Date.parse(b.finished) - Date.parse(a.finished))
    .slice(0, OPS_WINDOW);
  if (lastFinished.length === OPS_WINDOW) {
    const opsCount = lastFinished.filter(([k]) => !Number.isFinite(phaseOf(k, d))).length;
    if (opsCount > OPS_WINDOW / 2) reasons.push(`${opsCount} of the last ${OPS_WINDOW} merges were ops`);
  }

  // A dropped story is settled, not stuck. A story blocked on a person lives in
  // needs-human.md and would otherwise make the planner permanently due (MARXY-107).
  const settled = new Set(all.filter(st => /dropped|human-gated/.test(st.Labels ?? '')).map(st => st.Key));
  const esc = Object.entries(s.stories)
    .filter(([k, v]) => !settled.has(k) && (v.status === 'escalate' || v.status === 'blocked'))
    // A ruling the planner has already read must not make it due again: absent means
    // unread (blockedAt predates this stamp), so it still counts (MARXY-120). A planner run that
    // started after the escalation and has ended has read it, whether or not it landed a delta —
    // otherwise a run that found nothing to change held dispatch forever (ADR-0034).
    .filter(([, v]) => {
      if (v.blockedAt == null) return true;
      const readAt = Math.max(Date.parse(s.lastPlan ?? '') || 0, s.planner?.lastEnded && Date.parse(s.planner.started ?? '') > Date.parse(v.blockedAt) ? Date.parse(s.planner.lastEnded) : 0);
      return Date.parse(v.blockedAt) > readAt;
    })
    .map(([k]) => k);
  if (esc.length) reasons.push(`escalated/blocked: ${esc.join(', ')}`);
  return reasons;
}

// Which of plannerReasons()'s reasons are worth stalling every ready story for, versus merely
// naming. 'never planned' and an unread escalation mean the plan a story would start against is
// missing or wrong; the cadence reasons (merge count, weekly age, ops-majority) mean the plan is
// due for a refresh, not that it is unsafe to keep going while the planner works — a run that can
// take hours must not freeze the whole fleet on a signal that only asks "is it time yet"
// (MARXY-200; MARXY-197 sat blocked for hours on exactly a cadence reason).
export function blocksDispatch(reasons) {
  return reasons.some(r => r === 'never planned' || r.startsWith('escalated/blocked:'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const reasons = plannerReasons();
  console.log(reasons.length ? `yes\n- ${reasons.join('\n- ')}` : 'no');
  process.exit(reasons.length ? 0 : 1);
}
