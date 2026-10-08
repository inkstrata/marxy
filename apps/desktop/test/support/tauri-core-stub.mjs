/** Files by path; `invoke` reads and writes them like the Rust commands do. */
export const fs = new Map();
/** Set `hooks.readError` to make `read_file` reject with exactly that value (Tauri rejects with bare strings). */
/**
 * `invoked` records every other command's name and arguments; `search_content` answers with
 * `hooks.search(args)` (a promise, so a test can hold the scan open).
 */
export const hooks = { readError: null, invoked: [], search: null, watchRoot: null, unwatchRoot: null };
export const convertFileSrc = (p) => p;
export const invoke = async (cmd, args, opts) => {
  if (cmd === 'read_file') {
    if (hooks.readError !== null) throw hooks.readError;
    const bytes = fs.get(args.path);
    if (!bytes) throw new Error('not found');
    return bytes.slice().buffer;
  }
  if (cmd === 'write_file_atomic') {
    fs.set(decodeURIComponent(opts.headers['x-marxy-path']), new Uint8Array(args));
    return;
  }
  if (cmd === 'search_content' || cmd === 'cancel_content_search') {
    hooks.invoked.push({ cmd, args });
    if (cmd === 'search_content' && hooks.search) return hooks.search(args);
    return cmd === 'search_content' ? { hits: [], scannedFiles: 0, truncated: false } : undefined;
  }
  if (cmd === 'watch_root' || cmd === 'unwatch_root') {
    hooks.invoked.push({ cmd, args });
    // `watchRoot(args)` answers `{ key, id? }` and may emit on `fs-watch` before it does, as a thread would.
    if (cmd === 'watch_root') return { id: 1, ...(hooks.watchRoot ? await hooks.watchRoot(args) : { key: args.root }) };
    // `hooks.unwatchRoot(args)` may reject, as the shell does for a watch it no longer holds.
    if (hooks.unwatchRoot) return hooks.unwatchRoot(args);
    return;
  }
  throw new Error(`unstubbed invoke ${cmd}`);
};
