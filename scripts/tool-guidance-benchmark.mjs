import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createServer} from '../backend/dist/index.js';

const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
if (outputIndex >= 0 && !output) throw new Error('Provide a JSON path after --output.');
const server = createServer();
const client = new Client({name: 'tool-guidance-benchmark', version: '1.0.0'});
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const catalog = await client.listTools();
  const instructions = client.getInstructions() || '';
  const contracts = catalog.tools.map(({description, ...contract}) => contract);
  const result = {
    transport: 'InMemoryTransport',
    tools: catalog.tools.length,
    instructionCharacters: instructions.length,
    instructionUtf8Bytes: Buffer.byteLength(instructions),
    toolCatalogUtf8Bytes: Buffer.byteLength(JSON.stringify(catalog)),
    contractSha256: createHash('sha256').update(JSON.stringify(contracts)).digest('hex'),
    clientExpandedInstructionsCharacters: catalog.tools.length * instructions.trimEnd().length,
    limits: ['Character/byte counts, not tokenizer counts or model latency.', 'Client-expanded size mirrors the observed eight-tool client; other clients may expose instructions differently.'],
  };
  if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
  await server.close();
}
