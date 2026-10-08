// The selection harness bundle (MARXY-41). `startApp` now makes the selection controller and installs the
// command keys itself (B-12), so this bundle adds nothing of its own: it marks the page patched and,
// after a start, checks that the app's controller is the one there is. Installing keys or selection
// from this bundle's own copy of the modules would put a second dispatcher on the page.

import { installRenderedSelection } from './view.ts';

declare global {
  interface Window {
    __marxySelectionHarnessPatched?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__marxySelectionHarnessPatched && window.marxyApp?.start) {
  window.__marxySelectionHarnessPatched = true;
  const original = window.marxyApp.start;
  window.marxyApp.start = async (files: Record<string, string>, argv: string[]) => {
    const handle = await original(files, argv);
    await handle.ready;
    installRenderedSelection(handle);
    return handle;
  };
}
