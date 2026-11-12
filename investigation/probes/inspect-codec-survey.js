/* Read-only HEVC/AV1 decoder hunt. Walks every loaded RX module and scans both
 * its dynamic symbol names and its raw string-table blob for the full set of
 * codec tokens (HEVC/H.265, AV1, and lower-level NVDEC/NVMEDIA/VIC/OMX decode
 * interfaces), beyond the H.264/VP8/VP9 path the app already uses. It also fully
 * lists the symbol names of small unidentified modules so they can be ruled in or
 * out as decoder modules. No decoder is created, no media is submitted, no memory
 * is written, and all scratch buffers are freed. See
 * investigation/evidence/codec-survey.md. */
(async function(){
 var N=window.MoonlightProbeNative,info=malloc(64),pageInfo=malloc(8);
 // Video HEVC/AV1 and hardware-decode interface tokens, plus the known
 // H.264/VP8/VP9 markers so a run self-confirms it is reading real codec data.
 var TOKENS=["hevc","h265","h.265","hvc1","hev1","x-h265",
  "av1","av01","aom","dav1d","libgav1","de265","libde265",
  "nvdec","nvmedia","nvjpg","nvdec","vp9d","tegra","vic_","mediacodec","omx",
  "avc","vp8","vp9","vpx","h264","h.264"];
 var NEW_TOKENS={hevc:1,h265:1,"h.265":1,hvc1:1,hev1:1,"x-h265":1,av1:1,av01:1,aom:1,dav1d:1,libgav1:1,de265:1,libde265:1,nvdec:1,nvmedia:1,nvjpg:1,tegra:1,mediacodec:1,omx:1};
 var NAME_RE=/hevc|h\.?265|hvc1|hev1|av01|[^a-z]av1[^a-z]|aom|dav1d|de265|libgav1|nvdec|nvmedia|nvjpg|tegra|[^a-z]vic[^a-z]|omx|mediacodec|VideoDecoder|MediaDecoder|Create.*DecoderConfiguration|vpx_codec/i;
 async function out(tag,value){await log("MOONLIGHT_CODEC_SURVEY_"+tag+": "+JSON.stringify(value));}
 function query(address){var rc=call_rop(sdk_base+0x168b0cn,info,pageInfo,address);if(rc&0x3fffffn)return null;return {base:read64(info),size:read64(info+8n),type:Number(read32(info+16n)),permissions:Number(read32(info+24n))};}
 function readable(address,length){
  if(address<0n||length<1||!Number.isSafeInteger(length)||address+BigInt(length)>0x8000000000n)return false;
  var end=address+BigInt(length),cursor=address;
  for(var i=0;i<32&&cursor<end;i++){var m=query(cursor);if(!m||!(m.permissions&1)||m.base+m.size<=cursor)return false;cursor=m.base+m.size;}
  return cursor>=end;
 }
 function textAt(bytes,offset){if(offset<0||offset>=bytes.length)return "";var text="";for(var i=offset;i<Math.min(bytes.length,offset+4096)&&bytes[i];i++)text+=String.fromCharCode(bytes[i]);return text;}
 async function copied(pointer,length){
  var bytes=new Uint8Array(length);
  for(var offset=0;offset<length;offset+=65536){var size=Math.min(65536,length-offset);bytes.set(N.copyFrom(pointer+BigInt(offset),size),offset);await new Promise(function(done){setTimeout(done,0);});}
  return bytes;
 }
 // Lower-case ASCII view for case-insensitive substring search over the blob.
 function lowerAscii(bytes){var out=new Uint8Array(bytes.length);for(var i=0;i<bytes.length;i++){var c=bytes[i];out[i]=(c>=65&&c<=90)?c+32:c;}return out;}
 function indexOfToken(hay,needleBytes,from){
  outer:for(var i=from;i<=hay.length-needleBytes.length;i++){for(var j=0;j<needleBytes.length;j++)if(hay[i+j]!==needleBytes[j])continue outer;return i;}return -1;
 }
 async function scanStrings(label,strings){
  var lower=lowerAscii(strings),literals={},total=0;
  for(var t=0;t<TOKENS.length;t++){
   var token=TOKENS[t],nb=new Uint8Array(token.length);for(var k=0;k<token.length;k++)nb[k]=token.charCodeAt(k);
   var from=0,hits=0;
   while(hits<64){
    var at=indexOfToken(lower,nb,from);if(at<0)break;hits++;total++;
    // Recover the enclosing NUL-terminated literal for context.
    var start=at;while(start>0&&strings[start-1])start--;
    var literal=textAt(strings,start);
    literals[literal]=(literals[literal]||0)+1;
    from=at+nb.length;
    if(hits%32===0)await new Promise(function(done){setTimeout(done,0);});
   }
  }
  // Flag any literal that carries a token NOT already part of the known
  // H.264/VP8/VP9/AAC path — those are the HEVC/AV1/NVDEC leads worth chasing.
  var leads=Object.keys(literals).filter(function(s){return /hevc|h\.?265|hvc1|hev1|av01|[^a-z]av1[^a-z]|aom|dav1d|de265|libgav1|nvdec|nvmedia|nvjpg|tegra|mediacodec|omx/i.test(s);});
  await out("STRINGS",{module:label,tokenHits:total,distinctLiterals:Object.keys(literals).length,leads:leads.slice(0,60),sample:Object.keys(literals).slice(0,40)});
 }
 async function inspect(base,label){
  if(!readable(base,8))return;
  var modOffset=read32(base+4n);if(modOffset<=0n||modOffset>0x10000000n)return;
  var mod=base+modOffset;if(!readable(mod,8)||read32(mod)!==0x30444f4dn)return;
  var dynamic=mod+BigInt.asIntN(32,read32(mod+4n)),tags={},terminated=false;
  for(var i=0;i<128;i++){var entry=dynamic+BigInt(i*16);if(!readable(entry,16))return;var tag=Number(read64(entry));if(!tag){terminated=true;break;}tags[tag]=read64(entry+8n);}
  if(!terminated||!tags[4]||!tags[5]||!tags[6]){await out("NO_SYMBOL_TABLE",label);return;}
  for(var tag of [4,5,6])if(tags[tag]<base)tags[tag]+=base;
  if(!readable(tags[4],8)||(tags[11]&&tags[11]!==24n))return;
  var count=Number(read32(tags[4]+4n)),size=Number(tags[10]);
  await out("SYMBOL_TABLE",{module:label,symbols:count,stringBytes:size});
  if(!Number.isSafeInteger(count)||count<1||count>250000||!Number.isSafeInteger(size)||size>16777216||size<1)return;
  if(!readable(tags[6],count*24)||!readable(tags[5],size))return;
  var symbols=await copied(tags[6],count*24),strings=await copied(tags[5],size),view=new DataView(symbols.buffer),matches=[],all=[];
  var small=count<=1024;
  for(var i=0;i<count;i++){
   if(i%512===0)await new Promise(function(done){setTimeout(done,0);});
   var name=textAt(strings,view.getUint32(i*24,true));
   if(small&&name)all.push(name);
   if(NAME_RE.test(name))matches.push({name:name,offset:view.getBigUint64(i*24+8,true).toString(16),size:Number(view.getBigUint64(i*24+16,true))});
  }
  await out("NAME_MATCHES",{module:label,count:matches.length,matches:matches.slice(0,120)});
  // Small, unidentified modules are listed in full so they can be identified.
  if(small)await out("SMALL_MODULE_NAMES",{module:label,symbols:count,names:all.slice(0,1024)});
  // Sweep the raw string blob for codec literals not tied to a symbol name.
  await scanStrings(label,strings);
 }
 try{
  if(read32(sdk_base+0x168b10n)!==0xd40000c1n)throw Error("QueryMemory wrapper mismatch");
  var cursor=0n,regions=0,rx=[];
  for(;regions<512&&cursor<0x8000000000n;regions++){
   var mapping=query(cursor);if(!mapping||!mapping.size||mapping.base+mapping.size<=cursor)break;
   if((mapping.permissions&5)===5)rx.push(mapping);
   cursor=mapping.base+mapping.size;
  }
  await out("MAP_SCAN",{regions:regions,rxRegions:rx.length,stoppedAt:cursor.toString(16)});
  await inspect(main_base,"main");await inspect(sdk_base,"sdk");
  for(var mapping of rx)if(mapping.base!==main_base&&mapping.base!==sdk_base&&mapping.size>=4096n)await inspect(mapping.base,"other@"+mapping.base.toString(16));
 }catch(error){await out("ERROR",String(error.message||error));}
 finally{free(info);free(pageInfo);delete window.MoonlightProbeNative;await out("END",true);}
})();
