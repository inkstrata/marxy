// The words of *Fork this file* (W-14), in the one template (X-21 ruling 10): what happened · what is unchanged · what to do.
// An outcome says what was written and where; a refusal or failure says nothing was written and the original is as it was. Nothing
// here claims a write that did not happen. (No *Reveal in Finder*: the shell cannot reveal a file yet, and that is a privileged
// capability of its own.)
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { said, type Said } from './config-copy.ts';

const reason = (e: unknown): string => {
  const text = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return text.replace(/\.$/, '');
};

export const FORK_SAYS = {
  /** The fork is written. `taken` is the names before it that already existed and were left exactly as they were. */
  written: (original: string, fork: string, taken: readonly string[]): Said => ({
    kind: 'done',
    text: said(
      `Forked ${basename(original)} as ${basename(fork)} in ${dirname(fork)}`,
      taken.length === 0
        ? `${basename(original)} is unchanged`
        : `${basename(original)} is unchanged, and ${taken.map(basename).join(', ')} ${taken.length === 1 ? 'was' : 'were'} already there and left as ${taken.length === 1 ? 'it was' : 'they were'}`,
    ),
  }),
  failed: (original: string, e: unknown): Said => ({
    kind: 'error',
    text: said(
      `Could not write the fork of ${basename(original)}: ${reason(e)}`,
      `nothing was written and ${basename(original)} is unchanged`,
      'Check that the folder can be written to, then try again.',
    ),
  }),
} as const;
