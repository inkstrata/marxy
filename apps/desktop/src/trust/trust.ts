// Per-document HTML grants in trust.json (docs/design/13-trust.md §Persistence).

export const TRUST_FILE_VERSION = 1;
export const TRUST_LRU_CAP = 2000;

export interface DocumentGrants {
  readonly html: boolean;
  readonly at: number;
}

export interface TrustEnvelope {
  readonly version: number;
  readonly documents: Record<string, DocumentGrants>;
}

export type Grants = Pick<DocumentGrants, 'html'>;

export type LoadTrustResult =
  | { readonly kind: 'ok'; readonly envelope: TrustEnvelope; readonly quarantineBytes?: Uint8Array }
  | { readonly kind: 'quarantined'; readonly envelope: TrustEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyTrustEnvelope(): TrustEnvelope {
  return { version: TRUST_FILE_VERSION, documents: {} };
}

export function quarantinePathFor(trustPath: string, nowMs = Date.now()): string {
  return `${trustPath}.bad-${nowMs}`;
}

export function parseTrustFile(bytes: Uint8Array): LoadTrustResult {
  const fresh = emptyTrustEnvelope();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'number') {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const raw = (parsed as { documents?: unknown }).documents;
  if (raw !== undefined && (typeof raw !== 'object' || raw === null)) {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const documents: Record<string, DocumentGrants> = {};
  if (raw && typeof raw === 'object') {
    for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
      const stored = normalizeEntry(entry);
      if (stored) documents[path] = stored;
    }
  }
  const envelopeVersion = version > TRUST_FILE_VERSION ? version : TRUST_FILE_VERSION;
  return { kind: 'ok', envelope: { version: envelopeVersion, documents } };
}

/**
 * Reads one stored entry. An `imageHosts` field written by an older Marxy is ignored: nothing ever loaded
 * images from it, and it is dropped from the file the next time a grant or revoke writes it.
 */
function normalizeEntry(entry: unknown): DocumentGrants | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (e.html !== true) return null;
  const at = typeof e.at === 'number' ? e.at : Date.now();
  return { html: true, at };
}

export function serializeTrustFile(envelope: TrustEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

function upsertDocument(
  envelope: TrustEnvelope,
  path: string,
  change: Pick<DocumentGrants, 'html'>,
): TrustEnvelope {
  const at = Date.now();
  const documents = { ...envelope.documents, [path]: { html: change.html, at } };
  const keys = Object.keys(documents);
  if (keys.length <= TRUST_LRU_CAP) return { ...envelope, documents };
  const drop = keys
    .sort((a, b) => documents[a].at - documents[b].at)
    .slice(0, keys.length - TRUST_LRU_CAP);
  for (const key of drop) delete documents[key];
  return { ...envelope, documents };
}

export interface TrustWriter {
  write(bytes: Uint8Array): Promise<void>;
}

export interface TrustStore {
  grantsFor(path: string): Grants;
  /**
   * Resolves true once the change is in memory and on disk; false when trust.json comes from a newer
   * Marxy and is left untouched. Rejects, with the in-memory state put back, when the write fails.
   */
  grant(path: string, change: Pick<DocumentGrants, 'html'>): Promise<boolean>;
  revoke(path: string, what: 'html'): Promise<boolean>;
  readonly newerVersion: boolean;
}

export function createTrustStore(
  envelope: TrustEnvelope,
  write: TrustWriter['write'],
  opts?: { readonly newerVersion?: boolean },
): TrustStore {
  // `committed` is what trust.json holds; `state` is what readers see, which runs ahead of it while writes
  // are queued.
  let committed = envelope;
  let state = envelope;
  const newerVersion = opts?.newerVersion === true || envelope.version > TRUST_FILE_VERSION;
  // Writes run one after another in the order the changes were made, so two grants started together
  // cannot land on disk out of order and leave the older state as the file. Each change is computed
  // inside the queue from the last committed state, so a failed write leaves no trace in a later one.
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  type Change = (base: TrustEnvelope) => TrustEnvelope | null;
  const persist = async (change: Change): Promise<boolean> => {
    const optimistic = change(state);
    if (optimistic !== null) state = optimistic;
    pending += 1;
    const done = queue.then(async () => {
      const next = change(committed);
      if (next === null) return;
      await write(serializeTrustFile(next));
      committed = next;
    });
    queue = done.catch(() => undefined);
    try {
      await done;
    } finally {
      pending -= 1;
      if (pending === 0) state = committed;
    }
    return true;
  };
  const without = (env: TrustEnvelope, path: string): TrustEnvelope => {
    const documents = { ...env.documents };
    delete documents[path];
    return { ...env, documents };
  };
  return {
    newerVersion,
    grantsFor(path: string): Grants {
      const entry = state.documents[path];
      return { html: entry?.html === true };
    },
    async grant(path, change) {
      if (newerVersion) return false;
      return persist((base) => upsertDocument(base, path, change));
    },
    async revoke(path) {
      if (newerVersion) return false;
      return persist((base) => (base.documents[path] ? without(base, path) : null));
    },
  };
}

export interface TrustIo {
  readFile(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  dataDirectory(): Promise<string>;
}

export async function loadTrust(io: TrustIo): Promise<TrustStore> {
  const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/trust.json`;
  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(filePath);
  } catch {
    return createTrustStore(emptyTrustEnvelope(), (b) => io.writeFileAtomic(filePath, b));
  }
  const loaded = parseTrustFile(bytes);
  if (loaded.kind === 'quarantined') {
    const bad = quarantinePathFor(filePath);
    await io.writeFileAtomic(bad, loaded.quarantineBytes);
    await io.writeFileAtomic(filePath, serializeTrustFile(loaded.envelope));
    return createTrustStore(loaded.envelope, (b) => io.writeFileAtomic(filePath, b));
  }
  const newerVersion = loaded.envelope.version > TRUST_FILE_VERSION;
  return createTrustStore(loaded.envelope, (b) => io.writeFileAtomic(filePath, b), { newerVersion });
}
