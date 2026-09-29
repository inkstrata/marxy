// The only module that defines run-outcome strings and classifies them (MARXY-255, ADR-0034).
export const OUTCOME = Object.freeze({
  EXITED: 'exited',
  TIMEOUT: 'timeout',
  STALLED: 'stalled',
  SETUP: 'setup',
  AUTH: 'auth',
  NOT_STARTED: 'not-started',
  DEAD: 'dead',
});

/** Minimum streamed output (bytes) before an implement failure counts as real work, not a ghost run. */
export const GHOST_BYTES = 2048;

/** Every string written to a run record as `outcome`. */
export const RUN_OUTCOMES = Object.freeze(Object.values(OUTCOME));

/** What finishRun reads from observeRuns when exit.json is missing or the run is still alive. */
export function inferOutcome(obs) {
  return obs.exit?.outcome ?? (obs.alive ? OUTCOME.TIMEOUT : OUTCOME.DEAD);
}

/** Review or resolution runs that never reached their agent do not spend a try. */
export function neverRan(outcome) {
  return outcome === OUTCOME.SETUP || outcome === OUTCOME.AUTH || outcome === OUTCOME.DEAD;
}

/** Machine preparation or auth failures: not the story's fault; dispatch must not stall on them. */
export function isMachineFault(outcome) {
  return outcome === OUTCOME.AUTH || outcome === OUTCOME.SETUP || outcome === OUTCOME.NOT_STARTED;
}

export function isAuthOutcome(outcome) {
  return outcome === OUTCOME.AUTH;
}

/** Whether an implement run produced commits, dirt, or enough log to count as work. */
export function producedWork(evidence, logBytes) {
  return (evidence.ahead ?? 0) > 0 || evidence.dirty || (logBytes ?? 0) > GHOST_BYTES;
}
