// Prints the plan as a CSV: for people, and for `jira.mjs bootstrap`. usage: node scripts/plan-export.mjs --csv [--ref origin/main]
// While the CSV is the committed source it is printed as it is on disk; from story files it is
// generated, in key order, quoting only what needs it.
import { pathToFileURL } from 'node:url';
import { readPlan, readPlanAt, toCsv } from './lib/plan.mjs';

export function exportCsv(plan) {
  if (!plan) throw new Error('no plan: neither docs/plan/stories/ nor docs/plan/jira-issues.csv exists');
  return plan.form === 'csv' && plan.csvText != null ? plan.csvText : toCsv(plan.all);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (!argv.includes('--csv')) { console.error('usage: node scripts/plan-export.mjs --csv [--ref REF]'); process.exit(2); }
  const i = argv.indexOf('--ref');
  try { process.stdout.write(exportCsv(i >= 0 ? readPlanAt(argv[i + 1]) : readPlan())); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
