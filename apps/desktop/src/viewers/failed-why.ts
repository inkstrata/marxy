// Why a file could not be opened, in plain words, from the shell's error: its code, else the phrases of its message.

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, '');
const codeOf = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined);

/** Why `path` could not be opened, in plain words, from the shell's error (its code, else its message's phrases). */
export function failedWhy(path: string, e: unknown): string {
  const message = messageOf(e);
  const code = codeOf(e);
  // fs.rs's phrases (shell/tauri.ts reads the same ones): "too large to open (N MB; the most Marxy opens is M MB)".
  const large = /too large to open \((\d[\d.,]*) MB; the most Marxy opens is (\d[\d.,]*) MB\)/.exec(message);
  if (large) return `At ${large[1]} MB it is larger than Marxy opens as text (${large[2]} MB).`;
  if (/not a regular file/.test(message)) return 'It is not a file: a folder, a pipe or a device cannot be opened.';
  if (code === 'not-found' || /no such file|not found|os error 2\b|cannot find the (file|path)|ENOENT/i.test(message))
    return 'Nothing is at this path now. It may have been moved, renamed or deleted, or its drive is not there.';
  // The shell's scope: an open that did not tell it first (a bug of Marxy's, not the reader's), said plainly.
  if (code === 'outside') return 'Marxy reads only the files you open and the folders you choose: open it from the Line or the file picker.';
  if (code === 'permission' || /permission denied|access is denied|os error (5|13)\b|EACCES|EPERM/i.test(message))
    return 'The system did not let Marxy read it.';
  const said = message.startsWith(`${path}: `) ? message.slice(path.length + 2) : message;
  return `The system said: ${said}`;
}
