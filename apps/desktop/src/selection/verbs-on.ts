// The `verbs` setting: whether the page's single keys act and the verb bar is drawn. config.toml says
// it (applyAppConfig sets it); a key asks at the moment it is pressed, so a switch in Settings takes effect at once.

let on = true;
const listeners = new Set<() => void>();

export function verbsOn(): boolean {
  return on;
}

export function setVerbsOn(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const cb of [...listeners]) cb();
}

/** `cb` hears each change; returns the off switch. */
export function onVerbs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
