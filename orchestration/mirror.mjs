// When the Jira mirror needs a full push (ADR-0034, step 7). `jira.mjs push` searches every issue, so
// an idle fleet must not do it every cycle. The board's `seq` counts every event; if it has not moved
// since the last push that succeeded, Jira already agrees. The fleet never reads Jira back, so a
// change made there by hand is only noticed by the periodic forced push.

/** A push happens at least this often, whatever the board did. */
export const FORCE_PUSH_MS = 60 * 60_000;

/**
 * Whether to push now. `last` is what the last fully successful mirror recorded: `{ seq, at }`, or
 * null when there is none (first cycle, or a mirror call failed and must be retried).
 */
export function pushDue({ seq, last, nowMs }) {
  if (!last || !Number.isFinite(last.seq) || !Number.isFinite(Date.parse(last.at))) return true;
  if (seq !== last.seq) return true;
  return nowMs - Date.parse(last.at) >= FORCE_PUSH_MS || nowMs < Date.parse(last.at);
}
