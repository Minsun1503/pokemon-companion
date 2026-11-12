import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {cpus, release, tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalJournal} from '../backend/dist/learning/privacy.js';
import {jsonResult} from '../backend/dist/utils/response.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--baseline');
assert(arg >= 0 && process.argv[arg + 1], 'Pass --baseline <saved project with backend/dist and dependencies>.');
const baseline = resolve(process.argv[arg + 1]);
assert.notEqual(baseline.toLowerCase(), root.toLowerCase());
assert.notEqual(process.env.POKEMON_LEARNING, 'off', 'Run with learning enabled; only disposable profiles are used.');
const output = resolve(root, 'benchmarks/results/local-model-2026-11-12.json');
const scratch = await mkdtemp(resolve(tmpdir(), 'pokemon-local-model-bench-'));
const key = randomBytes(32), opened = [], modules = {}, hashes = {};
const topics = ['invoice', 'shipping', 'customer', 'inventory', 'payment', 'budget', 'report', 'appointment', 'meeting', 'travel', 'recipe', 'address', 'calendar', 'project', 'reminder', 'contact', 'account', 'ticket', 'reference', 'description', 'comment', 'message', 'schedule', 'purchase', 'request', 'supplier', 'employee', 'service', 'document', 'order', 'delivery', 'reservation'];
const phrases = topic => [`Type the ${topic} field`, `Enter ${topic} field please`, `Complete ${topic} entry`, `Write ${topic} information`, `Populate ${topic} details`, `Update the ${topic} input`, `Set the ${topic} textbox`, `Put ${topic} into the form`];
const quantile = (values, q) => {
  const sorted = values.toSorted((a, b) => a - b), index = (sorted.length - 1) * q;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
};
const summarize = samples => ({runs: samples.length, median_ms: quantile(samples.map(x => x.ms), .5), p95_ms: quantile(samples.map(x => x.ms), .95), cpu_ms: samples.reduce((sum, x) => sum + x.cpu_ms, 0), samples});
// Each sample is a fixed-size block, so timer resolution does not dominate tiny updates.
async function block(run, count) {
  const cpu = process.cpuUsage(), start = performance.now();
  for (let i = 0; i < count; i++) await run(i);
  const ms = (performance.now() - start) / count, used = process.cpuUsage(cpu);
  return {ms, cpu_ms: (used.user + used.system) / 1000, operations: count};
}
async function compare(arms, run, count, blocks = 10) {
  const samples = Object.fromEntries(arms.map(arm => [arm, []]));
  for (const arm of arms) await block(i => run(arm, i), 100);
  for (let round = 0; round < blocks; round++) {
    const order = round % 2 ? [...arms].reverse() : arms;
    for (const arm of order) samples[arm].push(await block(i => run(arm, i), count));
  }
  return Object.fromEntries(arms.map(arm => [arm, summarize(samples[arm])]));
}
const dense = vector => {
  const result = new Float64Array(2048);
  for (const k of Object.keys(vector)) result[Number(k)] = vector[k];
  return result;
};
function denseDot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
const logistic = logit => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, logit))));
function denseTrain(model, vector, label) {
  const gradient = (label - logistic(model.bias + denseDot(model.weights, dense(vector)))) * .4;
  for (const k of Object.keys(vector)) model.weights[Number(k)] = model.weights[Number(k)] * .999 + gradient * vector[k];
  model.bias = Math.max(-4, Math.min(4, model.bias + gradient));
  model.examples++;
}
function rank(arm, recipes, query) {
  const sparse = modules.before.model.features(query), vector = arm === 'dense' ? dense(sparse) : sparse;
  const keys = arm === 'prepared_sparse' || arm === 'context_only' ? Object.keys(sparse) : undefined;
  const dot = context => {
    let sum = 0;
    for (const key of keys) sum += sparse[key] * (context[key] ?? 0);
    return sum;
  };
  const scores = [];
  for (const recipe of recipes) {
    if (recipe.successes <= recipe.failures) continue;
    const match = Math.max(...recipe.contexts.map(context => arm === 'dense' ? denseDot(vector, context) : keys ? dot(context) : modules.after.model.similarity(vector, context)));
    if (match < .65) continue;
    const prediction = arm === 'context_only' ? 0 : arm === 'dense' ? logistic(recipe.model.bias + denseDot(recipe.model.weights, vector)) : keys ? logistic(recipe.model.bias + dot(recipe.model.weights)) : modules.after.model.predict(recipe.model, vector);
    scores.push({recipe_id: recipe.id, match_score: match, model_score: prediction});
  }
  return scores.sort((a, b) => (b.match_score + b.model_score * .2) - (a.match_score + a.model_score * .2)).slice(0, 3);
}
function compact(result) {
  return result.map(({recipe_id, match_score, model_score}) => ({recipe_id, match_score, model_score}));
}
async function profile(arm, name, state) {
  const directory = resolve(scratch, name), journal = new LocalJournal(directory, key);
  await journal.load();
  await journal.replace({kind: 'snapshot', state});
  await journal.close();
  const learning = new modules[arm].LocalLearning(directory, key);
  opened.push(learning);
  await learning.open();
  assert.deepEqual(await learning.export(), state, 'Existing version-1 snapshot must reopen unchanged.');
  return learning;
}

try {
  for (const [arm, project] of [['before', baseline], ['after', root]]) {
    const location = resolve(project, 'backend/dist/learning');
    modules[arm] = {model: await import(pathToFileURL(resolve(location, 'model.js')).href), ...await import(pathToFileURL(resolve(location, 'service.js')).href)};
    hashes[arm] = {};
    for (const file of ['model.js', 'service.js', 'privacy.js']) hashes[arm][file] = createHash('sha256').update(await readFile(resolve(location, file))).digest('hex');
  }
  assert.notEqual(hashes.before['model.js'], hashes.after['model.js']);
  const seeder = new modules.before.LocalLearning(resolve(scratch, 'seed'), key);
  opened.push(seeder);
  const seedSamples = [];
  for (const topic of topics) {
    for (const query of phrases(topic)) {
      const start = performance.now(), cpu = process.cpuUsage();
      const task = await seeder.begin(query, {text: 'sample'});
      const steps = [{action: 'get_windows', query: 'Model benchmark fixture'}, {action: 'get_ui', window_step: 0, query: `${topic} field`, control_type: 'Edit'}, {action: 'set_value', target_step: 1, text: 'sample'}, {action: 'get_ui', window_step: 0, query: `${topic} field`, control_type: 'Edit', expect_value: 'sample'}];
      await seeder.record(task.id, 'windows', {steps}, jsonResult({ok: true, completed: 4}), 1);
      await seeder.finish(task.id, 'met', 'Synthetic fixture result');
      await seeder.feedback(task.id, 'satisfied', 'explicit_user_report');
      const used = process.cpuUsage(cpu);
      seedSamples.push({ms: performance.now() - start, cpu_ms: (used.user + used.system) / 1000, operations: 1});
    }
  }
  const full = await seeder.export();
  assert.equal(Object.keys(full.recipes).length, 32);
  assert(Object.values(full.recipes).every(recipe => recipe.contexts.length === 8));
  assert(Buffer.byteLength(JSON.stringify(full)) <= 2 * 1024 * 1024);
  await seeder.close();
  const retrieval = [], candidateRetrieval = [];
  for (const count of [1, 8, 32]) {
    for (const contexts of [1, 8]) {
      const state = structuredClone(full);
      state.tasks = {};
      state.recipes = Object.fromEntries(Object.entries(state.recipes).slice(0, count));
      for (const recipe of Object.values(state.recipes)) {
        recipe.contexts = recipe.contexts.slice(0, contexts);
        recipe.model = {weights: {}, bias: 0, examples: 0};
        for (const vector of recipe.contexts) modules.before.model.train(recipe.model, vector, 1);
        recipe.successes = contexts;
      }
      const recipes = Object.values(state.recipes), denseRecipes = recipes.map(recipe => ({...recipe, contexts: recipe.contexts.map(dense), model: {...recipe.model, weights: dense(recipe.model.weights)}}));
      const services = {before: await profile('before', `before-${count}-${contexts}`, state), after: await profile('after', `after-${count}-${contexts}`, state)};
      const queries = topics.slice(0, count).flatMap(topic => [`Fill the ${topic} field now`, `Type ${topic} information please`]).concat(['Paint a watercolor landscape', 'Play chess against me']);
      for (const query of queries) {
        const before = compact(await services.before.suggest(query)), after = compact(await services.after.suggest(query));
        assert.deepEqual(after, before, 'Public suggestion scores and ordering must be identical.');
        assert.deepEqual(rank('sparse', recipes, query), after);
        assert.deepEqual(rank('prepared_sparse', recipes, query), after);
        assert.deepEqual(rank('dense', denseRecipes, query), after);
      }
      const measured = await compare(['before', 'after'], (arm, i) => services[arm].suggest(queries[i % queries.length]), 100);
      retrieval.push({recipes: count, contexts, ...measured});
      const candidates = await compare(['sparse', 'prepared_sparse', 'dense', 'context_only'], (arm, i) => rank(arm, arm === 'dense' ? denseRecipes : recipes, queries[i % queries.length]), 100);
      candidateRetrieval.push({recipes: count, contexts, dense_cache_bytes: denseRecipes.reduce((sum, recipe) => sum + recipe.model.weights.byteLength + recipe.contexts.reduce((n, v) => n + v.byteLength, 0), 0), ...candidates});
      await services.before.close(); await services.after.close();
      console.log(`Measured ${count} workflows x ${contexts} contexts`);
    }
  }
  const recipes = Object.values(full.recipes), denseRecipes = recipes.map(recipe => ({...recipe, contexts: recipe.contexts.map(dense), model: {...recipe.model, weights: dense(recipe.model.weights)}}));
  const services = {before: await profile('before', 'quality-before', full), after: await profile('after', 'quality-after', full)};
  const idToTopic = Object.fromEntries(recipes.map(recipe => [recipe.id, recipe.steps[1].query.replace(/ field$/, '')]));
  const cases = topics.flatMap(topic => [{group: 'supported_phrasing', query: `Fill the ${topic} field now`, expected: topic}, {group: 'supported_phrasing', query: `Type ${topic} information please`, expected: topic}]);
  cases.push(...[
    ['shipping', 'Change where the parcel goes'], ['customer', "Enter the client's name"], ['budget', 'Set how much money we can spend'], ['appointment', 'Book a visit with the doctor'], ['inventory', 'Update the stock count'], ['address', 'Enter the street and house number'], ['reminder', 'Add a notification for later'], ['reservation', 'Book a table for dinner'],
  ].map(([expected, query]) => ({group: 'semantic_paraphrase', query, expected})));
  cases.push(...topics.slice(0, 8).flatMap(topic => [{group: 'negation', query: `Do not type the ${topic} field`, expected: null}, {group: 'different_action', query: `Read the ${topic} field`, expected: null}]));
  cases.push(...['Paint a watercolor landscape', 'Play chess against me', 'What is the capital of France?', 'Explain quantum physics', 'Sing a lullaby', 'Solve this algebra equation'].map(query => ({group: 'unrelated', query, expected: null})));
  const evaluation = [];
  for (const item of cases) {
    const before = await services.before.suggest(item.query), after = await services.after.suggest(item.query);
    assert.deepEqual(after, before);
    const results = {before, after, dense: rank('dense', denseRecipes, item.query), context_only: rank('context_only', recipes, item.query)};
    evaluation.push({...item, results: Object.fromEntries(Object.entries(results).map(([arm, result]) => [arm, {actual: idToTopic[result[0]?.recipe_id] ?? null, correct: (idToTopic[result[0]?.recipe_id] ?? null) === item.expected, ranked_topics: result.map(x => idToTopic[x.recipe_id])}]))});
  }
  const quality = Object.fromEntries(['before', 'after', 'dense', 'context_only'].map(arm => [arm, Object.fromEntries([...new Set(cases.map(x => x.group))].map(group => {
    const rows = evaluation.filter(x => x.group === group);
    return [group, {correct: rows.filter(x => x.results[arm].correct).length, total: rows.length}];
  }))]));
  // A controlled tie isolates feedback-sensitive ranking from lexical similarity.
  const tieState = structuredClone(full);
  tieState.tasks = {};
  const tieVector = modules.before.model.features('Type the details field');
  const tied = recipes.slice(0, 2).map((recipe, index) => {
    const model = {weights: {}, bias: 0, examples: 0};
    for (const label of index ? [1, 1, 1, 1, 1] : [1, 1, 1, 0, 0]) modules.before.model.train(model, tieVector, label);
    return {...recipe, contexts: [tieVector], vector: tieVector, model, successes: index ? 5 : 3, failures: index ? 0 : 2};
  });
  tieState.recipes = Object.fromEntries(tied.map(recipe => [recipe.id, recipe]));
  const tieServices = {before: await profile('before', 'tie-before', tieState), after: await profile('after', 'tie-after', tieState)};
  const tieBefore = compact(await tieServices.before.suggest('Type the details field'));
  const tieAfter = compact(await tieServices.after.suggest('Type the details field'));
  assert.deepEqual(tieAfter, tieBefore);
  assert.equal(tieAfter[0].recipe_id, tied[1].id);
  const tieContext = rank('context_only', tied, 'Type the details field');
  assert.equal(tieContext[0].recipe_id, tied[0].id);
  const feedback_tie = {query: 'Type the details field', purpose: 'Equal cosine, two still-eligible workflows; rank the one with stronger model feedback first.', original_and_optimized: tieAfter.map(x => ({...x, topic: idToTopic[x.recipe_id]})), context_only: tieContext.map(x => ({...x, topic: idToTopic[x.recipe_id]})), preserved_by_context_only: false};
  // Mixed labels and varied inputs exercise growing weights, not only one repeated example.
  const vectors = topics.flatMap(topic => phrases(topic).map(modules.before.model.features));
  const trainingModels = {before: {weights: {}, bias: 0, examples: 0}, after: {weights: {}, bias: 0, examples: 0}, dense: {weights: new Float64Array(2048), bias: 0, examples: 0}};
  for (let i = 0; i < vectors.length; i++) {
    modules.before.model.train(trainingModels.before, vectors[i], i % 3 ? 1 : 0);
    modules.after.model.train(trainingModels.after, vectors[i], i % 3 ? 1 : 0);
    denseTrain(trainingModels.dense, vectors[i], i % 3 ? 1 : 0);
  }
  assert.deepEqual(trainingModels.after, trainingModels.before);
  assert.deepEqual(trainingModels.dense.weights, dense(trainingModels.before.weights));
  let update = 0;
  const training = await compare(['before', 'after', 'dense'], (arm, i) => {
    const vector = vectors[i % vectors.length];
    if (arm === 'dense') denseTrain(trainingModels[arm], vector, i % 3 ? 1 : 0);
    else modules[arm].model.train(trainingModels[arm], vector, i % 3 ? 1 : 0);
    update++;
  }, 1000);
  assert.deepEqual(trainingModels.after, trainingModels.before);
  assert.deepEqual(trainingModels.dense.weights, dense(trainingModels.before.weights));
  assert.equal(trainingModels.dense.bias, trainingModels.before.bias);
  assert.equal(trainingModels.dense.examples, trainingModels.before.examples);
  const endToEndModels = {before: {weights: {}, bias: 0, examples: 0}, after: {weights: {}, bias: 0, examples: 0}};
  const trainWithFeatures = await compare(['before', 'after'], (arm, i) => modules[arm].model.train(endToEndModels[arm], modules[arm].model.features(phrases(topics[i % topics.length])[i % 8]), i % 3 ? 1 : 0), 1000);
  assert.deepEqual(endToEndModels.after, endToEndModels.before);
  const featureExtraction = await compare(['before', 'after'], (arm, i) => modules[arm].model.features(phrases(topics[i % topics.length])[i % 8]), 1000);
  const filesBefore = await stat(resolve(scratch, 'quality-after/events.enc')), idleCpu = process.cpuUsage();
  await delay(2000);
  const used = process.cpuUsage(idleCpu), filesAfter = await stat(resolve(scratch, 'quality-after/events.enc'));
  assert.equal(filesAfter.mtimeMs, filesBefore.mtimeMs); assert.equal(filesAfter.size, filesBefore.size);
  const memory = {process: process.memoryUsage(), state_bytes: Buffer.byteLength(JSON.stringify(full)), sparse_model_json_bytes: Buffer.byteLength(JSON.stringify(recipes.map(x => ({contexts: x.contexts, model: x.model})))), dense_additional_cache_bytes: denseRecipes.reduce((sum, x) => sum + x.model.weights.byteLength + x.contexts.reduce((n, v) => n + v.byteLength, 0), 0)};
  const report = {created_at: new Date().toISOString(), environment: {cpu: cpus()[0].model, logical_cpus: cpus().length, node: process.version, os: release()}, hashes, fixture: {topics, phrases: topics.map(topic => phrases(topic)), recipes: 32, contexts: 8, state_sha256: createHash('sha256').update(JSON.stringify(full)).digest('hex')}, seed_training_with_journal: summarize(seedSamples), retrieval, candidate_retrieval: candidateRetrieval, training, training_with_features: trainWithFeatures, feature_extraction: featureExtraction, quality, evaluation, feedback_tie, parity: {public_suggestions: 'exact scores and order, all workload and evaluation queries, including feedback tie', training: 'exact sparse and dense weights, bias and examples after mixed-label updates', existing_journal: 'version-1 snapshots reopened unchanged by both implementations'}, memory, idle: {window_ms: 2000, cpu_ms: (used.user + used.system) / 1000, journal_changed: false}, limits: ['Synthetic disposable profiles; no real user quality dataset. Near-miss results demonstrate heuristic limits, not permission to execute.', 'Training samples are block averages, p95 is across block averages; not per-request tail latency. CPU includes harness and uses OS timer resolution.', 'Production before/after includes feature extraction and async service access; experimental candidate rows use one shared in-memory ranking harness. Compare only within a row.', 'Same-process counterbalanced blocks limit drift; GC, JIT and other apps still affect timings. Process memory includes all arms, dependencies and the harness; cache bytes are exact Float64Array buffers, JSON bytes are serialized sizes rather than heap usage.', 'Seed training includes encrypted persistence and synthetic test feedback, measured for baseline only; test key bypasses DPAPI.', 'Dense is Float64 for score compatibility, preserves the sparse journal and would need an extra cache. Context-only has no logistic training and changes feedback-sensitive ranking in the controlled tie.', 'fastText and transformer embeddings were researched only. A separate static-model report measures Model2Vec and BM25. No GPU, cloud model, network latency or native action execution measured.']};
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({retrieval: retrieval.map(({recipes, contexts, before, after}) => ({recipes, contexts, before: before.median_ms, after: after.median_ms})), training: Object.fromEntries(Object.entries(training).map(([arm, x]) => [arm, x.median_ms])), quality, memory, output, updates: update}, null, 2));
} finally {
  for (const learning of opened.reverse()) await learning.close();
  const checked = await realpath(scratch);
  assert.equal(dirname(checked).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-local-model-bench-'));
  await rm(checked, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
