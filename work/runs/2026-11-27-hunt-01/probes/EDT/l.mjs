export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const cases = [
    ['/demo/x.py', 'x = 1\n', '<pre><code>def foo_bar(x):\n    return x * 2  # *double*\n</code></pre>', 'def foo_bar(x):\n    return x * 2  # *double*\n'],
    ['/demo/x.json', '{}\n', '<div style="font-family:monospace"><span>{</span><br><span>&nbsp;&nbsp;"a_b": [1, 2],</span><br><span>}</span></div>', '{\n  "a_b": [1, 2],\n}'],
    ['/demo/x.csv', 'a,b\n', '<table><tr><td>1</td><td>2</td></tr></table>', '1\t2'],
    ['/demo/x.txt', 'plain\n', '<p>Hello <b>bold</b> and <a href="https://e.org">link</a></p>', 'Hello bold and link'],
  ];
  for (const [path, body, html, text] of cases) {
    await plantText(page, path, body);
    await open(page, path);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source'); await page.waitForSelector('.cm-content');
    const got = await page.evaluate(async ([html, text]) => {
      const enc = new TextEncoder();
      window.marxy.shell.setPasteboard([{ 'public.html': enc.encode(html), 'public.utf8-plain-text': enc.encode(text) }]);
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor().view; view.focus(); view.dispatch({ selection: { anchor: view.state.doc.length } });
      const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', text);
      view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 500));
      return view.state.doc.toString();
    }, [html, text]);
    console.log(path, 'pasted ->', JSON.stringify(got), '| wanted tail', JSON.stringify(text));
  }
};
