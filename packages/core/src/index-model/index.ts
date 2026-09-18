// Index model: root, ignore, deny list, ceiling, persist. Not `src/index` (ADR-0012, ADR-0020).

export { detectIndexRoot, type RootProbe } from './root.ts';
export { DENY_DIRECTORY_NAMES, isDeniedName, isDeniedPath } from './deny.ts';
export { classify, extensionOf } from './kinds.ts';
export { parseIgnore, isIgnored, type IgnoreRule } from './ignore.ts';
export { applyCeiling, type IndexNotice, type CeilingResult } from './ceiling.ts';
export { entryFromCandidate, headingsFromMarkdown, type IndexCandidate, type IndexHeading } from './entry.ts';
export {
  serializeSnapshot,
  parseSnapshot,
  invalidateByMtime,
  snapshotIsCurrent,
  INDEX_SNAPSHOT_VERSION,
  type IndexSnapshot,
  type FileStamp,
  type Invalidation,
} from './persist.ts';
export { collectFiles, type DirectoryReader, type WalkEntry, type WalkOptions } from './walk.ts';
export { buildIndex, snapshotFromBuild, type IndexBuild } from './build.ts';
export { INDEX_SCHEDULE } from './schedule.ts';
export { dirname, basename, joinPath, normalizePath, relativePath } from './paths.ts';
