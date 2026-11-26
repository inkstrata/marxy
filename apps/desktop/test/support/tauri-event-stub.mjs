/** Listeners by event name; `emit` calls the ones registered now, and nobody else, as Tauri does. */
const listeners = new Map();
export const emit = (name, payload) => {
  for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
};
/** Set `hold.listen` to a promise to keep every `listen` from answering (and registering) until it settles, as a slow IPC round trip. */
export const hold = { listen: null };
export const listen = async (name, cb) => {
  if (hold.listen) await hold.listen;
  const set = listeners.get(name) ?? new Set();
  listeners.set(name, set);
  set.add(cb);
  return () => set.delete(cb);
};
