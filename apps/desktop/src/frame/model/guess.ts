// Where the app guessed how to read a file, or the reader chose: the pane's head says it
// once, naming the guessed part ("session at line 20 · guessed"), and the Reading card says the same places. Finding no
// reading is not a guess: a file set as written, or a Markdown page whose kind was guessed, is quiet.
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { Reason } from '@marxy/core/src/kind/detect.ts';
import type { Reading } from '@marxy/core/src/reading/index.ts';
import { PART_WORDS, namesPart, type Part, type PartReading } from '@marxy/core/src/reading/parts.ts';

/** Tiers that come from the file's text rather than its name or format. */
const FROM_TEXT = new Set([4, 5, 6]);

export interface GuessPlace {
  /** `file`, or the part's key. */
  readonly id: string;
  /** "verse", "session at line 20". */
  readonly words: string;
  /** The same without where ("session"): what a narrow head says. */
  readonly short: string;
  /** Where the part starts, in bytes; null for the whole file. */
  readonly start: number | null;
  readonly mine: boolean;
}

export interface GuessMark {
  /** What the head names: one place's words, or "3 parts". */
  readonly label: string;
  /** The label without where, for a narrow head. */
  readonly short: string;
  readonly how: 'guessed' | 'your choice';
  readonly mine: boolean;
  readonly places: readonly GuessPlace[];
}

export interface GuessInput {
  readonly detected: { readonly kind: Kind; readonly reasons: readonly Reason[] } | null;
  /** The reading Read sets the file as (`readingOf`), or null for the Markdown or code page. */
  readonly reading: Reading | null;
  /** Markdown or a plain-text name: the kind it is given is how its words are set, not how it is read. */
  readonly family: boolean;
  /** A plain-text name whose text read as Markdown, so its page is Markdown. */
  readonly markdownGuessed: boolean;
  /** The kind's name as the Reading card's select says it ("Code · Python"). */
  readonly kindName: string;
  readonly parts: readonly { readonly part: Part; readonly reading: PartReading; readonly chosen: boolean }[];
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** The whole file's place, if the app guessed how it is read or the reader chose. */
function filePlace(input: GuessInput): GuessPlace | null {
  const { detected, reading } = input;
  if (!detected) return null;
  const decisive = detected.reasons.find((r) => r.decisive) ?? detected.reasons[0];
  if (decisive?.tier === 1) return { id: 'file', words: lower(input.kindName), short: lower(input.kindName), start: null, mine: true };
  if (reading) return reading.id === 'verse' || reading.id === 'prose' ? { id: 'file', words: reading.name, short: reading.name, start: null, mine: false } : null;
  if (input.markdownGuessed) return { id: 'file', words: 'Markdown', short: 'Markdown', start: null, mine: false };
  if (!input.family && decisive && FROM_TEXT.has(decisive.tier)) return { id: 'file', words: lower(input.kindName), short: lower(input.kindName), start: null, mine: false };
  return null;
}

/** Every place the head and the Reading card say was guessed or chosen, the file first, then the parts in order. */
export function guessPlaces(input: GuessInput): GuessPlace[] {
  const out: GuessPlace[] = [];
  const file = filePlace(input);
  if (file) out.push(file);
  for (const { part, reading, chosen } of input.parts) {
    if (!namesPart(part, reading)) continue;
    const guessed = !chosen && part.from === 'text' && reading !== 'written';
    if (!chosen && !guessed) continue;
    out.push({ id: part.key, words: `${PART_WORDS[reading].short} at line ${part.firstLine}`, short: PART_WORDS[reading].short, start: part.start, mine: chosen });
  }
  return out;
}

/** Whether a part's row in the Reading card says "guessed": the same test the head uses. */
export const partGuessed = (part: Part, reading: PartReading, chosen: boolean): boolean => !chosen && part.from === 'text' && reading !== 'written';

export function guessMark(input: GuessInput): GuessMark | null {
  const places = guessPlaces(input);
  if (places.length === 0) return null;
  const mine = places.every((p) => p.mine);
  const label = places.length === 1 ? places[0]!.words : places.every((p) => p.id !== 'file') ? `${places.length} parts` : `${places.length} places`;
  return { label, short: places.length === 1 ? places[0]!.short : label, how: mine ? 'your choice' : 'guessed', mine, places };
}
