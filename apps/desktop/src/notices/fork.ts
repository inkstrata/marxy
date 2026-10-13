// The words of *Fork this file* (W-14), in the one template (X-21 ruling 10): what happened · what is unchanged · what to do.
// An outcome says what was written and where; a refusal or failure says nothing was written and the original is as it was. Nothing
// here claims a write that did not happen. (No *Reveal in Finder*: the shell cannot reveal a file yet, and that is a privileged
// capability of its own.)
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { said, type Said } from './config-copy.ts';

/**
 * Why a write failed, in the reader's words. The shell's own text is not shown: it names a hidden temporary file beside the
 * target and an operating-system number, which say nothing the reader can use.
 */
export function whyForkFailed(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  const text = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (code === 'exhausted') return 'every fork name beside it is taken';
  if (/name too long|os error 63|ENAMETOOLONG/i.test(text)) return 'the name is too long for this folder';
  if (code === 'permission' || /permission denied|read-only|os error (1|13|30)\b/i.test(text)) return "the folder can't be written to";
  if (/no space left|disk full|quota|file too large|os error (28|27|69)\b/i.test(text)) return 'the disk is full';
  if (code === 'not-found') return 'the folder is no longer there';
  return 'the write was refused';
}

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
  /** `target` is the file that was to be written, when a name had been chosen. */
  failed: (original: string, e: unknown, target?: string): Said => ({
    kind: 'error',
    text: said(
      `Not forked: ${target === undefined ? `a fork of ${basename(original)}` : basename(target)} could not be written, because ${whyForkFailed(e)}`,
      `nothing was written and ${basename(original)} is unchanged`,
      'Check the folder, then try again.',
    ),
  }),
} as const;
