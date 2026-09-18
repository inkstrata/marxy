// Assemble a snapshot from walked candidates. Pure: first paint cannot wait on this (ADR-0013).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { applyCeiling, type IndexNotice } from './ceiling.ts';
import { isDeniedPath } from './deny.ts';
import { type IndexCandidate, entryFromCandidate } from './entry.ts';
import { classify } from './kinds.ts';
import { INDEX_SNAPSHOT_VERSION, type IndexSnapshot } from './persist.ts';

export interface IndexBuild {
  readonly root: string;
  readonly entries: readonly IndexEntry[];
  readonly notice?: IndexNotice;
}

/**
 * Filter, cap, and turn candidates into entries. Callers decide when; importing this file
 * does not start a walk.
 */
export function buildIndex(root: string, candidates: readonly IndexCandidate[]): IndexBuild {
  const usable = candidates.filter(
    (candidate) => !isDeniedPath(candidate.relativePath) && classify(candidate.relativePath) !== undefined,
  );
  const { kept, notice } = applyCeiling(usable);
  return {
    root,
    entries: kept.map((candidate) => entryFromCandidate(root, candidate)),
    notice,
  };
}

/** Wrap a build in the persisted snapshot shape, with `generatedAtMs` supplied by the caller. */
export function snapshotFromBuild(build: IndexBuild, generatedAtMs: number): IndexSnapshot {
  return {
    version: INDEX_SNAPSHOT_VERSION,
    root: build.root,
    generatedAtMs,
    entries: build.entries,
    notice: build.notice,
  };
}
