// Count only the branch-diff insertions a reviewer has to hold; the plan surface is board text (MARXY-142).

/** The conventions.md over-600 review rule. The number does not move; only what is counted does. */
export const LIMIT = 600;

function under(dir, file) {
  return file === dir || file.startsWith(`${dir}/`);
}

/** True for board rows, plan deltas, task cards, the two map files, results, and CHANGELOG.md. */
export function isPlanSurface(file) {
  return (
    file === 'CHANGELOG.md' ||
    file === 'orchestration/deps.json' ||
    file === 'orchestration/jira-map.json' ||
    under('docs/plan', file) ||
    under('orchestration/results', file)
  );
}

function insertions(added) {
  if (added === '-' || added == null || added === '') return 0;
  const n = Number(added);
  return Number.isFinite(n) ? n : 0;
}

/** Sum `added` on rows that are not plan surface. A binary numstat `-` counts as 0. */
export function budgetedInsertions(rows) {
  return rows.reduce((sum, { added, file }) => sum + (isPlanSurface(file) ? 0 : insertions(added)), 0);
}

const DISCARDED_DELTA = /^docs\/plan\/deltas\/2026-09-18-.*\.md$/;

/** Members of `names` that are the 2026-09-18 plan deltas discarded with MARXY-107. */
export function forbiddenNames(names) {
  return names.filter(n => DISCARDED_DELTA.test(n));
}
