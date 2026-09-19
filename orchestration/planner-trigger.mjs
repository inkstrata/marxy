// Should the planner run now? Prints yes/no with reasons.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { state, models, stories } from './lib.mjs';

/** Why the planner is due, or an empty list. Pure over its inputs so a test can drive it. */
export function plannerReasons({ s = state(), m = models(), all = stories(), now = Date.now() } = {}) {
  const reasons = [];
  if (!s.lastPlan) reasons.push('never planned');
  if (s.merges - (s.mergesAtLastPlan ?? 0) >= m.plannerEveryMerges) reasons.push(`${s.merges - (s.mergesAtLastPlan ?? 0)} merges since last plan`);
  if (s.lastPlan && (now - Date.parse(s.lastPlan)) / 86400000 >= m.plannerEveryDays) reasons.push('plan older than a week');
  // A story blocked on a person is not a planning problem; it lives in needs-human.md and would
  // otherwise make the planner permanently "due", which is the same as never being due. A dropped
  // story is settled, not stuck (MARXY-107).
  const settled = new Set(all.filter(st => /human-gated|dropped/.test(st.Labels ?? '')).map(st => st.Key));
  const esc = Object.entries(s.stories).filter(([k, v]) => !settled.has(k) && (v.status === 'escalate' || v.status === 'blocked')).map(([k]) => k);
  if (esc.length) reasons.push(`escalated/blocked: ${esc.join(', ')}`);
  return reasons;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const reasons = plannerReasons();
  console.log(reasons.length ? `yes\n- ${reasons.join('\n- ')}` : 'no');
  process.exit(reasons.length ? 0 : 1);
}
