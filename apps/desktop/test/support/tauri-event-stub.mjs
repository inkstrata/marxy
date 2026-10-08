/** Listeners by event name; `emit` calls the ones registered now, and nobody else, as Tauri does. */
const listeners = new Map();
export const emit = (name, payload) => {
  for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
};
export const listen = async (name, cb) => {
  const set = listeners.get(name) ?? new Set();
  listeners.set(name, set);
  set.add(cb);
  return () => set.delete(cb);
};
