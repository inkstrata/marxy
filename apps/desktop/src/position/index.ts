// Reading position in the desktop app: DOM capture/restore and positions.json persistence.

export { currentPosition, restoreScrollToPosition } from './position.ts';
export {
  PositionPersistence,
  POSITIONS_DEBOUNCE_MS,
  type PositionPersistenceIo,
} from './persist.ts';
