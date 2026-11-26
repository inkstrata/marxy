// Full screen: the window fills the screen and the page alone is its resting state. The frame draws it as a fold (a
// folded frame hides the rail, drawer, tabs and head, and wakes them on the pointer at the top or the left edge) but
// never stores it as one: this holds only whether the window is full screen, and the frame reads that beside its fold.
import type { Shell } from '@marxy/shell-api';

export interface FullScreenDeps {
  readonly shell: Partial<Pick<Shell, 'setFullscreen' | 'isFullscreen'>>;
  /** The state changed: the frame draws again. */
  changed(): void;
  /** The reader entered (not the system): the place to say how to leave. */
  entered?(): void;
}

export interface FullScreen {
  readonly on: boolean;
  enter(): Promise<void>;
  leave(): Promise<void>;
  toggle(): Promise<void>;
  /**
   * Esc: leaves full screen unless something else owns the key (`taken`: an open Line, menu, find bar or editor, or
   * a handler that already used it). True when it left.
   */
  escape(taken: boolean): Promise<boolean>;
  /** Looks at the window: one the system took out of full screen (or put in) is followed, without asking the window again. */
  sync(): Promise<void>;
}

export function createFullScreen(deps: FullScreenDeps): FullScreen {
  let on = false;
  /** Counts enters and leaves: an answer to a look taken before the latest one is stale. */
  let generation = 0;

  const set = (next: boolean): void => {
    on = next;
    generation++;
    deps.changed();
  };

  const self: FullScreen = {
    get on() {
      return on;
    },
    async enter() {
      if (on) return;
      set(true);
      try {
        await deps.shell.setFullscreen?.(true);
      } catch (error) {
        set(false);
        throw error;
      }
      deps.entered?.();
    },
    async leave() {
      if (!on) return;
      set(false);
      try {
        await deps.shell.setFullscreen?.(false);
      } catch (error) {
        set(true);
        throw error;
      }
    },
    toggle: () => (on ? self.leave() : self.enter()),
    async escape(taken) {
      if (!on || taken) return false;
      await self.leave();
      return true;
    },
    async sync() {
      const asked = generation;
      const native = await deps.shell.isFullscreen?.();
      if (native === undefined || asked !== generation || native === on) return;
      set(native);
    },
  };
  return self;
}
