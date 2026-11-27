// The one button: its look is `.marxy-btn` in the theme, which carries its own reset so it is the same in any container.
// These keep the look-alikes from coming back.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const frameCss = readFileSync(join(root, 'packages/theme/src/frame.css'), 'utf8');
const leftCss = readFileSync(join(root, 'packages/theme/src/left.css'), 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|css)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

test('.marxy-btn resets the browser button itself, not through a container', () => {
  const rule = /\n\.marxy-btn(?:, \.marxy-linkish)? \{([^}]*)\}/.exec(frameCss)?.[1] ?? '';
  for (const part of ['appearance: none', 'border: 0', 'background: transparent', 'cursor: pointer', 'font:']) assert.ok(rule.includes(part), `.marxy-btn sets ${part}`);
  assert.match(frameCss, /\.marxy-btn:focus-visible[^{]*\{ outline: 2px solid var\(--marxy-color-accent\)/, 'its focus ring is its own');
});

test('the retired look-alike buttons have no style and no use', () => {
  assert.doesNotMatch(frameCss, /\.marxy-(settings-button|apppage-close)\b/);
  assert.doesNotMatch(frameCss, /\.marxy-export-close\s*\{/);
  assert.doesNotMatch(leftCss, /\.marxy-l-btns button/);
  for (const file of sources(join(root, 'apps/desktop/src'))) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /['"]marxy-settings-button['"]|marxy-apppage-close/, `${file} uses a retired button class`);
  }
});
