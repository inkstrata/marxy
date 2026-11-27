// The spine's marks: a mark at each stretch of lines the unsaved changes add or change,
// and one at each margin note, kept current as either changes.
import { changedLines, onChangesSummary } from '../changes/state.ts';
import { notesFor, onNotes } from '../notes/store.ts';
import { spineMarks } from './spine.ts';
import { lineRanges, lineStarts, runStarts } from './spine-lines.ts';
import type { FramePane } from './types.ts';

export function followSpineJoins(pane: FramePane): () => void {
  const marks = spineMarks(pane);
  const draw = (): void => {
    const path = pane.path();
    const bytes = pane.content.store()?.snapshot().buffer.bytes ?? null;
    if (path === null || bytes === null) {
      marks.set('edit', []);
      marks.set('note', []);
      return;
    }
    const edits = runStarts(changedLines(path));
    marks.set('edit', edits.length === 0 ? [] : lineRanges(edits, lineStarts(bytes)));
    const notes = notesFor(path);
    marks.set('note', notes.length === 0 ? [] : lineRanges(notes.map((n) => n.l0), lineStarts(bytes, true)));
  };
  const mine = (path: string): void => {
    if (path === pane.path()) draw();
  };
  const offChanges = onChangesSummary(mine);
  const offNotes = onNotes(mine);
  const offDoc = pane.content.onDocumentChange(draw);
  draw();
  return () => {
    offChanges();
    offNotes();
    offDoc();
  };
}
