import {expect, test} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../index.js';

test('MCP initialization keeps shared guidance within its context budget', async () => {
	const server = createServer();
	const client = new Client({name: 'guidance-budget-test', version: '1.0.0'});
	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const instructions = client.getInstructions();
		expect(instructions).toBeTruthy();
		expect(Buffer.byteLength(instructions!, 'utf8')).toBeLessThanOrEqual(3500);
	} finally {
		await client.close();
		await server.close();
	}
});
