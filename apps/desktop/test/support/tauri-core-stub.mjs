/** Files by path; `invoke` reads and writes them like the Rust commands do. */
export const fs = new Map();
export const convertFileSrc = (p) => p;
export const invoke = async (cmd, args, opts) => {
  if (cmd === 'read_file') {
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
