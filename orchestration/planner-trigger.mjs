// Should the planner run now? Prints yes/no with reasons.
import { state, models, stories } from './lib.mjs';
const s = state(), m = models(); const reasons = [];
if (!s.lastPlan) reasons.push('never planned');
if (s.merges - (s.mergesAtLastPlan ?? 0) >= m.plannerEveryMerges) reasons.push(`${s.merges - (s.mergesAtLastPlan ?? 0)} merges since last plan`);
if (s.lastPlan && (Date.now() - Date.parse(s.lastPlan)) / 86400000 >= m.plannerEveryDays) reasons.push('plan older than a week');
// A story blocked on a person is not a planning problem; it lives in needs-human.md and would
// otherwise make the planner permanently "due", which is the same as never being due.
const gated = new Set(stories().filter(st => /human-gated/.test(st.Labels ?? '')).map(st => st.Key));
const esc = Object.entries(s.stories).filter(([k, v]) => !gated.has(k) && (v.status === 'escalate' || v.status === 'blocked')).map(([k]) => k);
if (esc.length) reasons.push(`escalated/blocked: ${esc.join(', ')}`);
console.log(reasons.length ? `yes\n- ${reasons.join('\n- ')}` : 'no');
process.exit(reasons.length ? 0 : 1);
