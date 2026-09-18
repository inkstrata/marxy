// Classifies a debounced watch batch against the open document (ADR-0018).
// Structural copy of shell-api's WatchEvent: core cannot import the shell (ADR-0020).

export type WatchKind = 'modified' | 'created' | 'removed' | 'renamed';

export interface RootWatchEvent {
  readonly kind: WatchKind;
  readonly path: string;
  readonly to?: string;
}

export type OpenDocumentEffect =
  | { readonly action: 'reload' }
  | { readonly action: 'follow'; readonly path: string }
  | { readonly action: 'gone' }
  | { readonly action: 'ignore' };

const rank = { ignore: 0, reload: 1, gone: 2, follow: 3 } as const;

function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return norm(left) === norm(right);
}

function classifyOne(event: RootWatchEvent, openPath: string): OpenDocumentEffect {
  if (event.kind === 'renamed' && samePath(event.path, openPath) && event.to && !samePath(event.to, openPath)) {
    return { action: 'follow', path: event.to };
  }
  if (event.kind === 'removed' && samePath(event.path, openPath)) {
    return { action: 'gone' };
  }
  if (event.kind === 'renamed' && (samePath(event.path, openPath) || (event.to !== undefined && samePath(event.to, openPath)))) {
    return { action: 'reload' };
  }
  if ((event.kind === 'modified' || event.kind === 'created') && samePath(event.path, openPath)) {
    return { action: 'reload' };
  }
  return { action: 'ignore' };
}

/**
 * What the open document should do with one debounced batch. Follow beats gone so a move that
 * also looks like a delete is not treated as a loss.
 */
export function effectForOpenDocument(
  events: readonly RootWatchEvent[],
  openPath: string,
): OpenDocumentEffect {
  let effect: OpenDocumentEffect = { action: 'ignore' };
  for (const event of events) {
    const next = classifyOne(event, openPath);
    if (rank[next.action] > rank[effect.action]) effect = next;
  }
  return effect;
}
