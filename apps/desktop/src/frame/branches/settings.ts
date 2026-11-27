// Settings: config.toml, row by row (settings/settings.ts draws it here).
import { chordText } from '../branch-info.ts';
import type { BranchContext } from '../../left/host-branch.ts';

export function mount(body: HTMLElement, ctx: BranchContext): () => void {
  let dispose: (() => void) | null = null;
  let gone = false;
  void import('../../settings/settings.ts').then(({ mountSettings }) => {
    if (!gone) dispose = mountSettings(body, ctx.handle);
  });
  ctx.foot.textContent = `Every row is a line of config.toml; a change is written at once. ${chordText('Mod+,')} opens this from anywhere.`;
  return () => {
    gone = true;
    dispose?.();
  };
}
