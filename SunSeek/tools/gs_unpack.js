// Unpack the MUT Ground Station PyInstaller exe: writes gs_script_main.pyc (+ PYZ) in the current folder.
// Then dump printable strings to see what the GS expects (found the STREAM_URL Live View trigger this way, 6 Oct).
//   node gs_unpack.js "<path to MUT_Education_Satellite_Ground_Station_v1.10.exe>"
const fs=require('fs'),zlib=require('zlib');
const exe=process.argv[2];const b=fs.readFileSync(exe);
const magic=Buffer.from([0x4d,0x45,0x49,0x0c,0x0b,0x0a,0x0b,0x0e]);
const ci=b.lastIndexOf(magic);if(ci<0)throw 'no cookie';
// cookie: magic(8) len(4) tocpos(4) toclen(4) pyver(4) pylib(64)
const pkgLen=b.readUInt32BE(ci+8),tocPos=b.readUInt32BE(ci+12),tocLen=b.readUInt32BE(ci+16);
const tail=24+64;const start=ci+tail-pkgLen;
let p=start+tocPos;const end=p+tocLen;const ents=[];
while(p<end){const sz=b.readUInt32BE(p);const pos=b.readUInt32BE(p+4),cl=b.readUInt32BE(p+8),ul=b.readUInt32BE(p+12),cf=b[p+16],tc=String.fromCharCode(b[p+17]);const name=b.slice(p+18,p+sz).toString('utf8').replace(/\0+$/,'');ents.push({pos,cl,ul,cf,tc,name});p+=sz;}
const out=[];
for(const e of ents){let d=b.slice(start+e.pos,start+e.pos+e.cl);if(e.cf){try{d=zlib.inflateSync(d)}catch(x){continue}}
 if(e.tc==='z'||e.tc==='Z'){ // PYZ
   fs.writeFileSync('gs_pyz.bin',d);console.log('PYZ',e.name,d.length);
 } else if(e.tc==='s'){fs.writeFileSync('gs_script_'+e.name.replace(/\W/g,'_')+'.pyc',d);console.log('script',e.name,d.length);}
}
console.log('entries',ents.length);
