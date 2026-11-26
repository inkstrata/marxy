// A certificate's facts for the file card: read from the file's own bytes by core, shown as its own claim. Nothing here
// checks a chain or a signature, asks a CA, or shows a private key's material: a key is only said to be there.
import { CERT_READ_MAX, certKicker, certRows, readCertificates } from '@marxy/core/src/viewer/cert.ts';
import type { AppShell } from '../app-types.ts';
import type { CardAbout } from './card.ts';
import type { ViewedFile } from './file.ts';

/**
 * What the certificate file says, for the card; why the card cannot show it; or `plain` when its bytes are neither PEM
 * nor DER, which is the plain file card. `text` is the store's bytes when the file is text (a PEM).
 */
export async function openCertFor(
  shell: AppShell,
  file: ViewedFile,
  text?: () => Uint8Array,
): Promise<{ readonly about: CardAbout } | { readonly why: { readonly kicker: string; readonly line: string } } | { readonly plain: true }> {
  let bytes: Uint8Array;
  try {
    bytes = text ? text() : await shell.readRange(file.path, 0, Math.min(file.size, CERT_READ_MAX));
  } catch {
    bytes = file.head;
  }
  const read = readCertificates(bytes.length > CERT_READ_MAX ? bytes.subarray(0, CERT_READ_MAX) : bytes, text ? bytes.length : file.size);
  if (!read.ok) return read.notCert ? { plain: true } : { why: { kicker: 'A certificate the app cannot read', line: read.reason } };
  const kicker = certKicker(read.file);
  return {
    about: {
      kicker,
      rows: certRows(read.file, Date.now()),
      note: 'The app reads it and changes nothing. It shows what the certificate says of itself and never checks it with anyone: no authority, no revocation list.',
      shownAs: `${kicker.replace(/^A /, 'a ')} \u00b7 a file card`,
      // A PEM's text is Source, so no hex beside the card; a file with a key draws none of its bytes on its own.
      noHex: !!text,
      hideBytes: read.file.holdsKey,
      reasons: read.file.holdsKey ? ['It holds a private key, which the app does not show: its first bytes are left out here.'] : undefined,
    },
  };
}
