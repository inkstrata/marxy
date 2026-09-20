// Shared WebKit launch for gates and browser tests — headless by default so local precheck does
// not flash a browser window. `MARXY_BROWSER_HEADED=1` opens a real window when you want to watch.
import { webkit } from 'playwright';

/** @param {import('playwright').LaunchOptions} [overrides] */
export function launchOptions(overrides = {}) {
  const headless = process.env.MARXY_BROWSER_HEADED !== '1';
  return { headless, ...overrides };
}

/** @param {import('playwright').LaunchOptions} [overrides] */
export async function launchWebkit(overrides = {}) {
  return webkit.launch(launchOptions(overrides));
}
