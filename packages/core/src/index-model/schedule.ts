// Indexing is a summoned job after first paint, never chrome at rest (ADR-0012, ADR-0013).

/**
 * When and how the index is allowed to run. Importing this module does no I/O: a walk starts
 * only when a caller asks, so first readable text cannot wait on the index.
 */
export const INDEX_SCHEDULE = {
  /** A walk or cache read must not run on the path that produces `MARK first_text`. */
  precedesFirstPaint: false,
  /** The 50k ceiling notice is palette data, not a standing banner. */
  noticeIsStandingChrome: false,
} as const;
