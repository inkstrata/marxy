// Reading position, live-reload, and watch classification. Shell-free (ADR-0018, ADR-0020).

export { restorePosition, followPath, blockAt } from './restore.ts';
export { reloadOpenDocument, applyWatchToOpenDocument } from './reload.ts';
export type { ReloadedDocument, OpenDocumentUpdate } from './reload.ts';
export { staleWriteError } from './stale-write.ts';
export { effectForOpenDocument } from './watch-events.ts';
export type { RootWatchEvent, WatchKind, OpenDocumentEffect } from './watch-events.ts';
export { diffSnapshots } from './snapshot.ts';
export type { FileIdentity, DirSnapshot } from './snapshot.ts';
