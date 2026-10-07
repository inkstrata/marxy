// Palette commands to revoke per-document trust grants (docs/design/13-trust.md §Revoking).

import type { Command } from './registry.ts';
import { notify } from '../notices/index.ts';
import { trustWriteFailedText } from '../notices/trust-copy.ts';

/** A revoke that cannot be saved is said aloud; it never becomes an unhandled rejection. */
async function runRevoke(revoke: (() => Promise<void>) | null): Promise<void> {
  try {
    await revoke?.();
  } catch (err) {
    notify({ kind: 'info', text: trustWriteFailedText(err) });
  }
}

let grantsForPath: (() => { html: boolean } | null) | null = null;
let revokeHtml: (() => Promise<void>) | null = null;

export function wireTrustRevokeCommands(opts: {
  grantsForPath(): { html: boolean } | null;
  revokeHtml(): Promise<void>;
}): void {
  grantsForPath = opts.grantsForPath;
  revokeHtml = opts.revokeHtml;
}

export function trustRevokeCommands(): readonly Command[] {
  return [
    {
      id: 'trust.revoke-html',
      title: 'Stop showing HTML for this document',
      group: 'document',
      when() {
        const g = grantsForPath?.();
        return g?.html === true;
      },
      run() {
        return runRevoke(revokeHtml);
      },
    },
  ];
}
