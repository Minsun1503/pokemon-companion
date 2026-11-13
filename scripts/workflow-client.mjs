import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FileJobStore, runWorkflow} from './workflow-controller.mjs';
import {githubToken, GitHubWorkflowAdapter} from './github-workflow-adapter.mjs';

const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--request', '--job', '--report'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: workflow-client.mjs --request request.json --job job.json [--report report.json]');
  if (options[args[index]]) throw new Error('Duplicate option.');
  options[args[index]] = resolve(args[index + 1]);
}
if (!options['--request'] || !options['--job']) throw new Error('Supply --request and --job. Run again with the same files to resume.');
if (new Set(Object.values(options)).size !== Object.values(options).length) throw new Error('Request, journal and report must use distinct paths.');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort('pause'));
process.once('SIGTERM', () => controller.abort('cancel'));
let lastProgress = 0;
try {
  const request = JSON.parse(await readFile(options['--request'], 'utf8'));
  const token = await githubToken();
  const job = await runWorkflow(request, {adapter: new GitHubWorkflowAdapter({token, signal: controller.signal}),
    store: new FileJobStore(options['--job']), signal: controller.signal,
    onProgress: progress => {if (Date.now() - lastProgress > 30000) {process.stderr.write(JSON.stringify(progress) + '\n'); lastProgress = Date.now();}}});
  if (options['--report']) await writeFile(options['--report'], JSON.stringify(job, null, 2) + '\n');
  console.log(JSON.stringify({id: job.id, status: job.status, phase: job.phase, pr_url: job.pr_url, merge_sha: job.merge_sha,
    request_to_verified_ms: job.request_to_verified_ms, request_to_recorded_ms: job.request_to_recorded_ms, error: job.error, journal: options['--job']}));
  if (job.status !== 'complete') process.exitCode = 1;
} catch (error) {console.error(error.message); process.exitCode = 1;}
