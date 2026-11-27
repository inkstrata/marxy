// Each character's role in Source and in Read, as the two modes build them, for the parity and grammar tests.
// Source: the worker's session read piece by piece, each piece laid on the editor state as Source's colour lays it.
// Read: the token lines the highlight worker sends for a block, whose roles Read's spans carry (`marxy-tok-<role>`).
import { EditorState } from '@codemirror/state';
import { hasGrammarRuns, highlight } from '@marxy/core/src/highlight/grammar.ts';
import { RunSession } from '@marxy/core/src/highlight/session.ts';
import { pieceEffect, runMarks } from '../../src/source/colour.ts';

const TOK = 'marxy-tok-';

/** Each character's role from a set of marks over a doc of `length`. */
export function rolesOfMarks(set, length) {
  const roles = new Array(length).fill(null);
  set.between(0, length, (from, to, deco) => {
    const role = String(deco.spec.class ?? '').startsWith(TOK) ? deco.spec.class.slice(TOK.length) : null;
    for (let i = from; i < to; i++) roles[i] = role;
  });
  return roles;
}

/** The editor state Source holds for `doc` in `lang` once every piece has arrived. */
export async function sourceState(lang, doc, extensions = []) {
  let state = EditorState.create({ doc, extensions: [runMarks, ...extensions] });
  // As `codeColour`: Read's own readings (a log, a session) have no grammar runs, so Source lays none.
  if (!hasGrammarRuns(lang)) return state;
  const session = new RunSession(lang, state.doc.toString());
  while (!session.done) {
    const piece = await session.next();
    if (piece === null) break;
    if (piece === 'stale') continue;
    state = state.update({ effects: pieceEffect(piece, state.doc.length) }).state;
  }
  return state;
}

/** Each character of `doc` (lines joined by `\n`) and its role in Source. */
export async function sourceRoles(lang, doc) {
  const state = await sourceState(lang, doc);
  return rolesOfMarks(state.field(runMarks), state.doc.length);
}

/** Each character of `doc` and its role in Read. */
export async function readRoles(lang, doc) {
  const roles = new Array(doc.length).fill(null);
  const lines = await highlight(doc, lang);
  let at = 0;
  for (const line of lines ?? []) {
    for (const token of line) {
      for (let i = 0; i < token.text.length; i++) roles[at + i] = token.scope ?? null;
      at += token.text.length;
    }
    at += 1;
  }
  return roles;
}
