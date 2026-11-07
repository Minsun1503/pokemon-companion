import { Client } from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export async function connect(options = {}) {
  const root = options.root || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({name: 'pokemon-local-demo', version: '0.1.0'});
  const transport = new StdioClientTransport({command: options.command || process.execPath, args: [resolve(root, 'backend/dist/main.js')], stderr: 'inherit'});
  await client.connect(transport);
  const call = async (name, args) => {
    const result = await client.callTool({name, arguments: args});
    if (result.isError) throw new Error(result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
    return result;
  };
  return {client, call, root};
}
