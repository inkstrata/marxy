// Whether a file's head is a mail message's: read from the bytes when the name says nothing. Light on purpose: the
// open path asks it of an entry held in memory. Pure.

/** Whether `bytes` open like a message: a run of header lines that names a sender and something only mail carries. */
export function looksLikeMessage(head: Uint8Array): boolean {
  let text = '';
  for (const b of head.subarray(0, 8192)) text += String.fromCharCode(b);
  const block = text.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const lines = block.split(/\r?\n/);
  if (lines.length < 3) return false;
  const names = new Set<string>();
  for (const line of lines) {
    if (/^[ \t]/.test(line)) continue;
    const m = /^([\x21-\x39\x3b-\x7e]+):/.exec(line);
    if (!m) return false;
    names.add(m[1]!.toLowerCase());
  }
  const mailOnly = ['received', 'return-path', 'message-id', 'mime-version', 'subject', 'date', 'to', 'delivered-to'].filter((n) => names.has(n)).length;
  return names.has('from') && mailOnly >= 2;
}
