import {mkdirSync, copyFileSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/windows'), {recursive: true});
for (const file of ['uia-worker.cs', 'uia-worker.ps1', 'excel-worker.cs']) {
	copyFileSync(join(root, 'src/windows', file), join(root, 'dist/windows', file));
}

if (process.platform === 'win32') {
	const powershell = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
	execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(root, 'dist/windows/uia-worker.ps1'), '-CompileOnly'], {windowsHide: true, stdio: 'inherit'});
}
