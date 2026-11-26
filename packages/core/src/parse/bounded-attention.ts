// Emphasis and strikethrough with a bounded resolver.
//
// micromark resolves `*` and `_` (and GFM resolves `~`) once a span is tokenized: from every closing run it walks
// back to an opener, and every match splices the span's events array. A span of n runs costs n squared: one
// paragraph of 40,000 `a* ` took 54 s, 40,000 lines of `line *i* x` 36 s. Past `MAX_DELIMITER_RUNS` runs in one
// span (a paragraph, or the text of a link or of an emphasis), every run in it is read as the characters it is,
// which is what both resolvers make of a run they cannot match. Below the cap the resolvers run untouched.

type Event = [string, { type: string }, unknown];
type Resolver = (events: Event[], context: any) => Event[];
type Construct = { name?: string; add?: 'before' | 'after'; tokenize?: (this: any, effects: any, ok: any, nok: any) => any; resolveAll?: Resolver };

/** More delimiter runs than this in one span and none of them is resolved. Prose has a few per paragraph. */
export const MAX_DELIMITER_RUNS = 4000;

/** `resolve`, unless the span holds more than `MAX_DELIMITER_RUNS` runs of `sequence`: then they become text. */
export function capped(sequence: string, resolve: Resolver): Resolver {
  return (events, context) => {
    let runs = 0;
    for (const event of events) if (event[0] === 'enter' && event[1].type === sequence) runs++;
    if (runs <= MAX_DELIMITER_RUNS) return resolve(events, context);
    for (const event of events) if (event[1].type === sequence) event[1].type = 'data';
    return events;
  };
}

const SEQUENCE = 'attentionSequence';

/** micromark's own attention construct, found in the parser's constructs: it is no dependency of this package. */
function attentionOf(parser: { constructs: { text: Record<number, Construct | Construct[]> } }): Construct {
  const list = parser.constructs.text[42];
  const found = (Array.isArray(list) ? list : [list]).find((construct) => construct?.name === 'attention');
  if (found?.tokenize === undefined || found.resolveAll === undefined) throw new Error('parse: micromark has no attention construct');
  return found;
}

/**
 * The attention construct with its resolver capped. micromark's own is disabled by name and this one takes
 * its place after the extensions (so `_` still tries an email autolink first), tokenizing with micromark's
 * tokenizer. Spans resolved inside others (link text, emphasis) run the `insideSpan` resolvers, where
 * micromark's attention still sits: the cap goes in before it there, so a run it turns to text never reaches it.
 */
export function boundedAttention(): Record<string, unknown> {
  const construct: Construct = {
    name: 'boundedAttention',
    add: 'after',
    tokenize(effects, ok, nok) {
      return attentionOf(this.parser).tokenize!.call(this, effects, ok, nok);
    },
    resolveAll: capped(SEQUENCE, (events, context) => attentionOf(context.parser).resolveAll!(events, context)),
  };
  return {
    disable: { null: ['attention'] },
    text: { 42: construct, 95: construct },
    insideSpan: { null: [{ resolveAll: capped(SEQUENCE, (events) => events) }] },
  };
}
