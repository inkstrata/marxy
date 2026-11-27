// "Always open this folder as" writes config.toml through the same queue as the Settings page: started
// at the same moment as a Settings change, both survive. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { fileText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = { '/r/notes/a.md': '# A\n\nThe A file.\n' };

/** Makes every read and write of config.toml take a moment, so two read-modify-writes that are not queued overlap. */
const slowConfig = (page) =>
  page.evaluate(() => {
    const shell = window.__marxyHandle.shell;
    const later = () => new Promise((r) => setTimeout(r, 25));
    const read = shell.readFile.bind(shell);
    const write = shell.writeFileAtomic.bind(shell);
    shell.readFile = async (path) => {
      const bytes = await read(path);
      if (path === '/config') await later();
      return bytes;
    };
    shell.writeFileAtomic = async (path, bytes) => {
      if (path === '/config') await later();
      return write(path, bytes);
    };
  });

test('a Settings key and "Always open this folder as", started together, both land in config.toml', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/a.md'], config: 'size = 18\n' }, async (page) => {
    await slowConfig(page);
    await page.evaluate(async () => {
      const { kindCommands } = await import('/src/commands/kind.ts');
      const { writeReaderKey } = await import('/src/theme/reader-config.ts');
      const command = kindCommands().find((c) => c.id === 'kind.folder.code');
      await Promise.all([writeReaderKey(window.__marxyHandle.shell, 'variant', '"light"'), command.run({ closePalette() {} })]);
    });
    const text = await fileText(page, '/config');
    assert.match(text, /^size = 18$/m, text);
    assert.match(text, /^variant = "light"$/m, text);
    assert.match(text, /\[\[kind\]\]/, text);
    assert.match(text, /is = 'code'/, text);
  });
});
