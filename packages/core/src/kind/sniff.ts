// A name no row knows, read from its text: XML or JSON only, and only when the text leaves no doubt. Never asked of a name the
// registry knows, so an extension always wins over what the text looks like. Pure.
import { parseJson, parseXml } from '../reading/tree.ts';

/**
 * Past this a file is not parsed here to be sure: the reading parses it on open anyway, and parsing a megabyte twice is
 * felt. Only an XML declaration, or JSON whose first and last bytes frame it, decides.
 */
export const SNIFF_MAX_BYTES = 256 * 1024;
/** The most a JSON with no declaration to lean on can be and still be sniffed (the size a data tree is made for). */
export const SNIFF_LIMIT_BYTES = 1536 * 1024;
/** How much of a larger file's start is looked at for an XML declaration. */
export const SNIFF_HEAD_BYTES = 16 * 1024;

const DECLARATION = /^<\?xml\s+version\s*=\s*["']/;

/**
 * `xml` when the text opens with an XML declaration, or is one element that closes (a document with a root that is not
 * HTML's); `json` when it opens with `{` or `[` and parses as JSON from end to end. Anything less certain, an INI file or a
 * script or a page of HTML, is null and stays text.
 */
export function sniffFormat(bytes: Uint8Array): 'xml' | 'json' | null {
  if (bytes.length === 0) return null;
  const whole = bytes.length <= SNIFF_MAX_BYTES;
  const part = whole ? bytes : bytes.subarray(0, SNIFF_HEAD_BYTES);
  const from = part[0] === 0xef && part[1] === 0xbb && part[2] === 0xbf ? 3 : 0;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: whole }).decode(part.subarray(from));
  } catch {
    return null;
  }
  if (text.includes('\0')) return null;
  const first = text.trimStart();
  if (first.startsWith('<')) {
    if (DECLARATION.test(first)) return 'xml';
    if (!whole) return null;
    try {
      const root = parseXml(text);
      return root.key !== null && root.key.toLowerCase() === 'html' ? null : 'xml';
    } catch {
      return null;
    }
  }
  if (first.startsWith('{') || first.startsWith('[')) {
    if (!whole) return bytes.length <= SNIFF_LIMIT_BYTES && framedJson(bytes, first) ? 'json' : null;
    try {
      parseJson(text);
      return 'json';
    } catch {
      return null;
    }
  }
  return null;
}

// A large file's start and end must frame a value: `{` or `[`, then a key, value or comment, and the matching close last.
// Not proof; text that is not JSON after all reads as the "cannot draw" page, as written.
function framedJson(bytes: Uint8Array, first: string): boolean {
  let end = bytes.length - 1;
  while (end >= 0 && (bytes[end] === 0x20 || bytes[end] === 0x0a || bytes[end] === 0x0d || bytes[end] === 0x09)) end--;
  const close = first[0] === '{' ? 0x7d : 0x5d;
  return bytes[end] === close && /^[{[]\s*["{[}\]\d/-]/.test(first.slice(0, 64));
}
