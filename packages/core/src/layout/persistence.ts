// layout.json lifecycle: debounced atomic writes of the remembered split (07 §4.6, §6.5). A twin of
// PositionPersistence: same io, same debounce, same quarantine of a corrupt file, same refusal to overwrite
// a file written by a newer version.

import { POSITIONS_DEBOUNCE_MS, type PositionPersistenceIo } from '../position/persistence.ts';
import {
  LAYOUT_FILE_VERSION,
  emptyLayoutEnvelope,
  parseLayoutFile,
  quarantinePathFor,
  serializeLayoutFile,
  type LayoutEnvelope,
} from './storage.ts';

export const LAYOUT_DEBOUNCE_MS = POSITIONS_DEBOUNCE_MS;
/** A layout is two paths: a file over this is not one, and is never read whole (it waits before first text). */
export const LAYOUT_MAX_BYTES = 64 * 1024;

/** The shell's io, with an optional bounded read so a huge file is never read whole. */
export interface LayoutPersistenceIo extends PositionPersistenceIo {
  readHead?(path: string, maxBytes: number): Promise<Uint8Array>;
}

export class LayoutPersistence {
  private current: LayoutEnvelope;
  private readonly newerVersion: boolean;
  private readonly filePath: string;
  private readonly io: LayoutPersistenceIo;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Something was noted since the file was read: a flush with nothing noted leaves the file alone. */
  private dirty = false;
  private closed = false;

  private constructor(io: LayoutPersistenceIo, filePath: string, current: LayoutEnvelope, newerVersion: boolean) {
    this.io = io;
    this.filePath = filePath;
    this.current = current;
    this.newerVersion = newerVersion;
  }

  static async open(io: LayoutPersistenceIo): Promise<LayoutPersistence> {
    const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/layout.json`;
    let bytes: Uint8Array;
    try {
      bytes = io.readHead ? await io.readHead(filePath, LAYOUT_MAX_BYTES + 1) : await io.readFile(filePath);
    } catch {
      return new LayoutPersistence(io, filePath, emptyLayoutEnvelope(), false);
    }
    if (bytes.length > LAYOUT_MAX_BYTES) {
      // Not a layout. The start of it is kept beside the file; the file itself is left exactly as it is
      // and is never written, so nothing of it is lost, and the launch goes on as if there were no layout.
      await io.writeFileAtomic(quarantinePathFor(filePath), bytes.slice(0, LAYOUT_MAX_BYTES));
      return new LayoutPersistence(io, filePath, emptyLayoutEnvelope(), true);
    }
    const loaded = parseLayoutFile(bytes);
    if (loaded.kind === 'quarantined') {
      // The bytes are kept beside the file, never deleted; the file itself starts again empty.
      await io.writeFileAtomic(quarantinePathFor(filePath), loaded.quarantineBytes);
      await io.writeFileAtomic(filePath, serializeLayoutFile(loaded.envelope));
      return new LayoutPersistence(io, filePath, loaded.envelope, false);
    }
    return new LayoutPersistence(io, filePath, loaded.envelope, loaded.envelope.version > LAYOUT_FILE_VERSION);
  }

  /** The layout as read (empty when there was none, or when it was quarantined). */
  saved(): LayoutEnvelope {
    return this.current;
  }

  /** The file was written by a newer Marxy: it is read, never written. */
  get readOnly(): boolean {
    return this.newerVersion;
  }

  note(envelope: LayoutEnvelope): void {
    if (this.closed || this.newerVersion) return;
    this.current = { ...envelope, version: LAYOUT_FILE_VERSION };
    this.dirty = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, LAYOUT_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.closed || this.newerVersion) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    await this.io.writeFileAtomic(this.filePath, serializeLayoutFile(this.current));
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}
