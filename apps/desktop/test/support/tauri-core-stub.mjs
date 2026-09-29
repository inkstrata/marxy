/** Files by path; `invoke` reads and writes them like the Rust commands do. */
export const fs = new Map();
/** Set `hooks.readError` to make `read_file` reject with exactly that value (Tauri rejects with bare strings). */
export const hooks = { readError: null };
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
  throw new Error(`unstubbed invoke ${cmd}`);
};
