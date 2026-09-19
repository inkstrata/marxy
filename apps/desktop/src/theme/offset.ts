// The Linux weight offset (docs/design/05-theme.md §Weight offset, ADR-0010). WebKitGTK sets text
// lighter than macOS at reading sizes; the offset is added to every weight so the page reads at the
// weight it was designed at. Set on :root by the app, never by a theme.

export interface WebkitVersion {
  readonly major: number;
  readonly minor: number;
  readonly micro: number;
}

export type Platform = 'macos' | 'linux' | 'windows' | 'other';

/**
 * The §05 table. MARXY-22 measures real desktops and replaces the numbers. On Linux with no version
 * (the query lands with the shell-api amendment, MARXY-94) the "other" row applies.
 */
export function weightOffset(platform: Platform, version: WebkitVersion | null): number {
  if (platform !== 'linux') return 0;
  if (version === null || version.major !== 2) return 100;
  if (version.minor >= 52) return 75;
  if (version.minor >= 50) return 125;
  return 100;
}

/** The platform as the webview reports it. WebKitGTK's user agent names X11 or Wayland on Linux. */
export function platformOf(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'other';
}

/** Sets `--marxy-weight-offset` on :root and returns the value, for the `weight_offset` mark. */
export function applyWeightOffset(root: HTMLElement, platform: Platform, version: WebkitVersion | null): number {
  const offset = weightOffset(platform, version);
  root.style.setProperty('--marxy-weight-offset', String(offset));
  return offset;
}
