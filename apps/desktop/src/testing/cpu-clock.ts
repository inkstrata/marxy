// The clock for tests that hold synchronous work to a time budget. It reads this thread's CPU time, not the
// wall clock, so a machine busy with other processes does not make the work look slower; a real slowdown of the
// work itself still does. Imported only by tests (the app takes no Node built-ins in
// source). packages/core keeps its own copy: a relative import never leaves its package.
//
// On Windows the OS charges CPU time in scheduler ticks of about 15.6 ms, so a reading is a multiple of that: use
// it for budgets of 100 ms or more, and for async or browser work keep the wall clock, which CPU time would miss.

/** Milliseconds of CPU time this thread has used; subtract two readings to time the work between them. */
export function cpuNow(): number {
  const { user, system } = process.threadCpuUsage?.() ?? process.cpuUsage();
  return (user + system) / 1000;
}
