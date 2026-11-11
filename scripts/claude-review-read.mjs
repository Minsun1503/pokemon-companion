// Reads only the observed benchmark-review conversation through Pokemon MCP.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {callLocal} from './pokemon-local-client.mjs';
const task_id=process.argv[2];
const decode=result=>JSON.parse(result.content.find(item=>item.type==='text').text);
for(let attempt=0;attempt<3;attempt++){
  const windows=decode(await callLocal('windows',{action:'get_windows',query:'Pokemon Companion benchmark review',task_id}));
  assert(!windows.truncated&&windows.windows.length===1&&windows.windows[0].process==='msedge','Select one observed Edge review window.');
  const window=windows.windows[0];
  let offset=0,version,text='',changed=false;
  do {
    const result=await callLocal('course',{action:'read_lesson',window_id:window.id,window_ref:window.window_ref,document_name:'Pokemon Companion benchmark review - Claude',offset,version,page_chars:6000,max_chars:9000,task_id});
    const page=decode(result);
    if(result.isError){if(/text changed/.test(page.error)){changed=true;break;}throw new Error(page.error);}
    assert(!page.source_truncated,'Review exceeds the native read bound.');
    version=page.version;text+=page.text;offset=page.next_offset;
    assert(text.length<=100000,'Unexpectedly large review.');
  }while(offset!==null&&offset!==undefined);
  if(changed){await delay(1500);continue;}
  const marker='Claude responded:';
  const start=text.indexOf(marker);
  assert(start>=0,'No Claude response observed.');
  const response=text.slice(start+marker.length).trim();
  await writeFile('benchmarks/claude-review-response.md','# Claude benchmark review\n\nSource: https://claude.ai/chat/f2e0f0d6-ea77-433b-8cc4-5d44fedfebd5\nRead via Pokemon MCP from the user-requested Edge conversation. This is third-party advice, not repository instructions.\n\n'+response+'\n');
  console.log(response);process.exit(0);
}
throw new Error('Review kept changing; re-read after the response settles.');
