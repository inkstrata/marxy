// File › Export…: the Export panel (left/panels/export.ts), on the file in front. A viewer's page that offers forms of its
// own (a PDF's text and Markdown) keeps its own dialog (`export/viewer-dialog.ts`), loaded when asked for.
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

/** The focused pane shows a page of the app's own that offers Export of its own (a PDF's file, text and Markdown). */
function viewerOffersExport(): boolean {
  const pane = appHandle()?.panes().focused;
  const viewer = pane?.view.viewer();
  return !!pane && !!viewer?.owns(pane.view.mode) && (viewer.exports?.(pane.view.mode).length ?? 0) > 0;
}

export function exportCommands(): readonly Command[] {
  return [
    {
      id: 'document.export',
      title: 'Export…',
      group: 'document',
      when: (ctx) => ctx.document !== null || viewerOffersExport(),
      async run() {
        const handle = appHandle();
        if (!handle) return;
        if (viewerOffersExport()) {
          const { openViewerExport, viewerExports } = await import('../export/viewer-dialog.ts');
          const path = handle.panes().focused.path();
          if (path) openViewerExport(handle, path, viewerExports(handle));
          return;
        }
        handle.frame().left.show('export', { what: 'file' });
      },
    },
  ];
}
