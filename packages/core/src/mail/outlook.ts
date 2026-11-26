// An Outlook message (`.msg`) as the shell gives it to the page: the message it would be as it travels, read by the
// one MIME parser `.eml` goes through, and the facts the mail page says beside it. The compound file itself is read in
// Rust (src-tauri/src/outlook); this is the frame it answers with. Pure.

/** What the shell says of an Outlook message beside the message it reads as. */
export interface OutlookFacts {
  /** `IPM.Note`, `IPM.Appointment`, … */
  readonly class: string;
  /** Where the body came from: the HTML Outlook kept, HTML its RTF wraps, its plain text, text its RTF wraps, or none. */
  readonly body: 'html' | 'rtf-html' | 'text' | 'rtf-text' | 'none';
  readonly codePage: number | null;
  /** When it arrived, written as a mail date. */
  readonly received: string | null;
  /** Whether its headers are the ones it travelled with, or made from its properties. */
  readonly transport: boolean;
  readonly recipients: number;
  readonly attachments: number;
  /** What a cap or a damaged part left out, a sentence each. */
  readonly notes: readonly string[];
}

export interface OutlookMail {
  readonly facts: OutlookFacts;
  /** The message as it would travel (RFC 5322, MIME). */
  readonly mime: Uint8Array;
}

/** The shell's answer: the facts' JSON length (u32, little-endian), the facts, then the message. */
export function readOutlookFrame(body: Uint8Array): OutlookMail {
  if (body.length < 4) throw new Error('The shell gave no message.');
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
  if (4 + n > body.length) throw new Error('The shell gave no message.');
  const facts = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + n))) as OutlookFacts;
  return { facts, mime: body.slice(4 + n) };
}

/** The sentence the Reading card says of where the body came from. */
export function outlookBodyWords(f: OutlookFacts): string {
  switch (f.body) {
    case 'html':
      return 'Its body is the HTML Outlook kept with it.';
    case 'rtf-html':
      return 'Its body is the HTML Outlook wrapped in its compressed RTF, taken back out.';
    case 'rtf-text':
      return 'Its body is the plain text Outlook wrapped in its compressed RTF, taken back out.';
    case 'text':
      return 'Its body is its plain text; any RTF it holds is not read here.';
    default:
      return 'It holds no body.';
  }
}
