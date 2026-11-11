import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {connect} from './client.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await mkdtemp(resolve(tmpdir(),'pokemon-learning-contract-'));
const {addClientMetadata}=createRequire(import.meta.url)('./client-package-metadata.cjs');
let session;
try {
  addClientMetadata(scratch,root,process.platform,JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version);
  session=await connect({env:{...process.env,POKEMON_UI:'off',MCP_TRANSPORT:'stdio'}});
  const tools=(await session.client.listTools()).tools;
  const manifest=JSON.parse(await readFile(resolve(scratch,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.tools.map(t=>t.name),tools.map(t=>t.name));
  assert.deepEqual(JSON.parse(await readFile(resolve(root,'backend/manifest.json'),'utf8')).tools.map(t=>t.name),tools.map(t=>t.name));
  for(const tool of tools.filter(t=>t.name!=='learning')){
    const schemas=tool.inputSchema.oneOf||tool.inputSchema.anyOf||[tool.inputSchema];
    assert(schemas.every(schema=>schema.properties.task_id),'Missing task attribution for '+tool.name);
  }
  assert(session.client.getInstructions().includes('verbatim current user request'));
  const prompt=await session.client.getPrompt({name:'pokemon-work'});
  assert(prompt.messages[0].content.text.includes('learning begin'));
  for(const file of ['service','model','privacy','instrument','instructions']) assert((await readFile(resolve(root,`backend/dist/learning/${file}.js`))).length>0);
  console.log('PASS: built learning modules, package tool order, all attribution schemas and both client instructions are consistent.');
}finally{
  if(session)await session.client.close();
  const checked=await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-learning-contract-'));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
