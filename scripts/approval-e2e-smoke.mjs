import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {PokemonRuntime} from '../backend/dist/pokemon/runtime.js';
import {appSchema,routeApp} from '../backend/dist/apps/router.js';
import {desktopStatus} from '../backend/dist/tools/desktop.js';

const scratch=await mkdtemp(resolve(tmpdir(),'pokemon-approval-e2e-'));
const fixtureRoot=resolve(scratch,'companion');
await mkdir(resolve(fixtureRoot,'build/main/companion'),{recursive:true});
await writeFile(resolve(fixtureRoot,'package.json'),JSON.stringify({name:'approval-test-only',main:'build/main/companion/index.js'}));
await writeFile(resolve(fixtureRoot,'build/main/companion/index.js'),`require(${JSON.stringify(resolve('scripts/approval-e2e-fixture.cjs'))});`);
Object.assign(process.env,{POKEMON_UI:'on',POKEMON_LEARNING:'off',POKEMON_FRONTEND_DIR:fixtureRoot,POKEMON_ELECTRON_BINARY:resolve('frontend/node_modules/electron/dist/electron.exe'),POKEMON_USER_DATA_DIR:resolve(scratch,'data'),POKEMON_ACTIONS_DIR:resolve(scratch,'actions'),POKEMON_WEB_PROFILE:resolve(scratch,'web'),POKEMON_APPROVAL_E2E_REPORT:resolve(scratch,'dialog.json'),POKEMON_APPROVAL_E2E_IMAGE:resolve('output/claude-review/approval-e2e.png')});
for(const variable of ['POKEMON_AUTHORIZATION','POKEMON_BROWSER_INPUT','POKEMON_BROWSER_ATTACH','POKEMON_BROWSER_ORIGINS','POKEMON_LAUNCH_ALLOWLIST']) delete process.env[variable];
await mkdir(process.env.POKEMON_USER_DATA_DIR,{recursive:true});
const runtime=new PokemonRuntime();
const sends=new Map(),active=new Map(); let requests=0;
const server=createServer((request,response)=>{
  requests++;
  const url=new URL(request.url,'http://fixture'),thread=url.searchParams.get('thread')??'A';
  if(url.pathname==='/send') {sends.set(thread,(sends.get(thread)??0)+1); void active.get(thread)?.close(); return;}
  response.setHeader('content-type','text/html');
  response.end(`<title>Synthetic conversation</title><h2 id="thread" data-conversation-id="${thread}">Thread ${thread}</h2><div id="incoming"></div><form id="composer"><input id="draft" name="draft" value="synthetic song"><button type="button" id="send" onclick="fetch('/send?thread=${thread}',{method:'POST',body:document.getElementById('draft').value})">Send</button></form>`);
});
await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
const origin=`http://127.0.0.1:${server.address().port}`;
const denied=async(run,code='APPROVAL_REQUIRED')=>assert.rejects(run,error=>error.details?.code===code);
const fixture=(kind,data={})=>runtime.companion.send(kind,data); // Private test pipe; no model-facing hook.
const inspect=async(capture=false)=>{await fixture('fixture_inspect',{capture});return JSON.parse(await readFile(process.env.POKEMON_APPROVAL_E2E_REPORT,'utf8'));};
const decide=async(choice)=>{const report=await inspect();await fixture('fixture_decide',{digest:report.request.digest,choice});return report;};
const contract={conversation:'#thread',composer:'#composer'};
let page,pageId;
const open=async(thread)=>{
  page=await runtime.browser.page(opened.page_id).context().newPage(); pageId=runtime.browser.remember(page);
  await page.goto(`${origin}/thread?thread=${thread}`);runtime.browser.setConversationContract(pageId,contract);active.set(thread,page);
};
const ref=async(id)=>{const shot=await runtime.browser.snapshot(pageId);return shot.nodes.find(node=>node.id===id).ref;};
let opened;
try {
  await runtime.companion.start();
  const baseline=requests;
  await denied(()=>routeApp(runtime,appSchema.parse({action:'read',app_id:'teams',web_urls:[origin+'/attacker?data=synthetic']})),'INVALID_ARGS');
  await denied(()=>runtime.browser.webPage('custom',origin+'/attacker?data=synthetic'));
  assert.equal(requests,baseline);await decide('deny');
  await denied(()=>runtime.windows.request({action:'launch',text:origin+'/attacker'}),'INVALID_ARGS');
  await denied(()=>runtime.windows.request({action:'launch',text:resolve(process.env.SystemRoot,'System32/notepad.exe')}));
  assert.equal((await desktopStatus(runtime)).authorization.native_desktop,'host-authorized-only');
  opened=await runtime.browser.launch('chromium',true,resolve(scratch,'browser'));
  await open('A');let draft=await ref('draft');
  await denied(()=>runtime.browser.input(pageId,draft,'fill','one'));await decide(false);
  await page.evaluate(()=>document.getElementById('incoming').textContent='Incoming message changed');
  assert.equal((await runtime.browser.input(pageId,draft,'fill','one')).outcome,'success');
  await denied(()=>runtime.browser.input(pageId,draft,'fill','two'));await decide(true);
  for(let index=0;index<20;index++) assert.equal((await runtime.browser.input(pageId,draft,'fill',`text ${index}`)).outcome,'success');
  await denied(()=>runtime.browser.input(pageId,draft,'fill','count exhausted'));await decide('deny');
  await denied(()=>runtime.browser.input(pageId,draft,'fill','A scope'));const scopeA=await decide(true);
  await open('B');draft=await ref('draft');await denied(()=>runtime.browser.input(pageId,draft,'fill','B text'));const scopeB=await decide('deny');assert.notEqual(scopeA.request.scope_hash,scopeB.request.scope_hash);
  await open('A');draft=await ref('draft');for(const text of ['alpha','beta','gamma']) assert.equal((await runtime.browser.input(pageId,draft,'fill',text)).outcome,'success');
  await fixture('fixture_clock',{time:700000});await denied(()=>runtime.browser.input(pageId,draft,'fill','expired'));await decide('deny');
  runtime.browser.setConversationContract(pageId,{conversation:'#missing',composer:'#composer'});
  await denied(()=>runtime.browser.input(pageId,draft,'fill','unknown thread'));assert.equal((await inspect()).dom.scopeHidden,true);await decide('deny');
  runtime.browser.setConversationContract(pageId,contract);
  await denied(()=>runtime.browser.input(pageId,draft,'fill','x'.repeat(8001)),'APPROVAL_DISPLAY_TOO_LARGE');
  await page.locator('#send').evaluate(element=>element.setAttribute('aria-label','\u202e'+'\n'.repeat(100000)));
  const send=await ref('send');await denied(()=>runtime.browser.input(pageId,send,'click'));
  const huge=await inspect(true);assert(huge.request.target.length<=200);assert(huge.request.target_length>=100000);assert.equal(huge.request.input_preview,'gamma');assert(huge.dom.buttons.every(button=>button.visible));assert(huge.request.target.includes('\\u202e'));await decide('deny');
  const rows=[];
  for(let index=0;index<20;index++) {
    const thread=`fault-${index}`;await open(thread);const sendRef=await ref('send');
    await denied(()=>runtime.browser.input(pageId,sendRef,'click'));await decide(true);
    let outcome;try{outcome=(await runtime.browser.input(pageId,sendRef,'click')).outcome;}catch(error){assert.equal(error.details?.code,'ACTION_OUTCOME_UNKNOWN');outcome='unknown';}
    assert.equal(outcome,'unknown');
    for(let poll=0;poll<50&&sends.get(thread)!==1;poll++) await new Promise(resolveWait=>setTimeout(resolveWait,20));
    assert.equal(sends.get(thread),1);
    await open(thread);await page.locator('#draft').fill('synthetic song ');
    const observed = await runtime.browser.snapshot(pageId);
    const changed = observed.nodes.find(node=>node.id==='send').ref;
    const alternate = observed.nodes.find(node=>node.id==='draft').ref;
    await denied(()=>runtime.browser.input(pageId,changed,'click'),'REPLAY_BLOCKED');
    await denied(()=>runtime.browser.input(pageId,alternate,'press','Enter'),'REPLAY_BLOCKED');
    const reconciliation=await inspect();assert.equal(reconciliation.request.reconciliation,true);assert(reconciliation.dom.scopeHidden);await decide(false);
    await denied(()=>runtime.browser.input(pageId,changed,'click'),'RECONCILED');assert.equal(sends.get(thread),1);
    await denied(()=>runtime.browser.input(pageId,changed,'click'));await decide('deny');
    rows.push({run:index+1,unknown: true,perturbed_replay:'blocked',alternate_method_replay:'blocked',reconciled: true,readback_sends:sends.get(thread)});
    await page.close();
  }
  const report={at:new Date().toISOString(),fixture_only:true,real_pipe:true,test_hook_in_production:false,zero_unauthorized_egress:true,native_launch_refused:true,native_status:'host-authorized-only',once_consumed:true,scope_uses:20,expiry_checked:true,threads_same_path_isolated:true,three_changed_fills:true,incoming_message_preserves_once:true,unknown_scope_button_hidden:true,large_label_channel_alive:true,complete_draft_visible:true,footer_buttons_visible:true,oversize_input_refused:true,perturbed_unknown_runs:rows.length,duplicate_sends:0,rows,result:'pass'};
  await writeFile('benchmarks/results/approval-e2e-2026-11-15.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
  await runtime.close();server.closeAllConnections();await new Promise(resolveDone=>server.close(resolveDone));
  assert(scratch.startsWith(resolve(tmpdir())+sep)&&scratch.includes('pokemon-approval-e2e-'));
  await rm(scratch,{recursive:true,force:true,maxRetries:30,retryDelay:100});
}
