import { createHash } from 'node:crypto';

/** Files by path; `invoke` reads and writes them like the Rust commands do. */
export const fs = new Map();
/** Set `hooks.readError` to make `read_file` reject with exactly that value: Rust's ShellError, `{ code, message }`. */
/**
 * `invoked` records every other command's name and arguments; `search_content` answers with
 * `hooks.search(args)` (a promise, so a test can hold the scan open).
 */
export const hooks = { readError: null, invoked: [], search: null, watchRoot: null, unwatchRoot: null, afterWrite: null, args: [], pendingOpens: null };
export const convertFileSrc = (p) => p;
/** The webview's fingerprint in hex: the length (8 bytes, big-endian) then the SHA-256. */
const expectation = (bytes) => {
  const len = Buffer.alloc(8);
  len.writeBigUInt64BE(BigInt(bytes.byteLength));
  return len.toString('hex') + createHash('sha256').update(bytes).digest('hex');
};
export const invoke = async (cmd, args, opts) => {
  if (cmd === 'read_file') {
    if (hooks.readError !== null) throw hooks.readError;
    const bytes = fs.get(args.path);
    if (!bytes) throw new Error('not found');
    return bytes.slice().buffer;
  }
  if (cmd === 'read_head') {
    const bytes = fs.get(args.path);
    if (!bytes) throw new Error('not found');
    return bytes.slice(0, args.maxBytes).buffer;
  }
  if (cmd === 'args') return hooks.args;
  // `hooks.pendingOpens()` answers the queue (a promise, so a test can hold the drain open); nothing queued otherwise.
  if (cmd === 'take_pending_opens') return hooks.pendingOpens ? hooks.pendingOpens() : [];
  if (cmd === 'write_file_atomic') {
    const path = decodeURIComponent(opts.headers['x-marxy-path']);
    // `x-marxy-expect` as `atomic_write::write_atomic_unless_changed` checks it: a file there that is not those bytes refuses.
    // Checking opens the file, so `hooks.readError` (a file that cannot be read) fails the write too.
    const expect = opts.headers['x-marxy-expect'];
    if (expect !== undefined && fs.has(path)) {
      if (hooks.readError !== null) throw hooks.readError;
      if (expectation(fs.get(path)) !== expect) throw { code: 'changed', message: `${path}: changed on disk since it was opened; refusing to overwrite`, path };
    }
    fs.set(path, new Uint8Array(args));
    // `hooks.afterWrite()`: the write is on disk but the command has not answered yet, as a slow IPC round trip.
    if (hooks.afterWrite) await hooks.afterWrite();
    return;
  }
  if (cmd === 'write_file_new') {
    // Create-only, as `write_new` is: anything at the name (a file here; the Rust tests cover folders and links) is `exists`, and
    // nothing is written. Tauri rejects with the serialised `ShellError`.
    const path = decodeURIComponent(opts.headers['x-marxy-path']);
    hooks.invoked.push({ cmd, args: { path } });
    if (fs.has(path)) throw { code: 'exists', message: `${path}: there is already a file with this name; marxy will not replace it`, path };
    fs.set(path, new Uint8Array(args));
    return;
  }
  if (cmd === 'search_content' || cmd === 'cancel_content_search') {
    hooks.invoked.push({ cmd, args });
    if (cmd === 'search_content' && hooks.search) return hooks.search(args);
    return cmd === 'search_content' ? { hits: [], scannedFiles: 0, skippedFiles: 0, truncated: false, stopped: null } : undefined;
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
