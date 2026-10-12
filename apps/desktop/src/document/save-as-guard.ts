// The Save As dialog, guarded (D-10.1). The path the reader picks may be one another pane shows through its own
// store: a second store for it would break one-store-per-path, and unsaved text in that pane would be thrown away.
// Lifted out of open.ts so the data-safety walk (F-33.1) runs this code, not a copy of it.

import { notify } from '../notices/index.ts';
import type { AppShell } from '../app.ts';
import type { StoreRegistry } from './registry.ts';
import type { DocumentStore } from './store.ts';
import { documentName } from './untitled.ts';

export interface SaveAsGuardDeps {
  readonly shell: Pick<AppShell, 'saveDialog'>;
  /** The store the Save As belongs to. */
  readonly open: DocumentStore;
  readonly stores?: StoreRegistry;
  /** Whether any view over `store` holds Source text not yet folded into it. */
  hasUnfoldedEdits(store: DocumentStore): boolean;
  readonly pane: HTMLElement | undefined;
}

/** The save dialog, refusing (null, with a notice) a path another pane shows with changes that are not saved. */
export function guardSaveAsDialog(deps: SaveAsGuardDeps): (options: Parameters<AppShell['saveDialog']>[0]) => Promise<string | null> {
  return async (options) => {
    const picked = await deps.shell.saveDialog(options);
    if (!picked) return picked;
    const other = deps.stores?.held(picked) ?? null;
    if (other && other !== deps.open) {
      const unsaved = other.snapshot().dirty || deps.hasUnfoldedEdits(other);
      if (unsaved) {
        notify(
          { kind: 'info', text: `${documentName(picked)} is open in the other pane with changes that are not saved. Save or close it there first; nothing was written.` },
          { pane: deps.pane },
        );
        return null;
      }
    }
    return picked;
  };
}
