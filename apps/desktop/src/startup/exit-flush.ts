// What the shell's quit and the window's close write before the window goes: the reader's state files, then the shell's
// own quit or close. The real window's close never calls quit, so both write; a close also waits for queued Versions copies.
import { flushVersions } from '../versions/recorder.ts';
import type { AppShell } from '../app-types.ts';

/** How long a window close waits for Marxy's own files (as `flushVersions` waits for copies): a slow disk never holds it open. */
const CLOSE_FLUSH_MS = 1500;

interface Flushable {
  flush(): Promise<unknown>;
}

/**
 * `injected`'s quit and close, each writing what `kept()` holds first. `kept` is read when they run: the stores are made
 * after the shell they write through. At close each store is written whatever another does, all within a bound.
 */
export function flushingOnExit(injected: AppShell, kept: () => readonly Flushable[]): Pick<AppShell, 'quit' | 'confirmClose'> {
  return {
    quit: async (code) => {
      for (const store of kept()) await store.flush();
      return injected.quit(code);
    },
    confirmClose: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const written = Promise.all(
        kept().map((store) => store.flush().catch((e: unknown) => console.warn(`marxy: not written at close: ${String(e)}`))),
      ).then(() => true);
      const outOfTime = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), CLOSE_FLUSH_MS)));
      const [inTime] = await Promise.all([Promise.race([written, outOfTime]), flushVersions()]);
      clearTimeout(timer);
      if (!inTime) console.warn(`marxy: state files still being written after ${CLOSE_FLUSH_MS} ms; closing without them`);
      return injected.confirmClose();
    },
  };
}
