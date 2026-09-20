// positions.json on disk: debounced writes, quarantine corrupt files, restore on open (MARXY-38).

import {
  POSITIONS_FILE_VERSION,
  canRestoreStored,
  emptyPositionsEnvelope,
  parsePositionsFile,
  quarantinePathFor,
  readingPositionFromStored,
  serializePositionsFile,
  upsertStoredPosition,
  type PositionsEnvelope,
  type StoredPosition,
} from '@marxy/core/src/position/storage.ts';
import type { ReadingPosition } from '@marxy/core';

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
  private readonly newerVersion: boolean;
  private closed = false;
  private readonly io: PositionPersistenceIo;

  constructor(io: PositionPersistenceIo, load: { envelope: PositionsEnvelope; newerVersion: boolean }) {
    this.io = io;
    this.envelope = load.envelope;
    this.newerVersion = load.newerVersion;
    this.path = io.dataDirectory().then((dir) => `${dir.replace(/\/$/, '')}/positions.json`);
  }

  static async open(io: PositionPersistenceIo): Promise<PositionPersistence> {
    const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/positions.json`;
    let bytes: Uint8Array;
    try {
      bytes = await io.readFile(filePath);
    } catch {
      return new PositionPersistence(io, { envelope: emptyPositionsEnvelope(), newerVersion: false });
    }
    const loaded = parsePositionsFile(bytes);
    if (loaded.kind === 'quarantined') {
      const bad = quarantinePathFor(filePath);
      await io.writeFileAtomic(bad, loaded.quarantineBytes);
      await io.writeFileAtomic(filePath, serializePositionsFile(loaded.envelope));
      return new PositionPersistence(io, { envelope: loaded.envelope, newerVersion: false });
    }
    const newerVersion = loaded.envelope.version > POSITIONS_FILE_VERSION;
    return new PositionPersistence(io, { envelope: loaded.envelope, newerVersion });
  }

  positionForOpen(path: string, byteLength: number): ReadingPosition | null {
    const stored = this.envelope.positions[path];
    if (!stored || !canRestoreStored(byteLength, stored)) return null;
    return readingPositionFromStored(path, stored);
  }

  note(path: string, position: ReadingPosition): void {
    if (this.closed || this.newerVersion) return;
    const entry: StoredPosition = {
      byteOffset: position.byteOffset,
      fraction: position.fraction,
      mode: position.mode,
      at: Date.now(),
    };
    this.envelope = upsertStoredPosition(this.envelope, path, entry);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, POSITIONS_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.closed || this.newerVersion) return;
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
