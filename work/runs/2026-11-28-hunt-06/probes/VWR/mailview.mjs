// Small valid messages through the real mail viewer: what the reader sees for each.
const NL = String.fromCharCode(13, 10);
const enc = (s) => new TextEncoder().encode(s.split('\n').join(NL));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const files = {
  '/demo/m-related.eml': enc(`From: A <a@x.org>
To: B <b@y.org>
Subject: Cid picture
Date: Sat, 28 Nov 2026 08:14:09 +0000
MIME-Version: 1.0
Content-Type: multipart/related; boundary="r"

--r
Content-Type: text/html; charset=utf-8

<p>Hello <img src="cid:pic1" alt="dot"></p>
--r
Content-Type: image/png; name="dot.png"
Content-ID: <pic1>
Content-Transfer-Encoding: base64

${png}
--r--
`),
  '/demo/m-dupes.eml': enc(`From: a@x.org
Subject: Two files, one name
Content-Type: multipart/mixed; boundary="m"

--m
Content-Type: text/plain

see attached
--m
Content-Type: text/plain; name="notes.txt"
Content-Disposition: attachment; filename="notes.txt"

first
--m
Content-Type: text/plain; name="notes.txt"
Content-Disposition: attachment; filename="notes.txt"

second
--m--
`),
  '/demo/m-cyr.eml': enc(`From: =?windows-1251?Q?=C8=E2=E0=ED?= <i@x.ru>
Subject: =?koi8-r?B?8NLJ18XU?=
Content-Type: text/plain; charset=windows-1251
Content-Transfer-Encoding: quoted-printable

=CF=F0=E8=E2=E5=F2, =EC=E8=F0
`),
  '/demo/m-flowed.eml': enc(`From: a@x.org
Subject: flowed
Content-Type: text/plain; charset=utf-8; format=flowed; delsp=yes

This is a long line that was flowed
across two lines.
> quoted
--
Sig
`),
  '/demo/m-bad-date.eml': enc(`From: a@x.org
Date: yesterday around noon
Subject: odd date

body
`),
  '/demo/m-nested-rfc822.eml': enc(`From: a@x.org
Subject: Fwd
Content-Type: message/rfc822

From: inner@x.org
Subject: Inner subject
Content-Type: text/plain

inner body
`),
};
export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const [p, b] of Object.entries(files)) {
    await plantBytes(page, p, b);
    await open(page, p, 1500);
    const r = await page.evaluate(() => {
      const v = document.querySelector('[data-marxy-viewer]');
      const t = (v ?? document.querySelector('.marxy-pane'))?.innerText ?? '';
      const imgs = v ? [...v.querySelectorAll('img')].map((i) => (i.getAttribute('src') ?? '').slice(0, 30)) : [];
      const frames = v ? [...v.querySelectorAll('iframe')].length : 0;
      return (v ? 'VIEWER ' + v.getAttribute('data-marxy-viewer') + ': ' : 'PANE: ') + t.replace(/\s+/g, ' ').slice(0, 520) + ' | imgs=' + JSON.stringify(imgs) + ' iframes=' + frames;
    });
    console.log('### ' + p + '\n' + r);
  }
};
