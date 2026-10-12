// Index model: root, ignore, deny list, ceiling, persist. Not `src/index` (ADR-0012, ADR-0020).

export { detectIndexRoot, type RootProbe } from './root.ts';
export { DENY_DIRECTORY_NAMES, isDeniedName, isDeniedPath } from './deny.ts';
export { classify, extensionOf } from './kinds.ts';
export { fileTypeOf, fileTypeForExtension, tableExtensions, type FileType, type FileKind, type FileMode } from './file-types.ts';
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
export { checkoutOf, gitGroupKey } from './checkout.ts';
export { INDEX_SCHEDULE } from './schedule.ts';
export { dirname, basename, joinPath, normalizePath, relativePath, pathUnder, isUnderRoot } from './paths.ts';
export {
  parseCollection,
  appendRoot,
  appendQuery,
  denyRulesFor,
  COLLECTION_TEMPLATE,
  type Collection,
  type CollectionRoot,
  type SavedQuery,
  type ParseCollectionResult,
} from './collection.ts';
export { planEvents, ignoreRulesFrom, type FileEvent, type EventPlan } from './apply-events.ts';
export {
  parseCaptures,
  capturePrivacyLines,
  CAPTURE_PRIVACY_LINE,
  type CaptureRule,
} from './capture.ts';
export {
  parseQuery,
  completeQuery,
  QUERY_KEYS,
  IS_VALUES,
  HAS_VALUES,
  type Query,
  type Group,
  type Term,
  type FieldTerm,
  type TextTerm,
  type FlaggedTerm,
  type QueryKey,
  type CompareOp,
  type QueryRange,
  type Completion,
  type CompletionItem,
  type CompletionContext,
} from './query.ts';
export {
  capQuery,
  evaluateQuery,
  MAX_QUERY_TERMS,
  MAX_TERM_VALUES,
  indexCandidates,
  measureText,
  textTerms,
  termNote,
  usesContentKeys,
  UNAVAILABLE_STATUSES,
  type QueryHit,
  type QueryContext,
  type Reason,
  type Measure,
  type Measured,
  type LineMatches,
} from './query-eval.ts';
