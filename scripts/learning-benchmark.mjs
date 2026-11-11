import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir, cpus} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLearning} from '../backend/dist/learning/service.js';
import {features, train} from '../backend/dist/learning/model.js';
import {jsonResult} from '../backend/dist/utils/response.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(resolve(tmpdir(),'pokemon-learning-benchmark-'));
const learning=new LocalLearning(directory,randomBytes(32));
const topics=['invoice','shipping','customer','inventory','payment','budget','report','appointment','meeting','travel','recipe','address','calendar','project','reminder','contact','account','ticket','reference','description','comment','message','schedule','purchase','request','supplier','employee','service','document','order','delivery','reservation'];
const median=values=>{const s=values.toSorted((a,b)=>a-b);return(s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
async function measure(count,run) {
  const cpu=process.cpuUsage(), samples=[];
  for(let i=0;i<count;i++){const start=performance.now();await run(i);samples.push(performance.now()-start);}
  const used=process.cpuUsage(cpu),sorted=samples.toSorted((a,b)=>a-b);
  return{runs:count,median_ms:median(samples),p95_ms:sorted[Math.ceil(count*.95)-1],cpu_ms:(used.user+used.system)/1000};
}
try {
  await learning.open();
  const before=process.memoryUsage();
  const training=await measure(topics.length,async i=>{
    const topic=topics[i], task=await learning.begin(`Type the ${topic} field`,{text:'sample'});
    const steps=[{action:'get_windows',query:'Benchmark fixture'},
      {action:'get_ui',window_step:0,query:topic+' field',control_type:'Edit'},
      {action:'set_value',target_step:1,text:'sample'},
      {action:'get_ui',window_step:0,query:topic+' field',control_type:'Edit',expect_value:'sample'}];
    await learning.record(task.id,'windows',{steps},jsonResult({ok:true,completed:4}),1);
    await learning.finish(task.id,'met','Synthetic training example');
    await learning.feedback(task.id,'satisfied','explicit_user_report');
  });
  const after=process.memoryUsage();
  const retrieval=await measure(500,async i=>{const result=await learning.suggest(`Enter the ${topics[i%topics.length]} field`);assert(result.length>0);});
  const task=await learning.begin('Inspect backend diagnostics',{});
  const call=async()=>jsonResult({ok:true});
  const unrecorded=await measure(200,call);
  const recorded=await measure(200,async()=>{await learning.enter(task.id);try{const result=await call();await learning.record(task.id,'desktop',{action:'status'},result,0);}finally{learning.leave(task.id);}});
  const vector=features('Type the reference field'),model={weights:{},bias:0,examples:0};
  const online_update=await measure(2000,async i=>train(model,vector,i%2));
  const cases=[{query:'Enter the invoice field',expected:'invoice field'},{query:'Fill the shipping field',expected:'shipping field'},
    {query:'Type the contact field please',expected:'contact field'},{query:'Type the inventory field now',expected:'inventory field'},
    {query:'Paint a watercolor landscape',expected:null},{query:'Play chess against me',expected:null}];
  const evaluation=[];
  for(const item of cases){const suggestions=await learning.suggest(item.query);const actual=suggestions[0]?.steps?.[1]?.query??null;evaluation.push({...item,actual,correct:actual===item.expected});}
  const first=await stat(resolve(directory,'events.enc')),idleCPU=process.cpuUsage();
  await delay(2000);
  const cpu=process.cpuUsage(idleCPU),last=await stat(resolve(directory,'events.enc'));
  assert.equal(first.mtimeMs,last.mtimeMs);assert.equal(first.size,last.size);
  const stats=await learning.stats();
  assert(stats.tasks<=32&&stats.recipes<=32&&stats.state_bytes<=2*1024*1024);
  const report={created_at:new Date().toISOString(),environment:{cpu:cpus()[0].model,node:process.version},training,retrieval,unrecorded,recorded,online_update,
    memory:{before,after,state_bytes:stats.state_bytes},idle:{window_ms:2000,cpu_ms:(cpu.user+cpu.system)/1000,journal_changed:false},evaluation,learning:stats,
    limits:['Synthetic 32-recipe bounded dataset, six held-out queries; not general semantic understanding.', 'Test key bypasses DPAPI to isolate steady-state model and journal cost; native smoke measures DPAPI separately.', 'Online update measures only the CPU ranker; task training includes encrypted persistence.', 'RSS/heap include Node and dependencies, and GC timing; no attribution of their whole size to the model.', 'No external AI latency or token costs measured; no background training or neural runtime.']};
  await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
  await writeFile(resolve(root,'benchmarks/results/local-learning-resources-2026-11-11.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({training,retrieval,recorded,online_update,idle:report.idle,state_bytes:stats.state_bytes,evaluation},null,2));
} finally {
  await learning.close();
  const checked=await realpath(directory);
  assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-learning-benchmark-'));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
