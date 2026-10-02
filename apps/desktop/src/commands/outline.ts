// "Outline": summon the heading list at the right edge (A-15).
import { closeOutline, openOutline, outlineIsOpen, type OutlineSource } from '../outline/view.ts';
import { appHandle, palette } from './app-handle.ts';
import type { Command } from './registry.ts';

function sourceFromApp(): OutlineSource | null {
  const handle = appHandle();
  if (!handle) return null;
  return {
    document() {
      const open = handle.openDocument();
      return open ? { path: open.path, ast: open.ast } : null;
    },
    position: () => handle.sourceHarness()?.byteOffset ?? 0,
    land: (path, byte) => handle.open(path, { at: byte }),
  };
}

export function outlineCommands(): readonly Command[] {
  return [
    {
      id: 'view.outline',
      title: 'Outline',
      key: 'Mod+Shift+O',
      global: true,
      group: 'view',
      when: () => appHandle()?.openDocument() != null,
      run: async () => {
        if (outlineIsOpen()) {
          closeOutline();
          return;
        }
        const source = sourceFromApp();
        if (!source) return;
        palette()?.close();
        openOutline(source);
      },
    },
  ];
}
