// Palette commands to revoke per-document trust grants (docs/design/13-trust.md §Revoking).

import type { Command } from './registry.ts';

let grantsForPath: (() => { html: boolean; imageHosts: readonly string[] } | null) | null = null;
let revokeHtml: (() => Promise<void>) | null = null;
let revokeImages: (() => Promise<void>) | null = null;

export function wireTrustRevokeCommands(opts: {
  grantsForPath(): { html: boolean; imageHosts: readonly string[] } | null;
  revokeHtml(): Promise<void>;
  revokeImages(): Promise<void>;
}): void {
  grantsForPath = opts.grantsForPath;
  revokeHtml = opts.revokeHtml;
  revokeImages = opts.revokeImages;
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
        return revokeHtml?.() ?? Promise.resolve();
      },
    },
    {
      id: 'trust.revoke-images',
      title: 'Stop loading images for this document',
      group: 'document',
      when() {
        const g = grantsForPath?.();
        return (g?.imageHosts.length ?? 0) > 0;
      },
      run() {
        return revokeImages?.() ?? Promise.resolve();
      },
    },
  ];
}
