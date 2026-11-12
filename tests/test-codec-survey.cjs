/* Off-device logic check for the HEVC/AV1 decoder-hunt probe. Builds a synthetic
 * process memory with MOD0 modules and verifies the probe surfaces planted
 * HEVC/AV1/NVDEC literals as leads, reports a clean H.264/VP9 module as lead-free,
 * lists small modules in full, and frees all scratch. Not hardware evidence. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('investigation/probes/inspect-codec-survey.js','utf8');

async function run(modules){
 const memory=new Map(),owned=new Set(),logs=[],regions=[];
 const main=0x1000n,sdk=0x100000n,limit=0x8000000000n;let allocation=0x40000000n;
 function write(p,value,n=8){for(let i=0;i<n;i++)memory.set(p+BigInt(i),Number((BigInt(value)>>BigInt(i*8))&255n));}
 function read(p,n){let value=0n;for(let i=n-1;i>=0;i--)value=(value<<8n)|BigInt(memory.get(p+BigInt(i))||0);return value;}
 regions.push({base:main,size:0x10000n,permissions:5},{base:sdk,size:0x300000n,permissions:5});
 write(sdk+0x168b10n,0xd40000c1n,4);
 // Build each extra module: MOD0 header, dynamic tags, symbol + string tables.
 for(const m of modules){
  regions.push({base:m.base,size:0x100000n,permissions:5});
  const mod=m.base+0x100n,dynamic=m.base+0x200n,hash=m.base+0x400n,symbols=m.base+0x20000n,strings=m.base+0x80000n;
  write(m.base+4n,0x100n,4);write(mod,0x30444f4dn,4);write(mod+4n,0x100n,4);
  const count=m.symbols.length+1;
  for(const [i,tag,value] of [[0,4,hash],[1,5,strings],[2,6,symbols],[3,10,m.stringBytes],[4,11,24]]){write(dynamic+BigInt(i*16),tag);write(dynamic+BigInt(i*16+8),value);}
  write(hash,1,4);write(hash+4n,count,4);
  write(strings,0,1);let offset=1;
  for(const [i,name] of m.symbols.entries()){
   write(symbols+BigInt((i+1)*24),offset,4);write(symbols+BigInt((i+1)*24+8),0x1000+i*16);
   for(let j=0;j<name.length;j++)write(strings+BigInt(offset+j),name.charCodeAt(j),1);offset+=name.length+1;
  }
  for(const literal of m.literals||[]){for(let j=0;j<literal.length;j++)write(strings+BigInt(offset+j),literal.charCodeAt(j),1);offset+=literal.length+1;}
 }
 function copyFrom(pointer,length){const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=Number(read(pointer+BigInt(i),1));return bytes;}
 const win={MoonlightProbeNative:{copyFrom}};
 const context={window:win,main_base:main,sdk_base:sdk,setTimeout,log:async line=>logs.push(line),
  malloc:n=>{const p=allocation;allocation+=BigInt(n+64);owned.add(p);return p;},free:p=>assert(owned.delete(p)),
  read8:p=>read(p,1),read32:p=>read(p,4),read64:p=>read(p,8),
  call_rop:(fn,info,page,address)=>{
   assert.equal(fn,sdk+0x168b0cn,'probe must only call memory query');
   const sorted=regions.slice().sort((a,b)=>a.base<b.base?-1:1);
   let q=sorted.find(r=>address>=r.base&&address<r.base+r.size);
   if(!q){const next=sorted.find(r=>r.base>address);q={base:address,size:(next?next.base:limit)-address,permissions:0};}
   write(info,q.base);write(info+8n,q.size);write(info+24n,q.permissions,4);return 0n;
  }};
 await vm.runInNewContext(source,context);
 assert.equal(owned.size,0,'all scratch allocations freed');
 return logs.map(line=>({key:line.split(': ')[0],value:JSON.parse(line.slice(line.indexOf(': ')+2))}));
}

test('a clean H.264/VP9 module reports no HEVC/AV1 leads',async()=>{
 const logs=await run([{base:0x800000n,symbols:[
  '_ZN5movie34CreateH264DecoderConfigurationDataEPKhmS1_mPNS_9MediaDataE',
  '_ZN5movie33CreateVp9DecoderConfigurationDataEiiiPNS_9MediaDataE'],
  literals:['video/avc','x-vnd.on2.vp9'],stringBytes:0x200}]);
 const strings=logs.find(l=>l.key.endsWith('_STRINGS')&&l.value.module==='other@800000').value;
 assert.deepEqual(strings.leads,[]);
 const names=logs.find(l=>l.key.endsWith('_NAME_MATCHES')&&l.value.module==='other@800000').value;
 assert.equal(names.count,2); // both CreateXxxDecoderConfiguration symbols matched
 assert(logs.some(l=>l.key.endsWith('_END')&&l.value===true));
});

test('planted HEVC/AV1/NVDEC markers surface as leads in names and strings',async()=>{
 const logs=await run([{base:0xA00000n,symbols:['_ZN3app12VideoDecoderEv','nvdecDecodeFrame'],
  literals:['video/hevc','av01','video/x-h265'],stringBytes:0x200}]);
 const strings=logs.find(l=>l.key.endsWith('_STRINGS')&&l.value.module==='other@a00000').value;
 assert(strings.leads.includes('video/hevc'),'hevc literal flagged');
 assert(strings.leads.includes('av01'),'av1 literal flagged');
 assert(strings.leads.includes('video/x-h265'),'h265 literal flagged');
 const names=logs.find(l=>l.key.endsWith('_NAME_MATCHES')&&l.value.module==='other@a00000').value;
 const matched=names.matches.map(m=>m.name);
 assert(matched.some(n=>/VideoDecoder/.test(n)),'VideoDecoder symbol matched');
 assert(matched.some(n=>/nvdec/.test(n)),'nvdec symbol matched');
});

test('small modules are listed in full so they can be identified',async()=>{
 const logs=await run([{base:0x800000n,symbols:['someUnrelatedSymbol','another_symbol'],literals:[],stringBytes:0x80}]);
 const small=logs.find(l=>l.key.endsWith('_SMALL_MODULE_NAMES')&&l.value.module==='other@800000').value;
 assert.deepEqual(small.names.sort(),['another_symbol','someUnrelatedSymbol']);
});
