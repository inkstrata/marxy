// Chords written the platform's way.
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A registry chord as the platform writes it: ⇧⌘E on a Mac, Ctrl+Shift+E elsewhere. */
export function chordText(spec: string): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  if (MAC) {
    const sym: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };
    return ['Ctrl', 'Alt', 'Shift', 'Mod'].filter((m) => parts.includes(m)).map((m) => sym[m]).join('') + key.toUpperCase();
  }
  return [...parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)), key.length === 1 ? key.toUpperCase() : key].join('+');
}
