// history.json load/save for palette MRU, pins, and recent roots (design §07, §11).

import { INDEX_LIMITS } from '@marxy/core';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import { quarantinePathFor } from '@marxy/core/src/position/storage.ts';
import type { AppShell } from '../app.ts';
import { recordOpen, setPaletteHydration, type PaletteSession } from './session.ts';

export const HISTORY_FILE_VERSION = 1;
export const HISTORY_OPENS_CAP = 500;

export interface HistoryOpen {
  readonly path: string;
  readonly at: number;
}

export interface HistoryEnvelope {
  readonly version: number;
  readonly opens: readonly HistoryOpen[];
  readonly pins: readonly string[];
  readonly recentRoots: readonly string[];
}

type HistoryIo = Pick<AppShell, 'readFile' | 'writeFileAtomic'> & Required<Pick<AppShell, 'configPaths'>>;

export function emptyHistoryEnvelope(): HistoryEnvelope {
  return { version: HISTORY_FILE_VERSION, opens: [], pins: [], recentRoots: [] };
}

export function parseHistoryFile(bytes: Uint8Array): {
  readonly envelope: HistoryEnvelope;
  readonly quarantine: boolean;
} {
  const fresh = emptyHistoryEnvelope();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { envelope: fresh, quarantine: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { envelope: fresh, quarantine: true };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { envelope: fresh, quarantine: true };
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'number') {
    return { envelope: fresh, quarantine: true };
  }
  const opensRaw = (parsed as { opens?: unknown }).opens;
  const pinsRaw = (parsed as { pins?: unknown }).pins;
  const rootsRaw = (parsed as { recentRoots?: unknown }).recentRoots;
  const opens: HistoryOpen[] = [];
  if (Array.isArray(opensRaw)) {
    for (const item of opensRaw) {
      if (typeof item !== 'object' || item === null) continue;
      const path = (item as { path?: unknown }).path;
      const at = (item as { at?: unknown }).at;
      if (typeof path === 'string' && typeof at === 'number') opens.push({ path, at });
    }
  }
  const pins = Array.isArray(pinsRaw)
    ? pinsRaw.filter((p): p is string => typeof p === 'string')
    : [];
  const recentRoots = Array.isArray(rootsRaw)
    ? rootsRaw.filter((p): p is string => typeof p === 'string')
    : [];
  const cappedOpens = opens.slice(-HISTORY_OPENS_CAP);
  const cappedRoots = recentRoots.slice(0, INDEX_LIMITS.recentRoots);
  const envelopeVersion = version > HISTORY_FILE_VERSION ? version : HISTORY_FILE_VERSION;
  return {
    envelope: {
      version: envelopeVersion,
      opens: cappedOpens,
      pins: [...pins],
      recentRoots: cappedRoots,
    },
    quarantine: false,
  };
}

export function serializeHistoryFile(envelope: HistoryEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

export function sessionFromHistory(envelope: HistoryEnvelope, fallbackRoot: string): PaletteSession {
  let session = emptySessionUncached(fallbackRoot);
  if (envelope.recentRoots.length > 0) {
    session = { ...session, currentRoot: envelope.recentRoots[0]!, recentRoots: [...envelope.recentRoots] };
  }
  session = { ...session, pinned: [...envelope.pins] };
  const sortedOpens = [...envelope.opens].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const mru: string[] = [];
  for (const open of sortedOpens) {
    if (seen.has(open.path)) continue;
    seen.add(open.path);
    mru.push(open.path);
  }
  session = { ...session, mru };
  const history = envelope.opens.map((o) => o.path);
  session = { ...session, history, historyIndex: history.length > 0 ? history.length - 1 : -1 };
  return session;
}

export function historyFromSession(session: PaletteSession): HistoryEnvelope {
  const opens: HistoryOpen[] = [];
  const now = Date.now();
  for (let i = session.history.length - 1; i >= 0; i--) {
    const path = session.history[i];
    if (path === undefined) continue;
    opens.unshift({ path, at: now - (session.history.length - 1 - i) });
  }
  for (const path of session.mru) {
    if (!opens.some((o) => o.path === path)) opens.unshift({ path, at: now });
  }
  const capped = opens.slice(-HISTORY_OPENS_CAP);
  return {
    version: HISTORY_FILE_VERSION,
    opens: capped,
    pins: session.pinned.filter((path) => path.length > 0),
    recentRoots: session.recentRoots.slice(0, INDEX_LIMITS.recentRoots),
  };
}

function emptySessionUncached(currentRoot: string): PaletteSession {
  return {
    pinned: [],
    mru: [],
    history: [],
    historyIndex: -1,
    currentRoot,
    recentRoots: [currentRoot],
  };
}

let historyNewerVersion = false;
let sessionMirror: PaletteSession | null = null;

export function resetPaletteHistoryMirror(): void {
  sessionMirror = null;
}

/** App opens (argv, reload, palette) merge into the mirror saved beside the palette session on quit. */
export function trackDocumentOpen(path: string): void {
  const root = dirname(path);
  const base = sessionMirror ?? emptySessionUncached(root);
  sessionMirror = recordOpen(base, path, root);
}

function mergeSessions(disk: PaletteSession, palette: PaletteSession): PaletteSession {
  let session = disk;
  for (const path of palette.mru) {
    if (!session.mru.includes(path)) session = recordOpen(session, path);
  }
  return { ...session, pinned: [...palette.pinned] };
}

async function historyPath(shell: HistoryIo): Promise<string> {
  const { data } = await shell.configPaths();
  return `${data.replace(/\/$/, '')}/history.json`;
}

export async function loadPaletteHistory(shell: HistoryIo, fallbackRoot: string): Promise<void> {
  const filePath = await historyPath(shell);
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(filePath);
  } catch {
    return;
  }
  const loaded = parseHistoryFile(bytes);
  if (loaded.quarantine) {
    const bad = quarantinePathFor(filePath);
    await shell.writeFileAtomic(bad, bytes);
    const fresh = emptyHistoryEnvelope();
    await shell.writeFileAtomic(filePath, serializeHistoryFile(fresh));
    setPaletteHydration(sessionFromHistory(fresh, fallbackRoot));
    return;
  }
  historyNewerVersion = loaded.envelope.version > HISTORY_FILE_VERSION;
  if (historyNewerVersion) return;
  const session = sessionFromHistory(loaded.envelope, fallbackRoot);
  sessionMirror = session;
  setPaletteHydration(session);
}

export async function savePaletteHistory(shell: HistoryIo, session: PaletteSession): Promise<void> {
  if (historyNewerVersion) return;
  const filePath = await historyPath(shell);
  await shell.writeFileAtomic(filePath, serializeHistoryFile(historyFromSession(session)));
}

export async function flushPaletteHistoryFromApp(
  shell: HistoryIo,
  paletteSession: PaletteSession | undefined,
): Promise<void> {
  let session = sessionMirror ?? paletteSession ?? emptySessionUncached('/');
  if (paletteSession && sessionMirror) session = mergeSessions(sessionMirror, paletteSession);
  else if (paletteSession) session = paletteSession;
  await savePaletteHistory(shell, session);
}

export async function notePaletteOpen(shell: HistoryIo, path: string, session: PaletteSession): Promise<PaletteSession> {
  const root = dirname(path);
  const next = recordOpen(session, path, root);
  await savePaletteHistory(shell, next);
  return next;
}

export {
  emptySession,
  rememberRoot,
  recordOpen,
  togglePin,
  goBack,
  goForward,
  emptyQueryPaths,
  OPENS_CAP,
  type PaletteSession,
} from './session.ts';
