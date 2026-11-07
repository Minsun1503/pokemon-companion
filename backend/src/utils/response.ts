import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {serialize} from './timing.js';

export function jsonResult<T extends Record<string, unknown>>(data: T): CallToolResult & {structuredContent: T} {
	return {
		content: [{type: 'text', text: serialize(data, 2)}],
		structuredContent: data,
	};
}
