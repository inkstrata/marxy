// The names of the Source structure operations. A module of its own, with no CodeMirror in its imports, so
// the command table (which the app loads at start) can name them without the editor's code (MARXY-33).

/** The operations, by name: the palette's commands and the keys' registry entries are lists of these. */
export type StructureOp =
  | 'selectLine'
  | 'selectBlock'
  | 'selectSection'
  | 'expandSelection'
  | 'selectNextOccurrence'
  | 'selectAllOccurrences'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'duplicateLineUp'
  | 'duplicateLineDown'
  | 'deleteLine'
  | 'joinLines'
  | 'sortLines'
  | 'toggleTask'
  | 'toggleQuote'
  | 'toggleComment';
