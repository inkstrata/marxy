// positions.json lifecycle: debounced atomic writes and restore on open.

import type { ReadingPosition } from '../contracts/position.ts';
import {
  POSITIONS_FILE_VERSION,
  canRestoreStored,
  emptyPositionsEnvelope,
  isNotFound,
  parsePositionsFile,
  quarantinePathFor,
  readingPositionFromStored,
  serializePositionsFile,
  upsertStoredPosition,
  type PositionsEnvelope,
  type StoredPosition,
} from './storage.ts';

export const POSITIONS_DEBOUNCE_MS = 500;

export interface PositionPersistenceIo {
  readFile(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  dataDirectory(): Promise<string>;
}

export class PositionPersistence {
  private envelope: PositionsEnvelope = emptyPositionsEnvelope();
  private readonly path: Promise<string>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Written by a newer Marxy, or there but not readable: the reader's file is never written over. */
  private readonly readOnly: boolean;
  private closed = false;
  private readonly io: PositionPersistenceIo;

  constructor(io: PositionPersistenceIo, load: { envelope: PositionsEnvelope; readOnly: boolean }) {
    this.io = io;
    this.envelope = load.envelope;
    this.readOnly = load.readOnly;
    this.path = io.dataDirectory().then((dir) => `${dir.replace(/\/$/, '')}/positions.json`);
  }

  static async open(io: PositionPersistenceIo): Promise<PositionPersistence> {
    const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/positions.json`;
    let bytes: Uint8Array;
    try {
      bytes = await io.readFile(filePath);
    } catch (e) {
      return new PositionPersistence(io, { envelope: emptyPositionsEnvelope(), readOnly: !isNotFound(e) });
    }
    const loaded = parsePositionsFile(bytes);
    if (loaded.kind === 'quarantined') {
      const bad = quarantinePathFor(filePath);
      await io.writeFileAtomic(bad, loaded.quarantineBytes);
      await io.writeFileAtomic(filePath, serializePositionsFile(loaded.envelope));
      return new PositionPersistence(io, { envelope: loaded.envelope, readOnly: false });
    }
    const newerVersion = loaded.envelope.version > POSITIONS_FILE_VERSION;
    return new PositionPersistence(io, { envelope: loaded.envelope, readOnly: newerVersion });
  }

  /** `stamp`: the page the place counts in (a book's Markdown); a place kept for another page, or none, is not given. */
  positionForOpen(path: string, byteLength: number, stamp?: string): ReadingPosition | null {
    const stored = this.envelope.positions[path];
    if (!stored || !canRestoreStored(byteLength, stored, stamp)) return null;
    return readingPositionFromStored(path, stored);
  }

  note(path: string, position: ReadingPosition, stamp?: string): void {
    if (this.closed || this.readOnly) return;
    const entry: StoredPosition = {
      byteOffset: position.byteOffset,
      fraction: position.fraction,
      mode: position.mode,
      at: Date.now(),
      ...(stamp === undefined ? {} : { stamp }),
    };
    this.envelope = upsertStoredPosition(this.envelope, path, entry);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // No caller to tell: a write refused (the file changed under it) or failed is said, not thrown into the page.
      this.flush().catch((e: unknown) => console.warn(`marxy: positions.json was not written: ${e instanceof Error ? e.message : String(e)}`));
    }, POSITIONS_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.closed || this.readOnly) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const filePath = await this.path;
    await this.io.writeFileAtomic(filePath, serializePositionsFile(this.envelope));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
