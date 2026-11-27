// The branches still drawn whole: Settings and Clip, in the drawer from the rail's foot or their commands (Look is
// the Studio). Each branch's code stays its own chunk.
import type { AppHandle } from '../app-types.ts';
import { el } from '../frame/dom.ts';
import type { Frame } from '../frame/types.ts';
import { notify } from '../notices/index.ts';
import { onWritten } from '../theme/written.ts';
import type { ExtraId } from './types.ts';

export interface BranchContext {
  readonly handle: AppHandle;
  readonly frame: Frame;
  /** A strip under the body for a note or a button; empty and not drawn unless filled. */
  readonly foot: HTMLElement;
  /** Runs `cb` when the focused pane's document or focus changes; the branch goes, the subscription goes with it. */
  onPage(cb: () => void): void;
}

export type BranchModule = { mount(body: HTMLElement, ctx: BranchContext): (() => void) | void };

const LOADERS: Readonly<Record<ExtraId, () => Promise<BranchModule>>> = {
  settings: () => import('../frame/branches/settings.ts'),
  clip: () => import('../frame/branches/clip.ts'),
};

export interface HostedBranch {
  /** The branch's body, kept across the panel's draws. */
  readonly el: HTMLElement;
  readonly foot: HTMLElement;
  /** Resolves once the branch has mounted. */
  readonly ready: Promise<void>;
  /** Focus to the branch's first control once it is drawn. */
  focusSoon(): void;
  dispose(): void;
}

function hostBranch(id: ExtraId, handle: AppHandle, frame: Frame): HostedBranch {
  const root = el('div', 'marxy-l-host');
  const body = el('div', 'marxy-l-host-body');
  const foot = el('div', 'marxy-drawer-foot');
  root.dataset.marxyBranch = id;
  root.append(body);
  const offs: (() => void)[] = [];
  let own: (() => void) | void;
  let gone = false;
  let wantFocus = false;
  const focusNow = (tries = 12): void => {
    if (gone || !wantFocus) return;
    const first = body.querySelector<HTMLElement>('input, select, textarea, button:not([disabled])');
    if (first && first.getClientRects().length > 0) {
      wantFocus = false;
      first.focus({ preventScroll: true });
    } else if (tries > 0) requestAnimationFrame(() => focusNow(tries - 1));
  };
  const ready = LOADERS[id]().then(
    (mod) => {
      if (gone) return;
      try {
        own = mod.mount(body, { handle, frame, foot, onPage: (cb) => offs.push(frame.onChange(cb)) });
      } catch (error) {
        console.warn(`marxy: the ${id} branch could not be drawn`, error);
      }
      focusNow();
    },
    (error: unknown) => {
      console.warn(`marxy: the ${id} branch could not be loaded`, error);
      notify({ kind: 'error', text: 'This panel could not be loaded · show it again to try once more.' });
    },
  );
  return {
    el: root,
    foot,
    ready,
    focusSoon() {
      wantFocus = true;
      focusNow();
    },
    dispose() {
      gone = true;
      for (const off of offs) off();
      own?.();
    },
  };
}

/** Settings or Clip in the drawer; Settings keeps the file card under it. */
export function hostExtra(id: ExtraId, handle: AppHandle, frame: Frame): HostedBranch {
  const hosted = hostBranch(id, handle, frame);
  if (id === 'clip') return hosted;
  const card = el('section', 'marxy-card');
  card.dataset.marxyCard = 'now-file';
  hosted.el.append(card);
  let off: (() => void) | void;
  const draw = (): void => {
    void import('../frame/cards/file.ts').then(({ fileShown }) => {
      const pane = handle.panes().focused;
      const path = pane.path() ?? '';
      off?.();
      card.replaceChildren();
      const ctx = { handle, frame, pane, group: 'prose' as const, path };
      if (!fileShown.relevant(ctx)) return;
      const head = el('h3', 'marxy-card-head');
      head.append(el('span', '', fileShown.title(ctx)), el('small', '', fileShown.detail?.(ctx) ?? ''));
      const body = el('div', 'marxy-card-body');
      card.append(head, body);
      off = fileShown.render(body, ctx);
    });
  };
  draw();
  const offWritten = onWritten(draw);
  return {
    ...hosted,
    dispose() {
      offWritten();
      off?.();
      hosted.dispose();
    },
  };
}

