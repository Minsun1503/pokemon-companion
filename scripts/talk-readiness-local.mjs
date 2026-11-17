// Live, unmodified Ollama model smoke tests. No mocked model and no scripted tool choices.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const fixture=process.argv[2];assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture||''),'Supply the owned fixture loopback URL.');
const endpoint=process.env.POKEMON_SMOKE_OLLAMA||'http://localhost:11434';
const model='qwen3:4b';
const names=['window_discovery','control_discovery','enter_text_verify','search_and_open','button_result','document_passages','url_open','pdf_open_read','excel_read','excel_write_calculate_save'];
const get=async path=>{const r=await fetch(fixture+path,{signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Fixture failed');return d;};
if(process.argv[3]==='--worker') {
  const id=process.argv[4],profile=process.argv[5];
  const prepared=JSON.parse(await readFile(resolve(profile,'prepared.json'),'utf8'));
  const {CompanionChat}=require('../frontend/build/main/companion/chat.js');
  const {CompanionAgentTools}=require('../frontend/build/main/companion/agent.js');
  const {PetRegistry}=require('../frontend/build/main/services/pet-registry.js');
  const native=new CompanionAgentTools(resolve(root,'frontend'),profile,()=>false);
  const trace=[],requests=[];const baseFetch=globalThis.fetch;
  const started=performance.now();let reply;
  const checkpoint=async()=>{
    const target=resolve(profile,'result.json'),temporary=target+'.tmp';
    await writeFile(temporary,JSON.stringify({id,prompt:prepared.prompt,reply,elapsed_ms:performance.now()-started,trace,requests},null,2));
    await rename(temporary,target);
  };
  globalThis.fetch=async(url,options)=>{
    const requestStarted=performance.now();let response,request;
    if(String(url).endsWith('/api/chat')) {
      const body=JSON.parse(options.body);
      request={status:'pending',model:body.model,options:body.options,tool_names:body.tools.map(t=>t.function.name)};
      requests.push(request);await checkpoint();
    }
    try {response=await baseFetch(url,options);}
    catch(error) {
      if(request) {Object.assign(request,{elapsed_ms:performance.now()-requestStarted,status:'failed',error:error.message});await checkpoint();}
      throw error;
    }
    if(request) {
      const result=await response.clone().json();
      Object.assign(request,{elapsed_ms:performance.now()-requestStarted,status:response.status,prompt_eval_count:result.prompt_eval_count,prompt_eval_duration:result.prompt_eval_duration,eval_count:result.eval_count,eval_duration:result.eval_duration,load_duration:result.load_duration,total_duration:result.total_duration,message:result.message});
      await checkpoint();
    }
    return response;
  };
  const tools={forPet:pet=>{
    const bound=native.forPet(pet);
    return {...bound,call:async(name,args)=>{
      const start=performance.now(),entry={name,args,status:'pending'};trace.push(entry);await checkpoint();
      try {const result=await bound.call(name,args);Object.assign(entry,{status:'completed',result,elapsed_ms:performance.now()-start});await checkpoint();return result;}
      catch(error){Object.assign(entry,{status:'failed',error:error.message,elapsed_ms:performance.now()-start});await checkpoint();throw error;}
    }};
  }};
  process.once('SIGTERM',()=>{native.close();process.exit(143);});
  await checkpoint();
  try {reply=await new CompanionChat(resolve(root,'frontend'),profile,new PetRegistry(resolve(root,'frontend/pets')),tools).reply('pikachu',prepared.prompt);}
  finally {native.close();}
  await checkpoint();
} else {
  const version=await (await fetch(endpoint+'/api/version')).json();
  const tags=await (await fetch(endpoint+'/api/tags')).json();const tag=tags.models.find(row=>row.name===model);assert(tag,'Pull qwen3:4b before running this test.');
  const report={created_at:new Date().toISOString(),model,endpoint,ollama:version,model_metadata:tag,deadline_ms:180000,limitations:['One smoke sample per task, fresh chat/worker per task; no fine tuning or prompt adaptation. External cloud arm uses its own full catalog. These runs do not establish a speedup.'],cases:[]};
  const output=resolve(root,'benchmarks/results/talk-readiness-local-2026-11-14.json');
  for(const id of names) {
    const profile=await mkdtemp(resolve(tmpdir(),'pokemon-talk-live-'));let record;
    try {
      const prepared=await get('/prepare?case='+id+'&arm=local');
      await writeFile(resolve(profile,'prepared.json'),JSON.stringify(prepared));
      const settings=JSON.parse(await readFile(resolve(root,'frontend/config/setting.json'),'utf8'));settings.ai.provider='ollama';settings.ai.ollama.baseUrl=endpoint;settings.ai.ollama.model=model;
      await writeFile(resolve(profile,'setting.json'),JSON.stringify(settings));
      const start=performance.now(),child=spawn(process.execPath,[fileURLToPath(import.meta.url),fixture,'--worker',id,profile],{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let diagnostic='';child.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-2000);});
      let deadlineExceeded=false;
      const timer=setTimeout(()=>{deadlineExceeded=true;child.kill();},report.deadline_ms);
      const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timer);
      try {record=JSON.parse(await readFile(resolve(profile,'result.json'),'utf8'));}catch{record={id,error:diagnostic||'Worker exited without a result',elapsed_ms:performance.now()-start};}
      record.worker_exit_code=code;
      if(deadlineExceeded||code!==0) {
        record.status=deadlineExceeded?'timeout':'failed';record.error=diagnostic||'Worker stopped before completing the task';
        record.elapsed_ms=performance.now()-start;
      }
      record.fixture=await get('/verify');
      const evidence=JSON.stringify(record.trace||[]),summary=record.reply?.content||'',observed=record.fixture.observation;
      const readFacts=evidence.includes('37 cases')&&evidence.includes('48.75 USD')&&summary.includes('37')&&summary.includes('48.75');
      const checks={window_discovery:evidence.includes(prepared.title)&&summary.includes(prepared.title),control_discovery:evidence.includes('Record search')&&evidence.includes('set_value'),enter_text_verify:observed.input==='smoke-'+prepared.token,search_and_open:observed.search===1&&observed.click===1&&readFacts,button_result:observed.details===1&&evidence.includes('Active')&&summary.includes('Active'),document_passages:observed.load===1&&readFacts&&evidence.includes(prepared.token),url_open:evidence.includes(prepared.work+'&opened=1')&&evidence.includes(prepared.title),pdf_open_read:evidence.includes(prepared.pdf)&&readFacts,excel_read:observed.excel?.values?.every((v,i)=>v===i+1)&&observed.excel?.other_untouched&&(record.trace||[]).some(row=>row.name==='excel'&&row.args.action==='read_range'),excel_write_calculate_save:observed.excel?.calculated===55&&observed.excel?.formula==='=SUM(A3:J3)'&&observed.excel?.other_untouched};
      if(id==='control_discovery') checks[id]=checks[id]&&observed.input==='';
      record.independent_verification=Boolean(checks[id]);
      record.harness_verification=(record.trace||[]).some(row=>row.name==='task_done'&&row.result?.verified===true);
      if(!record.status) record.status=record.reply?.ok&&record.independent_verification&&record.harness_verification?'pass':'fail';
    } catch(error){record={...(record||{}),id,status:'blocked',error:error.message};}
    finally {
      const checked=await realpath(profile);assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-talk-live-'));await rm(checked,{recursive:true,force:true});
    }
    report.cases.push(record);await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({id,status:record.status,elapsed_ms:record.elapsed_ms,reply:record.reply}));
  }
  console.log(output);
}
