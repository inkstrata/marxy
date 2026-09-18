// Command palette: MRU, fuzzy path/title/heading search, pins, history (ADR-0011, ADR-0012).

export {
  emptySession,
  rememberRoot,
  recordOpen,
  togglePin,
  goBack,
  goForward,
  emptyQueryPaths,
  type PaletteSession,
} from './session.ts';
export { historyDirection, type HistoryDirection, type PaletteKey } from './keys.ts';
export {
  prepareIndex,
  searchPrepared,
  paletteResults,
  jumpForHit,
  fuzzyScore,
  type PreparedIndex,
} from './search.ts';
export {
  createPaletteDocument,
  mountPalette,
  hasTabBar,
  type PaletteDocument,
  type PaletteNode,
  type PaletteView,
  type PaletteViewState,
} from './view.ts';
