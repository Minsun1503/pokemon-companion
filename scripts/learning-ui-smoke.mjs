import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile, copyFile, realpath, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-learning-ui-'));
let session;
const decode = result => JSON.parse(result.content[0].text);
async function command(action, value) {
  const id = randomUUID();
  await writeFile(resolve(scratch, 'command.json'), JSON.stringify({id,action,value}));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const result = JSON.parse(await readFile(resolve(scratch, 'response.json'), 'utf8')); if (result.id === id) return result; if (result.error) throw new Error(result.error); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await delay(50);
  }
  throw new Error('Companion fixture command timeout');
}
try {
  await mkdir(resolve(scratch,'build/main/companion'), {recursive:true});
  await writeFile(resolve(scratch,'build/main/companion/index.js'), '// marker for launcher\n');
  await writeFile(resolve(scratch,'package.json'), JSON.stringify({main:'main.cjs'}));
  await copyFile(resolve(root,'scripts/learning-ui-fixture.cjs'), resolve(scratch,'main.cjs'));
  session = await connect({env:{...process.env,MCP_TRANSPORT:'stdio',POKEMON_UI:'on',POKEMON_TEST_REPO:root,POKEMON_TEST_DATA:scratch,
    POKEMON_FRONTEND_DIR:scratch,POKEMON_ELECTRON_BINARY:resolve(root,'frontend/node_modules/electron/dist/electron.exe'),
    POKEMON_USER_DATA_DIR:resolve(scratch,'profile'),POKEMON_LEARNING_DIR:resolve(scratch,'learning')}});
  const api = async (name,args) => decode(await session.call(name,args));
  const samples = [];
  await api('pokemon',{action:'status'});
  await delay(1500);
  samples.push({mode:'idle_visible',...(await command('state'))});
  assert.equal(samples.at(-1).state.sprite.endsWith('.gif'),process.env.POKEMON_IDLE_ANIMATION==='on','Idle mode must select an animated or still sprite as configured');
  await delay(3000);
  samples.push({mode:'idle_visible',...(await command('state'))});
  for (const rating of ['good','bad']) {
    const task = await api('learning',{action:'begin',query:'Synthetic companion feedback '+rating});
    await api('desktop',{action:'status',task_id:task.task_id});
    await api('learning',{action:'finish',task_id:task.task_id,outcome:'met',summary:'Fixture tests UI feedback only'});
    const open = await command('open');
    // On the second run the panel is already open; restore it if needed.
    if (!open.state.panel) await command('open');
    assert((await command('state')).state.feedback);
    if (rating === 'good') {
      await command('frame');
      await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
      await copyFile(resolve(scratch,'feedback.png'),resolve(root,'benchmarks/results/local-learning-feedback.png'));
    }
    await command('feedback',rating);
    let snapshot;
    for (let retry=0;retry<60;retry++) { snapshot=await command('state'); if (!snapshot.state.feedback) break; await delay(50); }
    assert(!snapshot.state.feedback, 'Prompt must clear after persisted feedback');
    const page = await api('learning',{action:'export'});
    let serialized=page.data, offset=page.next_offset;
    while (offset!==null) { const next=await api('learning',{action:'export',offset,version:page.version}); serialized+=next.data; offset=next.next_offset; }
    const recorded=JSON.parse(serialized).tasks[task.task_id];
    assert.equal(recorded.satisfaction,rating==='good'?'satisfied':'unsatisfied');
    assert.equal(recorded.feedback_source,'user_ui');
  }
  await api('pokemon',{action:'hide'});
  await delay(3000);
  samples.push({mode:'hidden',...(await command('state'))});
  const stats=await api('learning',{action:'status'});
  const report={created_at:new Date().toISOString(),feedback_buttons_verified:true,authenticated_production_bridge:true,encrypted_feedback_verified:true,samples,learning:stats,
    limits:['Test harness clicks actual production DOM buttons; ratings are synthetic, not user satisfaction.', 'Electron CPU percentages include the test harness; GPU process CPU is not hardware GPU utilization.', 'Short idle samples are descriptive; no before/after CPU reduction claim.']};
  await writeFile(resolve(root,process.env.POKEMON_TEST_REPORT || 'benchmarks/results/local-learning-ui-2026-11-11.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({feedback_buttons_verified:true,samples:samples.map(s=>({mode:s.mode,processes:s.metrics.map(m=>({type:m.type,cpu_percent:m.cpu.percentCPUUsage,working_set_kib:m.memory.workingSetSize}))}))},null,2));
} finally {
  if(session) await session.client.close();
  const checked=await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-learning-ui-'));
  await rm(checked,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
