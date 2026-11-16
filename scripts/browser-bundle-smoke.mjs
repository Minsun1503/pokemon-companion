import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connect} from './client.mjs';
import bundle from './verify-browser-bundle.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-browser-bundle-'));
let session;
try {
  session = await connect({args: [resolve(root, 'scripts/start-mcp.cjs')], env: {...process.env,
    // This host client authorizes only the owned loopback fixture used below.
    // Companion approval behavior is exercised separately by approval E2E.
    POKEMON_UI: 'off', POKEMON_LEARNING: 'off', POKEMON_AUTHORIZATION: 'host-client',
    PLAYWRIGHT_BROWSERS_PATH: resolve(scratch, 'empty-browser-cache'),
    POKEMON_WEB_PROFILE: resolve(scratch, 'app-browser-profile'),
    LOCALAPPDATA: resolve(scratch, 'localappdata'),
  }});
  await bundle.verifyBrowserBundle(session.client, root, scratch);
} finally {
  await session?.client.close();
  // Only this exact newly created temporary directory is removed.
  if (dirname(scratch) !== resolve(tmpdir())) throw new Error('Invalid browser smoke scratch path');
  await rm(scratch, {recursive: true, force: true});
}
