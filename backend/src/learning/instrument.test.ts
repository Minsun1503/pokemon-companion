import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {expect, it, vi} from 'vitest';
import {courseSchema} from '../windows/course.js';
import {excelSchema} from '../windows/excel.js';
import {jsonResult} from '../utils/response.js';
import {instrument} from './instrument.js';
import {LocalLearning} from './service.js';

it('preserves refined Course/Excel validation and records only delivered handler calls', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'pokemon-instrument-test-'));
	const learning = new LocalLearning(directory, randomBytes(32));
	const server = new McpServer({name: 'instrument-test', version: '1'});
	const client = new Client({name: 'test', version: '1'});
	const course = vi.fn(async (args: Record<string, unknown>) => jsonResult({ok: true, action: args.action}));
	const excel = vi.fn(async (args: Record<string, unknown>) => ({...jsonResult({ok: false, action: args.action, error_details: {code: 'UNSUPPORTED'}}), isError: true}));
	const traced = instrument(server, learning);
	traced.registerTool('course', {inputSchema: courseSchema}, course);
	traced.registerTool('excel', {inputSchema: excelSchema}, excel);
	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const advertised = (await client.listTools()).tools;
		expect(advertised.find((tool) => tool.name === 'course')?.inputSchema.properties).toHaveProperty('task_id');
		expect(advertised.find((tool) => tool.name === 'excel')?.inputSchema.properties).toHaveProperty('range');
		const task = await learning.begin('Read course and workbook', {});
		const base = {task_id: task.id, window_id: '123'};
		await client.callTool({name: 'excel', arguments: {...base, action: 'inspect_workbook'}});
		expect(excel.mock.calls[0]?.[0]).not.toHaveProperty('offset');
		expect(excel.mock.calls[0]?.[0]).not.toHaveProperty('require_empty');
		const badPage = await client.callTool({
			name: 'course', arguments: {
				...base, action: 'read_lesson', document_name: 'Lesson', offset: 1,
			},
		});
		expect(badPage.isError).toBe(true);
		expect(course).not.toHaveBeenCalled();
		const badWrite = await client.callTool({
			name: 'excel', arguments: {
				...base, action: 'write_range', workbook_name: 'Test.xlsx', sheet: 'Sheet1', range: 'A1:B1', data: [['one']], require_empty: false,
			},
		});
		expect(badWrite.isError).toBe(true);
		expect(excel).toHaveBeenCalledTimes(1);
		await client.callTool({name: 'course', arguments: {...base, action: 'read_lesson', document_name: 'Lesson'}});
		expect(course.mock.calls[0]?.[0]).not.toHaveProperty('task_id');
		await client.callTool({
			name: 'excel', arguments: {
				...base, action: 'read_range', workbook_name: 'Test.xlsx', sheet: 'Sheet1', range: '$a$1',
			},
		});
		expect(excel.mock.calls[1]?.[0]).toHaveProperty('range', 'A1');
		const stats = await learning.stats();
		expect(stats.api_counts['course.read_lesson']).toEqual({successes: 1, failures: 0});
		expect(stats.api_counts['excel.read_range']).toEqual({successes: 0, failures: 1});
		await learning.finish(task.id, 'unknown', 'No outcome inferred');
		await client.callTool({name: 'course', arguments: {...base, action: 'read_lesson', document_name: 'Lesson'}});
		expect(course).toHaveBeenCalledTimes(1);
	} finally {
		await client.close();
		await server.close();
		await learning.close();
		await rm(directory, {recursive: true, force: true});
	}
});
