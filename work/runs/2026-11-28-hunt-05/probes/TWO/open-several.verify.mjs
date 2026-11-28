import { holdSystemOpens } from '../../../../../apps/desktop/src/startup/system-opens.ts';
const opened = [];
const s = holdSystemOpens((f) => opened.push(f));
s.release();
s.take(['/a.md', '/b.md', '/c.md']);
console.log('one payload of 3 paths, opened:', JSON.stringify(opened));
const o2 = []; const s2 = holdSystemOpens((f) => o2.push(f));
s2.take(['/a.md', '/b.md']); s2.take(['/c.md']); s2.release();
console.log('held before launch, 2 payloads (2 + 1 paths), opened:', JSON.stringify(o2));
