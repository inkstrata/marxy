// Command palette: MRU, fuzzy path/title/heading search, pins, history (ADR-0011, ADR-0012).

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
export {
  emptySession as emptyHistory,
  recordOpen as pushOpen,
  goBack as historyBack,
  goForward as historyForward,
  OPENS_CAP as HISTORY_OPENS_CAP,
} from './history.ts';
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
  palettePhase,
  queryPalette,
  toggleListSection,
  openHit,
  mountPalette,
  hasTabBar,
  createPaletteDocument,
  PALETTE_ROW_LIMIT,
  type PaletteModel,
  type PalettePhase,
  type PaletteListSection,
  type PaletteQueryInput,
  type PaletteViewState,
} from './palette.ts';
