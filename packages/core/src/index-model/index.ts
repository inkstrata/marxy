// Index model: root, ignore, deny list, ceiling, persist. Not `src/index`.

export { detectIndexRoot, type RootProbe } from './root.ts';
export { DENY_DIRECTORY_NAMES, isDeniedName, isDeniedPath } from './deny.ts';
export { classify, extensionOf } from './kinds.ts';
export { fileTypeOf, fileTypeFor, fileTypeForExtension, tableExtensions, type FileType, type FileKind, type FileMode } from '../kind/registry.ts';
export { parseIgnore, isIgnored, type IgnoreRule } from './ignore.ts';
export { applyCeiling, type IndexNotice, type CeilingResult } from './ceiling.ts';
export { entryFromCandidate, headingsFromMarkdown, readerKindOf, withReaderKinds, type IndexCandidate, type IndexHeading, type ReaderKinds } from './entry.ts';
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
  queryRange,
  removeRoot,
  rootRange,
  denyRulesFor,
  COLLECTION_TEMPLATE,
  type Collection,
  type CollectionRoot,
  type SavedQuery,
  type ByteRange,
  type ParseCollectionResult,
} from './collection.ts';
export { planEvents, ignoreRulesFrom, type FileEvent, type EventPlan } from './apply-events.ts';
export {
  parseCaptures,
  capturePrivacyLines,
  CAPTURE_PRIVACY_LINE,
  type CaptureRule,
} from './capture.ts';
export { parseQuery, type Query, type Group, type Term, type FieldTerm, type TextTerm, type FlaggedTerm, type QueryKey, type CompareOp, type QueryRange } from './query.ts';
export { countsAsMarkdown, countWords, createWordCounter, type WordCounter, type WordCountOptions } from './words.ts';
