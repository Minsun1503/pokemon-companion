const {test} = require('node:test');
const assert = require('node:assert/strict');
const {CompanionRecordingBridge} = require('../frontend/build/main/companion/recording-ipc.js');
test('untrusted renderers and extra fields cannot start recording', async () => {
  const sent=[]; const bridge=new CompanionRecordingBridge(value=>{sent.push(value);return true;});
  assert.equal((await bridge.request(false,{action:'start',mode:'desktop',target:'window'})).ok,false);
  assert.equal((await bridge.request(true,{action:'status',cookie:'secret'})).ok,false);
  assert.equal(sent.length,0);bridge.close();
});
test('Stop remains available and replies are matched to requests', async()=>{
  const sent=[];const bridge=new CompanionRecordingBridge(value=>{sent.push(value);return true;});
  const start=bridge.request(true,{action:'start',mode:'browser',target:'page'});
  const stop=bridge.request(true,{action:'stop'});
  bridge.finish(sent[1].id,{ok:true,result:{active:false}});
  assert.equal((await stop).result.active,false);
  bridge.close();assert.equal((await start).ok,false);
});
