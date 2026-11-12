/* Integration check: the real stream loop records a video-publication stall
 * through the real telemetry stall tracker, and exposes it on the result stats.
 * Media/core/IO are mocked; telemetry and stream-client are the real modules. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('the stream loop records a publication stall with timing and counter deltas',async()=>{
 let nowMs=0,iter=0,client,connectedAt=0,platform,stopped=false,rx=0;
 // published advances on iters 1-2, freezes 3-11 (a stall while time passes),
 // resumes at iter 12, then the test stops the stream.
 function published(){return iter<=2?iter:iter<12?2:3;}
 const core={HEAPU8:new Uint8Array(1024),_malloc:()=>128,_free(){},lengthBytesUTF8:s=>s.length,stringToUTF8(){},UTF8ToString:()=>'',_LiGetLaunchUrlQueryParameters:()=>0,
  _ml_session_start:()=>{state=2;tasks=1;return 0;},_ml_session_state:()=>state,_ml_runtime_tasks:()=>tasks,
  _ml_session_video_frames:()=>1,_ml_session_stop:()=>{if(state!==0)state=4;},
  _ml_runtime_pump:()=>{if(firstPump){firstPump=false;platform.event(4,9,0);}if(state===4){state=0;tasks=0;}}};
 let state=0,tasks=0,firstPump=true;
 const media={
  drainVideo:()=>{iter++;nowMs+=20;if(iter===14&&!stopped){stopped=true;client.stop();}return true;},
  finishVideo:()=>{},drainAudio:()=>{},close(){assert.equal(tasks,0);},stats:()=>({}),
  publishedFrames:()=>published(),
  frameCounters:()=>({decoded:iter,presented:published(),superseded:0,expired:0,backlog:0})};
 const scope={setTimeout:(fn)=>{queueMicrotask(fn);return 0;},clearTimeout(){},queueMicrotask,
  Date:{now:()=>nowMs},performance:{now:()=>nowMs},Uint8Array,Promise,Math,Object,Array,Number,JSON,String,BigInt,
  __moonlightStreamFactory:async opts=>{platform=opts.moonlightPlatform;return core;},
  MoonlightNative:{create:()=>({})},
  MoonlightStreamIO:{create:()=>({io:{},stats:{receivedBytes:rx},interrupt(){},close(){assert.equal(tasks,0);},randomFill(){},receiveVideoBatch(){}})},
  MoonlightStreamMedia:{create:()=>media},
  MoonlightSessionProtocol:{create:()=>({launch:async()=>({host:'h',version:'7',url:'rtsp://h',key:new Uint8Array(16),keyId:1,codecSupport:1})})}};
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(fs.readFileSync('app/src/streaming/telemetry.js','utf8'),scope);
 vm.runInContext(fs.readFileSync('app/src/streaming/stream-client.js','utf8'),scope);
 client=scope.MoonlightStreamClient.create({host:'h',app:{id:1},mode:{width:1280,height:720,fps:60,bitrate:5000}});
 const result=await client.start();
 assert.equal(result.error,null);
 const events=result.stats.stallEvents,summary=result.stats.stallSummary;
 assert.equal(summary.count,1,'one stall recorded');
 assert.equal(events.length,1);
 assert.equal(events[0].ended,true);
 assert(events[0].durationMs>=100,'stall duration exceeds threshold: '+events[0].durationMs);
 assert(events[0].delta.decoded>0,'decode advanced during the stall (IDR-wait signature)');
 assert.equal(events[0].delta.presented,1,'exactly one frame published to end the stall');
 // The overlay line renders the summary.
 assert.match(scope.MoonlightTelemetry.format(result.stats),/Stalls 1 · worst/);
});
