// Source-editor text operations (V-01): pure functions from the editor's text and a range to a range or a splice.
export { expandSelection, lineBounds, selectBlock, selectSection, type StructureKind, type TextRange } from './select.ts';
export { compareBytes, deleteLines, duplicateLines, joinLines, lineSpan, lineSpans, sortLines, toggleQuoteLines, toggleTaskLines, type LineEdit, type TextSplice } from './lines.ts';
