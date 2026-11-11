// Local MCP client: forwards one JSON tool call from stdin to the authenticated companion.
import {mkdir, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {callLocal} from './pokemon-local-client.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const params = JSON.parse(input);
const result = await callLocal(params.name,params.arguments);
for (const content of result.content ?? []) {
  if (content.type === 'text') console.log(content.text);
  else if (content.type === 'image') {
    const folder=join(tmpdir(),'pokemon-mcp-captures');
    await mkdir(folder,{recursive:true});
    const path=join(folder,randomUUID()+'.png');
    await writeFile(path,Buffer.from(content.data,'base64'));
    console.log(JSON.stringify({image_path:path,mimeType:content.mimeType}));
  }
}
if(result.isError) process.exitCode=1;
