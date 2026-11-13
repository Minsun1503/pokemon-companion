import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {cpus, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {LocalJournal} from '../backend/dist/learning/privacy.js';
import {jsonResult} from '../backend/dist/utils/response.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {output: 'benchmarks/results/local-ranker-2026-11-13.json'};
for (let i = 2; i < process.argv.length; i++) {
  assert(['--baseline', '--output'].includes(process.argv[i]));
  const key = process.argv[i].slice(2), value = process.argv[++i]; assert(value); options[key] = value;
}
assert(options.baseline && options.output.endsWith('.json'));
assert(process.env.POKEMON_LEARNING !== 'off');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-ranker-benchmark-'));
const key = randomBytes(32), opened = [], modules = {}, hashes = {};
let partial = {complete: false, measured_at: new Date().toISOString()};
const topics = ['invoice', 'shipping', 'customer', 'inventory', 'payment', 'budget', 'report', 'appointment', 'meeting', 'travel', 'recipe', 'address', 'calendar', 'project', 'reminder', 'contact', 'account', 'ticket', 'reference', 'description', 'comment', 'message', 'schedule', 'purchase', 'request', 'supplier', 'employee', 'service', 'document', 'order', 'delivery', 'reservation'];
const phrases = topic => [`Type the ${topic} field`, `Enter ${topic} field please`, `Complete ${topic} entry`, `Write ${topic} information`, `Populate ${topic} details`, `Update the ${topic} input`, `Set the ${topic} textbox`, `Put ${topic} into the form`];
const success = jsonResult({ok: true, completed: 4});
const plan = topic => [{action: 'get_windows', query: 'Ranker benchmark'}, {action: 'get_ui', window_step: 0, query: topic + ' field', control_type: 'Edit'},
  {action: 'set_value', target_step: 1, text: 'sample'}, {action: 'get_ui', window_step: 0, query: topic + ' field', control_type: 'Edit', expect_value: 'sample'}];
const distribution = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return {samples: values.length, median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1]};
};
async function seed(learning, query, topic) {
  const task = await learning.begin(query, {text: 'sample'});
  await learning.record(task.id, 'windows', {steps: plan(topic)}, success, 1);
  await learning.finish(task.id, 'met', 'Synthetic verified fixture');
  await learning.feedback(task.id, 'satisfied', 'explicit_user_report');
}
async function profile(arm, name, state) {
  const directory = resolve(scratch, name), journal = new LocalJournal(directory, key);
  await journal.load(); await journal.replace({kind: 'snapshot', state}); await journal.close();
  const service = new modules[arm].LocalLearning(directory, key); opened.push(service); await service.open();
  assert.deepEqual(await service.export(), state, 'Old snapshots must open without rewriting model data.');
  return {service, directory};
}
async function compare(services, queries) {
  const count = 100, blocks = 10, samples = {before: [], after: []};
  for (const arm of ['before', 'after']) for (let i = 0; i < count; i++) await services[arm].suggest(queries[i % queries.length]);
  for (let round = 0; round < blocks; round++) {
    for (const arm of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const cpu = process.cpuUsage(), start = performance.now();
      for (let i = 0; i < count; i++) await services[arm].suggest(queries[(round * count + i) % queries.length]);
      const used = process.cpuUsage(cpu);
      samples[arm].push({ms_per_lookup: (performance.now() - start) / count, cpu_ms: (used.user + used.system) / 1000, operations: count});
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([arm, rows]) => [arm, {...distribution(rows.map(row => row.ms_per_lookup)), cpu_ms: rows.reduce((sum, row) => sum + row.cpu_ms, 0), raw_blocks: rows}]));
}
try {
  for (const [arm, project] of [['before', resolve(options.baseline)], ['after', root]]) {
    const location = resolve(project, 'backend/dist/learning');
    modules[arm] = {...await import(pathToFileURL(resolve(location, 'service.js')).href), model: await import(pathToFileURL(resolve(location, 'model.js')).href)};
    hashes[arm] = {};
    for (const file of ['model.js', 'service.js']) hashes[arm][file] = createHash('sha256').update(await readFile(resolve(location, file))).digest('hex');
  }
  hashes.after['reuse.js'] = createHash('sha256').update(await readFile(resolve(root, 'backend/dist/learning/reuse.js'))).digest('hex');
  assert.equal(hashes.before['model.js'], hashes.after['model.js'], 'Persisted feature extraction and SGD must remain identical.');
  const seeder = new modules.before.LocalLearning(resolve(scratch, 'seed'), key); opened.push(seeder);
  for (const topic of topics) for (const query of phrases(topic)) await seed(seeder, query, topic);
  const state = await seeder.export(); await seeder.close();
  assert.equal(Object.keys(state.recipes).length, 32);
  assert(Object.values(state.recipes).every(recipe => recipe.contexts.length === 8));
  const profiles = {before: await profile('before', 'quality-before', state), after: await profile('after', 'quality-after', state)};
  const services = Object.fromEntries(Object.entries(profiles).map(([arm, value]) => [arm, value.service]));
  const idToTopic = Object.fromEntries(Object.values(state.recipes).map(recipe => [recipe.id, recipe.steps[1].query.replace(/ field$/, '')]));
  const cases = topics.flatMap(topic => [{group: 'supported', query: `Fill the ${topic} field now`, expected: topic}, {group: 'supported', query: `Type ${topic} information please`, expected: topic},
    {group: 'vietnamese_alias', query: `Nhập ${topic} field`, expected: topic}]);
  for (const topic of topics.slice(0, 8)) {
    for (const prefix of ['Do not type', "Don't type", 'Never type']) cases.push({group: 'negation_english', query: `${prefix} the ${topic} field`, expected: null});
    for (const prefix of ['Đừng nhập', 'Không nhập']) cases.push({group: 'negation_vietnamese', query: `${prefix} ${topic} field`, expected: null});
    for (const verb of ['Read', 'Delete', 'Send', 'Open']) cases.push({group: 'different_action', query: `${verb} the ${topic} field`, expected: null});
    cases.push({group: 'incomplete_multi_action', query: `Read the ${topic} field and type a note`, expected: null});
    cases.push({group: 'quoted_text', query: `Type the ${topic} field with text "do not type"`, expected: topic});
  }
  cases.push(...['Paint a watercolor landscape', 'Play chess against me', 'What is the capital of France?', 'Explain quantum physics', 'Sing a lullaby', 'Solve this algebra equation'].map(query => ({group: 'unrelated', query, expected: null})));
  cases.push(...[['shipping', 'Change where the parcel goes'], ['customer', "Enter the client's name"], ['budget', 'Set how much money we can spend'], ['appointment', 'Book a visit with the doctor'], ['inventory', 'Update the stock count'], ['address', 'Enter the street and house number'], ['reminder', 'Add a notification for later'], ['reservation', 'Book a table for dinner']].map(([expected, query]) => ({group: 'unlearned_semantics', query, expected})));
  const evaluation = [];
  for (const item of cases) {
    const result = {};
    for (const arm of ['before', 'after']) {
      const suggestions = await services[arm].suggest(item.query), actual = idToTopic[suggestions[0]?.recipe_id] ?? null;
      result[arm] = {actual, correct: actual === item.expected, suggested: suggestions.length, ranked_topics: suggestions.map(row => idToTopic[row.recipe_id])};
    }
    evaluation.push({...item, ...result});
  }
  const quality = Object.fromEntries(['before', 'after'].map(arm => [arm, Object.fromEntries([...new Set(cases.map(row => row.group))].map(group => {
    const rows = evaluation.filter(row => row.group === group);
    return [group, {correct: rows.filter(row => row[arm].correct).length, total: rows.length}];
  }))]));
  // Positive matching must retain exact scores/order, not merely top-1 accuracy.
  for (const item of cases.filter(row => ['supported', 'vietnamese_alias', 'quoted_text'].includes(row.group))) {
    assert.deepEqual(await services.after.suggest(item.query), await services.before.suggest(item.query));
  }
  const latency = {};
  for (const [name, queries] of [['positive', cases.filter(row => row.group === 'supported').map(row => row.query)],
    ['rejected', cases.filter(row => ['different_action', 'negation_english'].includes(row.group)).map(row => row.query)], ['mixed', cases.map(row => row.query)]]) {
    latency[name] = await compare(services, queries);
  }
  const feedback = {};
  partial = {...partial, hashes, quality, evaluation, latency, feedback};
  for (const arm of ['before', 'after']) {
    const service = services[arm], query = 'Type the invoice field quickly';
    const recipe = (await service.suggest(query))[0]; assert(recipe);
    const current = await service.begin(query, {text: 'sample'}), preview = await service.preview(current.id, recipe.recipe_id, {text: 'sample'});
    await service.consume(current.id, preview.preview_id); await service.record(current.id, 'windows', {steps: plan('invoice')}, success, 1);
    await service.finish(current.id, 'met', 'Synthetic task with negative test feedback'); await service.feedback(current.id, 'unsatisfied', 'explicit_user_report');
    const rejected_again = (await service.suggest(query)).length > 0;
    const successful_still_available = (await service.suggest('Type the invoice field')).length > 0;
    await service.close();
    const restored = new modules[arm].LocalLearning(profiles[arm].directory, key); opened.push(restored); await restored.open();
    const rejected_after_restart = (await restored.suggest(query)).length > 0;
    await restored.feedback(current.id, 'satisfied', 'explicit_user_report');
    const corrected_available = (await restored.suggest(query)).length > 0;
    const serialized = await restored.export();
    assert(Buffer.byteLength(JSON.stringify(serialized)) <= 2 * 1024 * 1024);
    feedback[arm] = {rejected_query_suggested_again: rejected_again, rejected_query_suggested_after_restart: rejected_after_restart,
      successful_still_available, corrected_available, state_bytes: Buffer.byteLength(JSON.stringify(serialized))};
  }
  assert(!feedback.after.rejected_query_suggested_again && !feedback.after.rejected_query_suggested_after_restart);
  assert(feedback.after.successful_still_available && feedback.after.corrected_available);
  const report = {complete: true, measured_at: new Date().toISOString(), environment: {cpu: cpus()[0].model, node: process.version},
    hashes, harness_sha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    fixture: {recipes: 32, contexts_each: 8, case_count: cases.length, state_sha256: createHash('sha256').update(JSON.stringify(state)).digest('hex')},
    quality, evaluation, latency, feedback,
    compatibility: {legacy_snapshot_unchanged: true, positive_scores_and_order_unchanged: true, feature_extraction_and_sgd_unchanged: true},
    limits: ['Synthetic regression corpus expanded from the previous known failure cases; not a blind representative user evaluation or threshold tuning experiment.',
      'English/Vietnamese action and negation vocabularies are conservative lexical hints, not general multilingual understanding. Unlearned semantic paraphrases remain unsupported.',
      'Latency reports ten counterbalanced block averages per arm, 100 lookups/block; p95 is across averages, not individual-request tail latency.',
      'Disposable encrypted profiles and synthetic test ratings only; the user learning profile is not read or modified. Test keys bypass DPAPI.',
      'No GPU, pretrained embedding runtime, cloud inference or UI execution is measured. Existing current-intent review and fresh-target checks remain necessary.']};
  const output = resolve(root, options.output); await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const table = Object.keys(quality.before).map(group => `| ${group} | ${quality.before[group].correct}/${quality.before[group].total} | ${quality.after[group].correct}/${quality.after[group].total} |`);
  const times = Object.entries(latency).map(([name, row]) => `| ${name} | ${row.before.median_ms.toFixed(4)} | ${row.after.median_ms.toFixed(4)} |`);
  await writeFile(output.replace(/\.json$/, '.md'), '# Local workflow ranker comparison\n\nAll measurements complete.\n\n| Case group | Before correct | After correct |\n| --- | ---: | ---: |\n' + table.join('\n')
    + '\n\n| Lookup workload | Before ms | After ms |\n| --- | ---: | ---: |\n' + times.join('\n') + '\n\nFeedback and restart checks: `' + JSON.stringify(feedback) + '`\n\n' + report.limits.join('\n\n') + '\n');
  console.log(JSON.stringify({quality, latency: Object.fromEntries(Object.entries(latency).map(([name, row]) => [name, {before: row.before.median_ms, after: row.after.median_ms}])), feedback, output}, null, 2));
} catch (error) {
  const output = resolve(root, options.output); await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify({...partial, error: error.stack || error.message}, null, 2) + '\n');
  throw error;
} finally {
  for (const service of opened.reverse()) await service.close();
  const checked = await realpath(scratch); assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-ranker-benchmark-')); await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
