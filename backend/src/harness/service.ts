import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);
export const serviceTaskName = 'Pokemon Agent Telegram';

async function powershell(script: string) {
	const {stdout} = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {windowsHide: true, timeout: 60000});
	return stdout.trim();
}

function requireWindows() {
	if (process.platform !== 'win32') {
		throw new Error('Chạy nền tự động hiện chỉ hỗ trợ Windows. Trên macOS/Linux, chạy npm run agent -- gateway trong một phiên luôn mở.');
	}
}

const quote = (value: string) => `'${value.replaceAll('\'', '\'\'')}'`;

/** Windows Scheduled Task at logon, like `hermes gateway install`. */
export async function installService(root: string) {
	requireWindows();
	await powershell(`& ${quote(join(root, 'scripts', 'install-agent-autostart.ps1'))}`);
	await powershell(`Start-ScheduledTask -TaskName ${quote(serviceTaskName)}`);
	return 'Đã cài và khởi động gateway chạy nền (Scheduled Task "Pokemon Agent Telegram", tự chạy khi đăng nhập).';
}

export async function uninstallService() {
	requireWindows();
	await powershell(`$t = Get-ScheduledTask -TaskName ${quote(serviceTaskName)} -ErrorAction SilentlyContinue; if ($t) { Stop-ScheduledTask -TaskName ${quote(serviceTaskName)} -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; ${stopGatewayProcess}; Unregister-ScheduledTask -TaskName ${quote(serviceTaskName)} -Confirm:$false }`);
	return 'Đã gỡ gateway chạy nền.';
}

// Stopping the task ends its PowerShell wrapper; also end the gateway Node child so it releases the store lock.
const stopGatewayProcess = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'harness\\.cjs"?\\s+(gateway|run)\\s*$\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

export async function controlService(action: 'start' | 'stop') {
	requireWindows();
	await powershell(action === 'start'
		? `Start-ScheduledTask -TaskName ${quote(serviceTaskName)}`
		: `Stop-ScheduledTask -TaskName ${quote(serviceTaskName)}; Start-Sleep -Seconds 2; ${stopGatewayProcess}`);
	return action === 'start' ? 'Đã khởi động gateway chạy nền.' : 'Đã dừng gateway chạy nền.';
}

export async function serviceState() {
	if (process.platform !== 'win32') {
		return 'not supported';
	}

	try {
		return await powershell(`$t = Get-ScheduledTask -TaskName ${quote(serviceTaskName)} -ErrorAction SilentlyContinue; if ($t) { [string]$t.State } else { 'not installed' }`) || 'not installed';
	} catch {
		return 'unknown';
	}
}
