// Preloaded (`--import`) by `scripts/browser-tests.mjs`: with MARXY_BROWSER_WS, `webkit.launch()` connects to the
// runner's one browser. Each file still gets its own contexts, which close when the file's connection does.
import { webkit } from 'playwright';

const endpoint = process.env.MARXY_BROWSER_WS;
if (endpoint) {
  const launch = webkit.launch.bind(webkit);
  webkit.launch = async (options) => {
    try {
      return await webkit.connect(endpoint, { timeout: 10_000 });
    } catch {
      return launch(options);
    }
  };
}
