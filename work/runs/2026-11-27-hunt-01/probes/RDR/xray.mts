import { xrayLines } from '/Users/<user>/Dev/marxy-wt/hunt-01/apps/desktop/src/depths/xray-lines.ts';
const b = new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode('# T\r\nx\r\n')]);
console.log(JSON.stringify(xrayLines(b,0,b.length)));
const b2 = new Uint8Array([...new TextEncoder().encode('a '), 0xff, 0x0a]);
console.log(JSON.stringify(xrayLines(b2,0,b2.length)));
