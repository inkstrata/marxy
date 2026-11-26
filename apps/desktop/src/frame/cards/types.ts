// The cards: what each knows of the file in front, drawn inside the left section's Metadata, Outline and Links panels.
// A viewer brings its own cards by slot; each kind belongs to a group of kinds.
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { CardGroup, CardId } from '@marxy/core/src/layout/frame-storage.ts';
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import type { AppHandle } from '../../app-types.ts';
import type { Frame, FramePane } from '../types.ts';

const GROUP_OF: Readonly<Record<Kind, CardGroup>> = {
  article: 'prose',
  report: 'prose',
  book: 'prose',
  readme: 'prose',
  docs: 'prose',
  notes: 'prose',
  changelog: 'prose',
  html: 'prose',
  code: 'code',
  data: 'data',
  log: 'log',
  terminal: 'session',
  diff: 'patch',
  transcript: 'conversation',
};

export const kindGroupOf = (kind: Kind | null): CardGroup => (kind ? GROUP_OF[kind] : 'prose');

/** A pane's group: its kind's, but a notebook read as one keeps its own (Cells and Notebook where data has neither). */
export const groupOfPane = (pane: FramePane, path: string | null): CardGroup =>
  pane.kind() === 'data' && path !== null && fileTypeFor(path).reading === 'notebook' ? 'notebook' : kindGroupOf(pane.kind());

export interface CardContext {
  readonly handle: AppHandle;
  readonly frame: Frame;
  readonly pane: FramePane;
  readonly group: CardGroup;
  readonly path: string;
}

export interface CardDef {
  /** A standing card's id; a transient card has its own. */
  readonly id: CardId | 'selection' | 'comparison' | 'file';
  /** The card's name for this file: the contents card is an Outline, Levels, Columns… */
  title(ctx: CardContext): string;
  /** A quiet note at the header's right. */
  detail?(ctx: CardContext): string;
  /** Whether the file has the thing the card shows. */
  relevant(ctx: CardContext): boolean;
  /** Fills `el`; may return what stops anything it started. */
  render(el: HTMLElement, ctx: CardContext): (() => void) | void;
}
