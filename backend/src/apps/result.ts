import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {jsonResult} from '../utils/response.js';

export function applicationResult(result: Record<string, unknown>): CallToolResult {
	const data = result.data as Record<string, unknown> | undefined;
	if (result.method !== 'screen_capture' || typeof data?.image !== 'string') {
		return jsonResult(result);
	}

	const {image, ...metadata} = data;
	const described = jsonResult({...result, data: metadata});
	const mimeType = data.mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
	return {...described, content: [...described.content, {type: 'image', mimeType, data: image}]};
}
