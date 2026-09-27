// Per-document HTML and image-host grants in trust.json (docs/design/13-trust.md §Persistence).

export const TRUST_FILE_VERSION = 1;
export const TRUST_LRU_CAP = 2000;

export interface DocumentGrants {
  readonly html: boolean;
  readonly imageHosts: readonly string[];
  readonly at: number;
}

export interface TrustEnvelope {
  readonly version: number;
  readonly documents: Record<string, DocumentGrants>;
}

export type Grants = Pick<DocumentGrants, 'html' | 'imageHosts'>;

export type LoadTrustResult =
  | { readonly kind: 'ok'; readonly envelope: TrustEnvelope; readonly quarantineBytes?: Uint8Array }
  | { readonly kind: 'quarantined'; readonly envelope: TrustEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyTrustEnvelope(): TrustEnvelope {
  return { version: TRUST_FILE_VERSION, documents: {} };
}

export function quarantinePathFor(trustPath: string, nowMs = Date.now()): string {
  return `${trustPath}.bad-${nowMs}`;
}

/** Punycode hostname for storage; rejects values URL cannot parse as a host. */
export function normalizeImageHost(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === '') return null;
  try {
    const { hostname } = new URL(`https://${trimmed}`);
    return hostname === '' ? null : hostname;
  } catch {
    return null;
  }
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

function normalizeEntry(entry: unknown): DocumentGrants | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  const html = e.html === true;
  const hosts: string[] = [];
  if (Array.isArray(e.imageHosts)) {
    for (const h of e.imageHosts) {
      if (typeof h !== 'string') continue;
      const norm = normalizeImageHost(h);
      if (norm && !hosts.includes(norm)) hosts.push(norm);
    }
  }
  const at = typeof e.at === 'number' ? e.at : Date.now();
  if (!html && hosts.length === 0) return null;
  return { html, imageHosts: hosts, at };
}

export function serializeTrustFile(envelope: TrustEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

function upsertDocument(
  envelope: TrustEnvelope,
  path: string,
  change: Partial<Pick<DocumentGrants, 'html' | 'imageHosts'>>,
): TrustEnvelope {
  const prev = envelope.documents[path];
  const html = change.html ?? prev?.html ?? false;
  const imageHosts = change.imageHosts ?? prev?.imageHosts ?? [];
  const at = Date.now();
  const documents = { ...envelope.documents, [path]: { html, imageHosts: [...imageHosts], at } };
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
  grant(path: string, change: Partial<Pick<DocumentGrants, 'html' | 'imageHosts'>>): Promise<void>;
  revoke(path: string, what: 'html' | 'images' | 'all'): Promise<void>;
  readonly newerVersion: boolean;
}

export function createTrustStore(
  envelope: TrustEnvelope,
  write: TrustWriter['write'],
  opts?: { readonly newerVersion?: boolean },
): TrustStore {
  let state = envelope;
  const newerVersion = opts?.newerVersion === true || envelope.version > TRUST_FILE_VERSION;
  return {
    newerVersion,
    grantsFor(path: string): Grants {
      const entry = state.documents[path];
      return { html: entry?.html === true, imageHosts: entry?.imageHosts ?? [] };
    },
    async grant(path, change) {
      if (newerVersion) return;
      state = upsertDocument(state, path, change);
      await write(serializeTrustFile(state));
    },
    async revoke(path, what) {
      if (newerVersion) return;
      const entry = state.documents[path];
      if (!entry) return;
      if (what === 'all') {
        const documents = { ...state.documents };
        delete documents[path];
        state = { ...state, documents };
      } else if (what === 'html') {
        state = upsertDocument(state, path, { html: false, imageHosts: entry.imageHosts });
        if (!state.documents[path]?.html && state.documents[path]?.imageHosts.length === 0) {
          const documents = { ...state.documents };
          delete documents[path];
          state = { ...state, documents };
        }
      } else {
        state = upsertDocument(state, path, { html: entry.html, imageHosts: [] });
        if (!state.documents[path]?.html && state.documents[path]?.imageHosts.length === 0) {
          const documents = { ...state.documents };
          delete documents[path];
          state = { ...state, documents };
        }
      }
      await write(serializeTrustFile(state));
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
