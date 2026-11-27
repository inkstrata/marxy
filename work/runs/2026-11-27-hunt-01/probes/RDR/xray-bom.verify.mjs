// BOM in a leading TextDecoder: default strips it; ignoreBOM keeps it
const b = new Uint8Array([0xef,0xbb,0xbf,0x23,0x20,0x54]);
console.log(JSON.stringify(new TextDecoder().decode(b)), JSON.stringify(new TextDecoder('utf-8',{ignoreBOM:true}).decode(b)));
const ro = new ResizeObserver(()=>{}); 
