// Files the system asks to open (a second launch, a Finder or Explorer open). One that comes before the
// launch has shown its own document waits for it: opened first, it would be replaced by the launch's document.

export interface SystemOpens {
  /** The paths one system open names; the first that is a file (not a flag) is opened. */
  take(paths: readonly string[]): void;
  /** The launch has shown its document: what waited is opened, in order, and every later open goes straight through. */
  release(): void;
}

export function holdSystemOpens(open: (path: string) => void): SystemOpens {
  let held: string[] | null = [];
  return {
    take(paths) {
      const file = paths.find((p) => p.length > 0 && !p.startsWith('-'));
      if (!file) return;
      if (held) held.push(file);
      else open(file);
    },
    release() {
      const waiting = held ?? [];
      held = null;
      for (const file of waiting) open(file);
    },
  };
}
