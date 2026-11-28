// Whether this is a Mac, where the command key is ⌘ (Meta) and not Ctrl. Read on each call, not once at load, so that a
// test which sets the platform after the import still sees it.

/** True when `navigator.platform` names a Mac. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}
