// Light and dark variant, and text size (A-14). Each applies at once, is remembered in config.toml,
// and sets the page again on the grid with the reader on the same line.
import type { AppShell } from '../app.ts';
import {
  DEFAULT_SIZE,
  MAX_SIZE,
  MIN_SIZE,
  applyReaderConfig,
  currentTextSize,
  currentVariant,
  writeReaderKey,
} from '../theme/reader-config.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

async function remember(ctx: AppContext, key: 'variant' | 'size', tomlValue: string): Promise<void> {
  const shell = appHandle()?.shell as AppShell | undefined;
  if (!shell) return;
  try {
    await writeReaderKey(shell, key, tomlValue);
  } catch (e) {
    ctx.showNotice(`config.toml could not be updated: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function useVariant(ctx: AppContext, variant: 'light' | 'dark'): Promise<void> {
  applyReaderConfig(document.documentElement, { variant, size: currentTextSize() });
  await appHandle()?.relayout();
  await remember(ctx, 'variant', `"${variant}"`);
}

async function useSize(ctx: AppContext, size: number): Promise<void> {
  const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));
  applyReaderConfig(document.documentElement, { variant: currentVariant(), size: next });
  await appHandle()?.relayout();
  await remember(ctx, 'size', String(next));
}

export function appearanceCommands(): readonly Command[] {
  return [
    {
      id: 'view.variant-light',
      title: 'Use light variant',
      global: true,
      group: 'view',
      when: () => currentVariant() !== 'light',
      run: (ctx) => useVariant(ctx, 'light'),
    },
    {
      id: 'view.variant-dark',
      title: 'Use dark variant',
      global: true,
      group: 'view',
      when: () => currentVariant() !== 'dark',
      run: (ctx) => useVariant(ctx, 'dark'),
    },
    {
      id: 'view.text-larger',
      title: 'Larger text',
      key: 'Mod+=',
      global: true,
      group: 'view',
      when: () => currentTextSize() < MAX_SIZE,
      run: (ctx) => useSize(ctx, currentTextSize() + 1),
    },
    {
      id: 'view.text-smaller',
      title: 'Smaller text',
      key: 'Mod+-',
      global: true,
      group: 'view',
      when: () => currentTextSize() > MIN_SIZE,
      run: (ctx) => useSize(ctx, currentTextSize() - 1),
    },
    {
      id: 'view.text-default',
      title: 'Default text size',
      key: 'Mod+0',
      global: true,
      group: 'view',
      when: () => currentTextSize() !== DEFAULT_SIZE,
      run: (ctx) => useSize(ctx, DEFAULT_SIZE),
    },
  ];
}
