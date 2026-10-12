// workspace.json: the panels the reader last had unfolded (ADR-0058 item 4; W-02). Marxy's own state, a plain
// file beside layout.json with the same envelope, version guard and quarantine (07 §4.6, §6.5): corrupt bytes
// are kept beside it and the file starts again empty, and a newer version is read but never overwritten.
//
// The window always opens folded, so this file is read when the reader unfolds and written when they fold:
// never at launch. A missing file means "nothing remembered", and the caller's defaults apply; an empty one is
// not a workspace file and is kept beside itself like any other bytes that are not.

import { quarantinePathFor } from '../position/storage.ts';
import { LAYOUT_MAX_BYTES, type LayoutPersistenceIo } from './persistence.ts';

export { quarantinePathFor };

export const WORKSPACE_FILE_VERSION = 1;
export const WORKSPACE_FILE_NAME = 'workspace.json';

/**
 * The six regions of the unfolded workspace, in the order they are drawn (ADR-0058 item 1). The names are the
 * values of `data-marxy-workspace-region`; scripts/gate-aesthetics.mjs holds the same list (a test pins them equal).
 */
export const WORKSPACE_REGIONS = ['sidebar', 'toolbar', 'tabs', 'strip', 'inspector', 'status-bar'] as const;
export type WorkspaceRegion = (typeof WORKSPACE_REGIONS)[number];

/** Which regions were docked (shown) when the reader last had the workspace unfolded; absent means "not said". */
export type RememberedPanels = Partial<Record<WorkspaceRegion, boolean>>;

/**
 * The sidebar's sections, top to bottom (W-07; W-08 adds Repositories and Folders; Q-07 adds Smart collections). The ids
 * are the values of `data-marxy-sidebar-section`; the desktop app's sidebar titles them.
 */
export const SIDEBAR_SECTION_IDS = ['recent', 'pinned', 'repos', 'folders', 'smart'] as const;
export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number];

/** What the sidebar remembers (W-07): which of its sections the reader folded. */
export interface SidebarState {
  readonly collapsed: readonly SidebarSectionId[];
}

export interface WorkspaceEnvelope {
  readonly version: number;
  readonly panels: RememberedPanels;
  /** Absent until the reader first folds a section: a file that never had one is written without the key. */
  readonly sidebar?: SidebarState;
}

/** Known ids only, once each, in the sidebar's order: anything else is dropped, never an error. */
export function cleanSidebarState(raw: unknown): SidebarState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const list = (raw as Record<string, unknown>).collapsed;
  const given = new Set(Array.isArray(list) ? list : []);
  return { collapsed: SIDEBAR_SECTION_IDS.filter((id) => given.has(id)) };
}

export type LoadWorkspaceResult =
  | { readonly kind: 'ok'; readonly envelope: WorkspaceEnvelope }
  | { readonly kind: 'quarantined'; readonly envelope: WorkspaceEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyWorkspaceEnvelope(): WorkspaceEnvelope {
  return { version: WORKSPACE_FILE_VERSION, panels: {} };
}

export function parseWorkspaceFile(bytes: Uint8Array): LoadWorkspaceResult {
  const fresh = emptyWorkspaceEnvelope();
  const bad = (): LoadWorkspaceResult => ({ kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bad();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return bad();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad();
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) return bad();

  // Only the six known regions, only booleans: anything else is dropped, never an error.
  const panels: Partial<Record<WorkspaceRegion, boolean>> = {};
  const raw = obj.panels;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const name of WORKSPACE_REGIONS) {
      const value = (raw as Record<string, unknown>)[name];
      if (typeof value === 'boolean') panels[name] = value;
    }
  }
  const version = obj.version > WORKSPACE_FILE_VERSION ? obj.version : WORKSPACE_FILE_VERSION;
  const sidebar = cleanSidebarState(obj.sidebar);
  return { kind: 'ok', envelope: sidebar ? { version, panels, sidebar } : { version, panels } };
}

export function serializeWorkspaceFile(envelope: WorkspaceEnvelope): Uint8Array {
  // Region order, so the file reads the same however the panels were set.
  const panels: Partial<Record<WorkspaceRegion, boolean>> = {};
  for (const name of WORKSPACE_REGIONS) {
    const value = envelope.panels[name];
    if (typeof value === 'boolean') panels[name] = value;
  }
  const sidebar = cleanSidebarState(envelope.sidebar);
  const body = JSON.stringify(sidebar ? { version: envelope.version, panels, sidebar } : { version: envelope.version, panels }, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

/** workspace.json's lifecycle: read once, at the first unfold; written on fold (and at quit, while unfolded). */
export class WorkspacePersistence {
  private readonly filePath: string;
  private readonly io: LayoutPersistenceIo;
  /** What the file holds now: the panels and the sidebar are written one at a time, each keeping the other's last word. */
  private current: WorkspaceEnvelope;
  private readonly newerVersion: boolean;
  /** Set when the file was found corrupt: the reader is told once, by whoever opened it. */
  readonly quarantined: boolean;

  private constructor(io: LayoutPersistenceIo, filePath: string, current: WorkspaceEnvelope, newerVersion: boolean, quarantined: boolean) {
    this.io = io;
    this.filePath = filePath;
    this.current = current;
    this.newerVersion = newerVersion;
    this.quarantined = quarantined;
  }

  static async open(io: LayoutPersistenceIo): Promise<WorkspacePersistence> {
    const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/${WORKSPACE_FILE_NAME}`;
    let bytes: Uint8Array;
    try {
      bytes = io.readHead ? await io.readHead(filePath, LAYOUT_MAX_BYTES + 1) : await io.readFile(filePath);
    } catch {
      return new WorkspacePersistence(io, filePath, emptyWorkspaceEnvelope(), false, false);
    }
    if (bytes.length > LAYOUT_MAX_BYTES) {
      // Not a workspace file: keep what was read beside it, start again empty.
      await io.writeFileAtomic(quarantinePathFor(filePath), bytes.slice(0, LAYOUT_MAX_BYTES));
      const fresh = emptyWorkspaceEnvelope();
      await io.writeFileAtomic(filePath, serializeWorkspaceFile(fresh));
      return new WorkspacePersistence(io, filePath, fresh, false, true);
    }
    const loaded = parseWorkspaceFile(bytes);
    if (loaded.kind === 'quarantined') {
      // The bytes are kept beside the file, never deleted; the file itself starts again empty.
      await io.writeFileAtomic(quarantinePathFor(filePath), loaded.quarantineBytes);
      await io.writeFileAtomic(filePath, serializeWorkspaceFile(loaded.envelope));
      return new WorkspacePersistence(io, filePath, loaded.envelope, false, true);
    }
    return new WorkspacePersistence(io, filePath, loaded.envelope, loaded.envelope.version > WORKSPACE_FILE_VERSION, false);
  }

  /** The panels as read (empty when there was no file, or when it was quarantined). */
  saved(): RememberedPanels {
    return this.current.panels;
  }

  /** The sidebar as read: nothing folded when the file says nothing (called by `workspaceStoreFor`, for the sidebar fill). */
  savedSidebar(): SidebarState {
    return this.current.sidebar ?? { collapsed: [] };
  }

  /** The file was written by a newer Marxy: it is read, never written. */
  get readOnly(): boolean {
    return this.newerVersion;
  }

  /** Writes `panels` now (atomically). A newer version's file is left alone. */
  async write(panels: RememberedPanels): Promise<void> {
    if (this.newerVersion) return;
    this.current = { ...this.current, version: WORKSPACE_FILE_VERSION, panels };
    await this.io.writeFileAtomic(this.filePath, serializeWorkspaceFile(this.current));
  }

  /** Writes the folded sections now, with the panels as last read or written. A newer version's file is left alone. */
  async writeSidebar(sidebar: SidebarState): Promise<void> {
    if (this.newerVersion) return;
    this.current = { ...this.current, version: WORKSPACE_FILE_VERSION, sidebar: cleanSidebarState(sidebar) };
    await this.io.writeFileAtomic(this.filePath, serializeWorkspaceFile(this.current));
  }
}
