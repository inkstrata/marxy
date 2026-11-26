// The look's commands: `a` the look at hand, `A` the Studio, `+` `-` `0` the size
// and the look as it shipped, `N` day or night now, `B` lean back, and each look by name in the palette. Single keys act
// only with focus on the page and `verbs` on (selection/bind.ts). With the looks off, `+` `-` `0` and `N` keep their old
// meaning on config.toml's size and variant, so the keys do the expected thing whichever paints the page.
import { LOOKS, allLooks, isTweaked, lookById, merged, reset, schemeOf, setLean, setLook, setMode, tweak } from '@marxy/theme';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { notify } from '../notices/index.ts';
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, applyReaderConfig, currentTextSize, currentVariant, writeReaderKey } from '../theme/reader-config.ts';
import { lookContext, shownLookId } from './painted.ts';
import { toggleLookPop } from './pop.ts';
import { lookState, looksOn, setLookState, turnLooksOff } from './store.ts';

/** The Studio, loaded when first asked for: it is not part of the launch. */
export async function openStudio(arg?: string): Promise<void> {
  const { openStudioSurface } = await import('../studio/studio.ts');
  openStudioSurface(arg);
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

async function configSize(ctx: AppContext, size: number): Promise<void> {
  const next = clamp(size, MIN_SIZE, MAX_SIZE);
  applyReaderConfig(document.documentElement, { variant: currentVariant(), size: next });
  await appHandle()?.relayout();
  await remember(ctx, 'size', String(next));
}

async function remember(ctx: AppContext, key: 'size' | 'variant', value: string): Promise<void> {
  const shell = appHandle()?.shell as AppShell | undefined;
  if (!shell) return;
  try {
    await writeReaderKey(shell, key, value);
  } catch (e) {
    ctx.showNotice(`config.toml could not be updated: ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' });
  }
}

/**
 * A viewer drawing the focused pane (a PDF, a picture) has its own + - 0 for its zoom (viewers/index.ts reads them after
 * the page's keys): the look's size keys stand aside there and apply to text pages.
 */
function viewerOwnsPage(): boolean {
  const pane = appHandle()?.panes().focused;
  const viewer = pane?.content.viewer();
  return pane !== undefined && viewer != null && viewer.owns(pane.view.mode);
}

/** The look the focused pane wears: with "files in reading/ use Book", + on an essay changes Book. */
const shownId = (): string => shownLookId(lookState(), appHandle()?.panes().focused);

const bump = (d: number): void => {
  const s = lookState();
  const id = shownId();
  setLookState(tweak(s, 'size', clamp(merged(s, id).size + d, 14, 34), id));
};

export function lookCommands(): readonly Command[] {
  return [
    {
      id: 'look.pop',
      title: 'Look: the look at hand (looks, size, measure, day or night)',
      key: 'a',
      group: 'view',
      when: () => true,
      run: async () => toggleLookPop(() => void openStudio()),
    },
    {
      id: 'look.studio',
      title: 'Open the Studio: the whole window becomes the place where you shape how text looks',
      key: 'Shift+A',
      group: 'view',
      when: () => true,
      run: () => openStudio(),
    },
    {
      id: 'look.bigger',
      title: 'Text larger',
      key: 'Plus',
      keys: ['='],
      group: 'view',
      when: () => !viewerOwnsPage(),
      run: async (ctx) => (looksOn() ? bump(1) : configSize(ctx, currentTextSize() + 1)),
    },
    {
      id: 'look.smaller',
      title: 'Text smaller',
      key: '-',
      group: 'view',
      when: () => !viewerOwnsPage(),
      run: async (ctx) => (looksOn() ? bump(-1) : configSize(ctx, currentTextSize() - 1)),
    },
    {
      id: 'look.reset',
      title: 'The look as it shipped: your changes to it undone',
      key: '0',
      group: 'view',
      when: () => !viewerOwnsPage(),
      async run(ctx) {
        if (!looksOn()) return configSize(ctx, DEFAULT_SIZE);
        const s = lookState();
        const id = shownId();
        if (!isTweaked(s, id)) return;
        setLookState(reset(s, id));
        notify({ kind: 'done', text: `Your changes to ${lookById(s, id).name} are gone. The Studio's shelf has them back with undo while it is open.` });
      },
    },
    {
      id: 'look.night',
      title: 'Day or night, now',
      key: 'Shift+N',
      group: 'view',
      when: () => true,
      async run(ctx) {
        if (looksOn()) {
          const s = lookState();
          setLookState(setMode(s, schemeOf(s, lookContext()) === 'night' ? 'day' : 'night'));
          return;
        }
        const variant = currentVariant() === 'dark' ? 'light' : 'dark';
        applyReaderConfig(document.documentElement, { variant, size: currentTextSize() });
        await appHandle()?.relayout();
        await remember(ctx, 'variant', `"${variant}"`);
      },
    },
    {
      id: 'look.lean',
      title: 'Lean back: larger type and shorter lines',
      key: 'Shift+B',
      group: 'view',
      when: () => true,
      async run() {
        if (!looksOn()) {
          notify({ kind: 'info', text: 'Lean back is part of a look. Choose one with a, or in the Studio (Shift A), and B leans back.' });
          return;
        }
        const s = lookState();
        setLookState(setLean(s, !s.lean));
      },
    },
    {
      id: 'look.theme',
      title: 'Look: the theme config.toml names, not a look',
      group: 'view',
      when: () => looksOn(),
      run: async () => turnLooksOff(),
    },
    ...LOOKS.map(
      (look): Command => ({
        id: `look.use.${look.id}`,
        title: `Look: ${look.name}`,
        group: 'view',
        when: () => !(looksOn() && lookState().id === look.id) && allLooks(lookState()).some((l) => l.id === look.id),
        run: async () => setLookState(setLook(lookState(), look.id)),
      }),
    ),
  ];
}
