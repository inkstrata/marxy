import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanCss, cleanPage, hostsOf, leftOutLine, type PageLeftOut } from './clean.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const page = readFileSync(new URL('../../../../fixtures/demo/site/harbour-notice.html', import.meta.url), 'utf8');

test('the page: exactly what was left out, by host', () => {
  const c = cleanPage(page);
  assert.equal(c.title, 'Harbour Notice 41/2026 - Entrance channel restrictions');
  assert.equal(c.left.scripts, 2);
  assert.equal(c.left.handlers, 1);
  assert.deepEqual(c.left.stylesheets, ['https://cdn.harbour.example/site.css']);
  assert.deepEqual(c.left.images.map((i) => i.url), ['https://cdn.harbour.example/img/mouth.jpg']);
  assert.deepEqual(c.left.frames, ['https://maps.harbour.example/embed']);
  assert.equal(c.left.forms, 1);
  assert.equal(c.left.other, 0);
  assert.deepEqual(hostsOf(c.left), ['cdn.harbour.example', 'maps.harbour.example']);
  assert.equal(
    leftOutLine(c.left),
    '2 scripts not run, 1 event handler left out; 1 stylesheet, 1 image, 1 frame from the network not loaded (cdn.harbour.example, maps.harbour.example); 1 form shown, never sent',
  );
});

test('the page as drawn: its own styles kept apart, a form that cannot send, links that cannot be followed', () => {
  const c = cleanPage(page);
  assert.equal(c.css.length, 1);
  assert.match(c.css[0]!, /\.banner \{ background: #0f4c5c/);
  assert.doesNotMatch(c.html, /<script|<link|<iframe|<style|onclick|\saction=|\shref=|\ssrc="https?:/i);
  assert.match(c.html, /A frame from maps\.harbour\.example, not loaded\./);
  assert.match(c.html, /<input type="email" name="email" placeholder="you@example\.test" disabled \/>/);
  assert.match(c.html, /<button type="button" disabled>Subscribe<\/button>/);
  assert.match(c.html, /<img alt="channel marker" width="16" height="16" src="data:image\/png;base64,/, 'an image carried in the page is drawn');
  assert.deepEqual(c.links.map((l) => [l.text, l.href]), [
    ['tide tables', 'https://harbour.example/tides'],
    ['2026 notice archive', 'notices/2026.html'],
    ['the Harbour Office', 'mailto:office@harbour.example'],
  ]);
  assert.equal((c.html.match(/data-marxy-href=/g) ?? []).length, 3);
});

test('a style block keeps its child combinators, quoted values and attribute selectors as written', () => {
  const c = cleanPage('<html><head><style>ul > li[data-k="a"]::before { content: "<>" }</style></head><body><ul><li>x</li></ul></body></html>');
  assert.equal(c.css.length, 1);
  assert.match(c.css[0]!, /ul > li\[data-k="a"\]::before \{ content: "<>" \}/);
});

test('a style that would fetch is cut, and counted: @import, url() to the network, script in old engines', () => {
  const left: PageLeftOut = { scripts: 0, handlers: 0, scriptLinks: 0, stylesheets: [], images: [], frames: [], forms: 0, other: 0 };
  const out = cleanCss('@import url("https://a.example/x.css"); @import "//b.example/y.css";\nb { background: url(https://c.example/p.gif) } i { background: url(data:image/png;base64,AA) } u { width: expression(alert(1)) }', left);
  assert.doesNotMatch(out, /@import|https:|expression\(/);
  assert.match(out, /url\(data:image\/png;base64,AA\)/);
  assert.deepEqual(left.stylesheets, ['https://a.example/x.css', '//b.example/y.css']);
  assert.deepEqual(left.images.map((i) => i.host), ['c.example']);
});

test('hostile markup: nothing that runs, nothing that fetches, whatever the spelling', () => {
  const c = cleanPage(
    [
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">go</a>',
      '<a href="jav&#x09;ascript:alert(1)">tab</a>',
      '<svg><script>alert(1)</script></svg>',
      '<div style="background:u&#114;l(https://e.example/t.gif)">x</div>',
      '<meta http-equiv="refresh" content="0;url=https://e.example">',
      '<base href="https://e.example/">',
      '<img srcset="https://e.example/a.png 2x">',
      '<video src="https://e.example/v.mp4"></video>',
      '<table background="https://e.example/bg.png"><tr><td>t</td></tr></table>',
      '<img src="http://e.example/plain.gif" width="1" height="1">',
      '<style>p{color:red}</style><b title="</style><script>alert(2)</script>">t</b>',
      '<object data="https://e.example/o.swf"><p>fallback</p></object>',
      '<form action="https://e.example/post"><input type="image" src="https://e.example/i.png"><input type="submit"></form>',
    ].join('\n'),
  );
  assert.doesNotMatch(c.html, /<script|\son[a-z]+=|javascript:|<meta|<base|srcset|<video|https?:\/\/e\.example\/(?:t\.gif|bg\.png|i\.png|a\.png|plain\.gif|o\.swf|post)"/i);
  assert.doesNotMatch(c.css.join(''), /<script/);
  assert.ok(c.left.handlers >= 1);
  assert.ok(c.left.scriptLinks >= 1);
  assert.deepEqual(hostsOf(c.left), ['e.example']);
  assert.equal(c.left.forms, 1);
  assert.match(c.html, /<input type="submit" disabled \/>/);
});

test('the title is the first one that closes, its tags and spaces gone, as before', () => {
  const cases: [string, string][] = [
    ['<html><head><title>Plain</title></head></html>', 'Plain'],
    ['<TITLE lang="en">Upper &amp; case</TITLE >', 'Upper & case'],
    ['<title>\n  Two\n  lines </title>', 'Two lines'],
    ['<title>One</title><title>Two</title>', 'One'],
    ['<title>open<title>inner</title>', 'openinner'],
    ['<titles>not this</titles><title>this</title>', 'this'],
    ['<title>no close', ''],
    ['<title', ''],
    ['<title><b>bold</b> and <i>not closed</title>', 'bold and not closed'],
    ['<title>a < b</title>', 'a < b'],
    ['<p>no title</p>', ''],
  ];
  for (const [html, title] of cases) assert.equal(cleanPage(html).title, title, html);
});

test('a page of 50,000 unclosed titles, or a title of 200,000 `<`, is read in a bounded time', () => {
  for (const html of ['<title>'.repeat(50_000), `<title>${'<'.repeat(200_000)}</title>`, `<title x="${'<title '.repeat(30_000)}`]) {
    const t = cpuNow();
    cleanPage(html);
    const took = cpuNow() - t;
    assert.ok(took < 1000, `${html.slice(0, 20)}: ${Math.round(took)} ms`);
  }
});