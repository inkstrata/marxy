// Runs the tree-depth harness in WebKit and Chromium (MARXY-84). Invoked from the no-network gate
// via `gate-assertions.test.ts`, so a PR cannot delete the check without the gate failing.
import { chromium, webkit } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyWriterMutation,
  casesToRun,
  depthViolations,
  snapshotsFromHtml,
  WRITER_CLOSE_LATE_MUTATION,
} from './gate-tree-depth.ts';
import { sanitizeHtml } from '../src/sanitize/sanitize-html.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const mutation = process.env.MARXY_84_MUTATION;
const failures = [];
const enginesRun = new Set();

const pageHtml = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="host">${body}</div></body></html>`;

const collectLive = async (tab, html) =>
  tab.evaluate((fragment) => {
    const host = document.getElementById('host');
    if (host === null) return null;
    while (host.firstChild !== null) host.removeChild(host.firstChild);
    const parsed = new DOMParser().parseFromString(fragment, 'text/html');
    for (const node of parsed.body.childNodes) {
      host.appendChild(document.importNode(node, true));
    }
    const out = [];
    for (const element of host.querySelectorAll('*')) {
      const ancestors = [];
      for (let parent = element.parentElement; parent !== null && parent !== host; parent = parent.parentElement) {
        ancestors.push(parent.tagName.toLowerCase());
      }
      out.push({ tag: element.tagName.toLowerCase(), ancestors });
    }
    return out;
  }, html);

for (const engine of [webkit, chromium]) {
  const name = engine.name();
  enginesRun.add(name);
  const browser = await engine.launch();
  const tab = await browser.newPage();
  await tab.setContent(pageHtml(''));
  for (const treeCase of casesToRun()) {
    const { html } = sanitizeHtml(treeCase.html);
    const inserted = applyWriterMutation(html, mutation);
    const written = snapshotsFromHtml(mutation ? html : inserted);
    const live = await collectLive(tab, inserted);
    if (live === null) {
      failures.push(`${name} ${treeCase.id}: host missing`);
      continue;
    }
    for (const detail of depthViolations(written, live)) {
      const prefix = mutation === WRITER_CLOSE_LATE_MUTATION ? `mutation ${WRITER_CLOSE_LATE_MUTATION}: ` : '';
      failures.push(`${name} ${treeCase.id}: ${prefix}${detail}`);
    }
  }
  await browser.close();
}

if (enginesRun.size !== 2) {
  failures.push(`tree-depth gate ran ${enginesRun.size} engine(s), expected webkit and chromium`);
}

if (failures.length > 0) {
  console.error(`tree-depth gate failed:\n - ${failures.join('\n - ')}`);
  console.error(`    fix: restore the writer stack / table rules in packages/core/src/sanitize/sanitize-html.ts, or revert a change to packages/core/scripts/tree-depth-cases.ts`);
  process.exit(1);
}

console.log(
  `tree-depth gate ok: ${casesToRun().length} shapes × ${enginesRun.size} engines, 0 live tree deeper than written (except implied table section)${mutation ? `, mutation ${mutation} exercised` : ''}`,
);

// When invoked directly, also run the fast unit half so one command covers both.
if (process.argv[1]?.endsWith('gate-tree-depth.mjs')) {
  const unit = spawnSync(
    process.execPath,
    ['--test', '--experimental-strip-types', 'packages/core/scripts/gate-tree-depth.test.ts'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  process.stdout.write(unit.stdout ?? '');
  if (unit.status !== 0) {
    process.stderr.write(unit.stderr ?? '');
    console.error('tree-depth gate failed: packages/core/scripts/gate-tree-depth.test.ts did not pass');
    process.exit(1);
  }
}
