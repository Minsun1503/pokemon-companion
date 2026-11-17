import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {cpus, release} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {auditOutcome, strengthSummary} from './strength-suite-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {runs: 20, commonRuns: 5, output: `benchmarks/results/strength-${new Date().toISOString().replaceAll(':', '-')}.json`};
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  assert(value, 'Every option requires a value.');
  if (flag === '--runs') options.runs = Number(value);
  else if (flag === '--common-runs') options.commonRuns = Number(value);
  else if (flag === '--window-id') options.windowId = value;
  else if (flag === '--output') options.output = value;
  else throw new Error('Options: --runs 5..100 --common-runs 1..50 --window-id ID --output NEW.json');
}
assert(Number.isInteger(options.runs) && options.runs >= 5 && options.runs <= 100);
assert(Number.isInteger(options.commonRuns) && options.commonRuns >= 1 && options.commonRuns <= 50);
assert(!options.windowId || /^[1-9]\d*$/.test(options.windowId));
assert(options.output.endsWith('.json'));
const output = resolve(root, options.output), evidence = output.slice(0, -5) + '-evidence';
const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await access(npmCli);
await mkdir(dirname(output), {recursive: true});
const report = {
  schema_version: 1, complete: false, started_at: new Date().toISOString(), options,
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()),
  harness_sha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  reporting_sha256: createHash('sha256').update(await readFile(resolve(root, 'scripts/strength-suite-lib.mjs'))).digest('hex'),
  environment: {platform: process.platform, os: release(), node: process.version, cpu: cpus()[0]?.model},
  checks: [],
  limits: ['Local implementation and deterministic execution checks, not an OSWorld/Windows Agent Arena score or an AI-model ranking.',
    'Native desktop checks run serially against owned fixtures. Optional common operations reuse an existing Edge profile and disposable Excel workbooks.',
    'npm audit reports known dependency advisories, including transitive dependencies; it does not demonstrate exploitability or constitute a penetration test.',
    'No model inference, user-request latency, long-duration soak, or non-Windows hardware validation is measured.'],
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
await mkdir(evidence); // Refuse to reuse a prior run's evidence directory.
const checkpoint = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');

async function run(name, args, {npm = false, cwd = root, audit = false, artifact} = {}) {
  const row = {name, command: [npm ? 'npm' : 'node', ...args], cwd, started_at: new Date().toISOString(), status: 'running'};
  report.checks.push(row); await checkpoint(); console.log(`START ${name}`);
  const start = performance.now();
  let stdout = '', stderr = '', spawnError;
  const child = spawn(process.execPath, npm ? [npmCli, ...args] : args, {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {stdout += chunk.toString();});
  child.stderr.on('data', chunk => {stderr += chunk.toString();});
  child.once('error', error => {spawnError = error.message;});
  const {code, signal} = await new Promise(done => child.once('close', (code, signal) => done({code, signal})));
  row.elapsed_ms = performance.now() - start; row.exit_code = code; row.signal = signal;
  row.stdout = resolve(evidence, name + '.stdout.txt'); row.stderr = resolve(evidence, name + '.stderr.txt');
  await writeFile(row.stdout, stdout, {flag: 'wx'}); await writeFile(row.stderr, stderr, {flag: 'wx'});
  row.status = code === 0 ? 'passed' : 'failed';
  if (spawnError) row.error = spawnError;
  if (audit) Object.assign(row, auditOutcome(stdout, code));
  if (artifact) {
    try {
      row.artifact = artifact;
      const data = JSON.parse(await readFile(artifact, 'utf8'));
      row.results = data.summary;
      if (name === 'common-operations') {
        row.measured_outcomes = Object.values(data.summary).reduce((counts, value) => {
          for (const key of ['scheduled', 'attempted', 'passed', 'failed', 'blocked', 'timed_out']) counts[key] += value[key];
          return counts;
        }, {scheduled: 0, attempted: 0, passed: 0, failed: 0, blocked: 0, timed_out: 0});
        if (!data.complete) row.status = 'failed';
        else if (code === 2) row.status = 'blocked';
        else if (!data.all_passed) row.status = 'failed';
      } else {
        row.verified_workflows = data.samples?.filter(sample => sample.verified).length;
        assert(row.verified_workflows === options.runs * 2 + 2, 'Missing verified workflow samples.');
      }
    } catch (error) {row.status = 'failed'; row.error = 'Benchmark evidence could not be validated: ' + error.message;}
  }
  await checkpoint(); console.log(`END ${name}: ${row.status} (${(row.elapsed_ms / 1000).toFixed(1)}s)`);
  if (row.status === 'failed') console.log((stderr || stdout || row.error || '').slice(-1800));
  return row;
}

try {
  await run('static-checks', ['run', 'check'], {npm: true});
  const build = await run('build', ['run', 'build'], {npm: true});
  await run('automated-tests', ['test'], {npm: true});
  if (build.status === 'passed') {
    await run('learning-contract', ['scripts/learning-contract-smoke.mjs']);
    await run('http-authentication', ['scripts/http-auth-smoke.mjs']);
    if (process.platform === 'win32') {
      await run('windows-contract', ['scripts/windows-contract-smoke.mjs']);
      await run('windows-identity', ['scripts/windows-identity-smoke.mjs']);
      await run('windows-coordination', ['scripts/windows-coordination-smoke.mjs']);
      for (const fixture of ['plain', 'nested']) {
        const artifact = resolve(evidence, 'windows-' + fixture + '.json');
        await run('windows-' + fixture, ['scripts/windows-benchmark.mjs', '--runs', String(options.runs), '--fixture', fixture, '--output', artifact], {artifact});
      }
      if (options.windowId) {
        const artifact = resolve(evidence, 'common-operations.json');
        await run('common-operations', ['scripts/common-task-benchmark.mjs', '--window-id', options.windowId, '--runs', String(options.commonRuns), '--output', artifact], {artifact});
      } else report.checks.push({name: 'common-operations', status: 'skipped', reason: 'Provide --window-id from Pokémon windows get_windows to include Edge/PDF/Excel operations.'});
    } else report.checks.push({name: 'native-windows', status: 'skipped', reason: 'Requires an unlocked Windows desktop.'});
  } else report.checks.push({name: 'built-runtime-checks', status: 'skipped', reason: 'Build failed; refusing to assess stale built files.'});
  for (const project of ['backend', 'frontend']) await run(project + '-production-audit', ['audit', '--omit=dev', '--json'], {npm: true, audit: true, cwd: resolve(root, project)});
  report.complete = true;
} catch (error) {
  report.error = error.message;
} finally {
  report.finished_at = new Date().toISOString();
  const result = strengthSummary(report.checks, report.complete);
  report.summary = result.summary; report.all_selected_checks_passed = result.all_selected_checks_passed;
  await checkpoint(); console.log(JSON.stringify({output, complete: report.complete, summary: report.summary, all_selected_checks_passed: report.all_selected_checks_passed}, null, 2));
  process.exitCode = result.exitCode;
}
