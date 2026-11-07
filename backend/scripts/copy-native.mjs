import {mkdirSync, copyFileSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/windows'), {recursive: true});
for (const file of ['uia-worker.cs', 'uia-worker.ps1']) {
	copyFileSync(join(root, 'src/windows', file), join(root, 'dist/windows', file));
}
