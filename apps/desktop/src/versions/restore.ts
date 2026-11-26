// Restore an earlier version: the kept copy's bytes staged over the file as one change, one undo
// step, written only by Save. From the Versions panel and from a comparison's card alike.
import { textOfFileBytes, type EncodingShell } from '../document/encoding.ts';
import type { DocumentStore } from '../document/store.ts';
import { chordText } from '../frame/branch-info.ts';
import { notify } from '../notices/index.ts';

const two = (n: number): string => String(n).padStart(2, '0');

/** The local time of `time` as `14.32`: the hour and minute a version was kept. */
export function hourMinute(time: number): string {
  const d = new Date(time);
  return `${two(d.getHours())}.${two(d.getMinutes())}`;
}

/**
 * Stages `copy`, the file's bytes kept at `time`, over `store`'s file: 'same' when it is what the store holds now (nothing is
 * staged), 'moved' when the file changed while the copy was read. The copy is read as the open file is (another encoding's
 * bytes become the store's text first), so a save writes the file's bytes back.
 */
export async function restoreCopy(store: DocumentStore, copy: Uint8Array, time: number, shell: EncodingShell): Promise<'staged' | 'same' | 'moved'> {
  const bytes = await textOfFileBytes(shell, store.snapshot().path, copy);
  const snap = store.snapshot();
  if (snap.buffer.bytes.length === bytes.length && snap.buffer.bytes.every((b, i) => b === bytes[i])) return 'same';
  const applied = await store.apply({ range: { file: snap.path, start: 0, end: snap.buffer.bytes.length }, replacement: bytes, label: `Restore the copy of ${hourMinute(time)}`, baseVersion: snap.version });
  return applied ? 'staged' : 'moved';
}

/** `restoreCopy`, and says what came of it. */
export async function stageCopy(store: DocumentStore, copy: Uint8Array, time: number, shell: EncodingShell): Promise<void> {
  const outcome = await restoreCopy(store, copy, time, shell);
  if (outcome === 'same') notify({ kind: 'info', text: 'Nothing to restore: that copy is what the file holds now', fades: true });
  else if (outcome === 'staged') notify({ kind: 'done', text: `The copy of ${hourMinute(time)} is staged over the file · ${chordText('Mod+S')} writes it; u undoes it` });
  else notify({ kind: 'refused', text: 'Not restored: the file moved on while the copy was read · nothing changed' });
}
