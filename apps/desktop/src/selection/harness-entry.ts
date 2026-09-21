// Patches `marxyApp.start` in the Playwright harness so selection installs without touching app.ts (MARXY-41).

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
    await installRenderedSelection(handle);
    return handle;
  };
}
