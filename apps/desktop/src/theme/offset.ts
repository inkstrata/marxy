// The Linux weight offset (docs/design/05-theme.md §Weight offset, ADR-0010). WebKitGTK sets text
// lighter than macOS at reading sizes; the offset is added to every weight so the page reads at the
// weight it was designed at. Set on :root by the app, never by a theme.

export type Platform = 'macos' | 'linux' | 'windows' | 'other';

/**
 * The Linux weight offset. Unmeasured: it was chosen in D-A9 and has not been checked on a Linux
 * desktop. It is to be measured when one exists (ADR-0046 makes Linux parity a release criterion,
 * not a pull-request gate). Config `[linux] weight_offset` overrides it.
 */
export const LINUX_WEIGHT_OFFSET = 100;

/** `0` off Linux; on Linux the configured override, else {@link LINUX_WEIGHT_OFFSET}. */
export function weightOffset(platform: Platform, configured: number | null): number {
  if (platform !== 'linux') return 0;
  return configured ?? LINUX_WEIGHT_OFFSET;
}

/** The platform as the webview reports it. WebKitGTK's user agent names X11 or Wayland on Linux. */
export function platformOf(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'other';
}

/** Sets `--marxy-weight-offset` on :root and returns the value, for the `weight_offset` mark. */
export function applyWeightOffset(root: HTMLElement, platform: Platform, configured: number | null): number {
  const offset = weightOffset(platform, configured);
  root.style.setProperty('--marxy-weight-offset', String(offset));
  return offset;
}
