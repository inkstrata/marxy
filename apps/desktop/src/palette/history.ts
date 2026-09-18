// Document opens, MRU, pins, and in-memory back/forward (design §07 History; ADR-0011).

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
