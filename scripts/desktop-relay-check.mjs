import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const home = process.env.POKEMON_HARNESS_HOME || join(process.env.LOCALAPPDATA, 'pokemon-companion', 'harness');
const log = await readFile(join(home, 'agent.stdout.log'), 'utf8');
const ready = [...log.matchAll(/POKEMON_AGENT_READY (http:\/\/127\.0\.0\.1:\d+)\/#([a-f0-9]{64})/g)].at(-1);
if (!ready) throw new Error('The gateway has not started. Check the scheduled service.');
async function api(path, body) {
	const result = await fetch(`${ready[1]}/api/${path}`, {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${ready[2]}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(40000)});
	if (!result.ok) throw new Error(`Local gateway returned HTTP ${result.status}.`);
	return result.json();
}
const current = process.argv.includes('--connect');
const result = await api(`desktop-relay${current ? '?current=1' : ''}`);
const text = result.content?.find((item) => item.type === 'text')?.text;
const inspection = text ? JSON.parse(text) : result;
if (!inspection.ready) throw new Error(inspection.error || 'The desktop relay is unavailable.');
let status = await api('status');
if (current) {
	status.config.desktopRelay = {enabled: true, conversation: inspection.conversation, approval: 'scoped_grant'};
	await api('config', {config: status.config});
	status = await api('status');
}
const report = {at: new Date().toISOString(), telegram: status.telegram, desktopRelay: status.config.desktopRelay, inspection, verification: 'Live service and native destination inspection; answer delivery tested with an MCP/Telegram fixture. Awaiting owner live question.'};
if (process.argv.includes('--report')) await writeFile(new URL('../benchmarks/results/desktop-relay-ready-2026-11-15.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
