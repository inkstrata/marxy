import { placeLinks } from '/D:/Dev/marxy-wt/hunt-06/apps/desktop/src/left/doc-model.ts';
const files = new Set(['/d/a.md', '/d/b#1.md', '/d/c?.md', '/d/e é.md']);
for (const url of ['b%231.md', 'c%3F.md', 'e%20%C3%A9.md', 'b#1.md'])
  console.log(url, JSON.stringify(placeLinks({ docPath: '/d/a.md', links: [{ url, line: 1 }], written: [], has: (p) => files.has(p), roots: ['/d'] })[0]));
