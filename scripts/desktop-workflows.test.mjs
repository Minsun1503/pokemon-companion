import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DesktopClient, formPlan} from './desktop-workflows.mjs';

const request = {kind: 'fill_form', query: 'Fill the form', window_query: 'Unique form', url: 'https://example.org/form',
  fields: [{query: 'Title', text: 'New title'}, {query: 'Description', text: 'Long description\n'.repeat(100)}]};
const response = data => ({content: [{type: 'text', text: JSON.stringify(data)}]});
function fixture({enabled = false, fail = false} = {}) {
  const calls = [], connections = [], closes = [];
  const client = new DesktopClient({connect: async () => {
    connections.push(1);
    return {client: {async callTool({name, arguments: args}) {
      calls.push({name, args});
      if (args.action === 'status') return response({enabled});
      if (args.action === 'begin') return response({task_id: 'verified-task-id'});
      if (name === 'windows') {
        if (fail) return {...response({ok: false, completed: 8, stopped_step: 8, retry_scope: 'stopped_step', error_details: {code: 'TIMEOUT'}}), isError: true};
        return response({ok: true, completed: args.steps.length, result: {text: request.fields.at(-1).text, verified: true}});
      }
      return response({ok: true});
    }, async close() {closes.push(1);}}};
  }});
  return {client, calls, connections, closes};
}

test('form preconditions precede every write, and every write has full readback', () => {
  const plan = formPlan(request), firstWrite = plan.findIndex(step => step.action === 'set_value');
  assert.equal(plan.length, 11);
  assert(plan.slice(0, firstWrite).filter(step => step.action === 'read_text').length === 3);
  assert.equal(plan.filter(step => step.action === 'set_value').length, 2);
  assert(!plan.some(step => ['invoke', 'launch', 'focus'].includes(step.action)));
  for (let i = firstWrite; i < plan.length; i += 2) {
    assert.equal(plan[i + 1].expect_text, plan[i].text);
    assert.equal(plan[i + 1].target_step, plan[i].target_step);
  }
});

test('invalid or ambiguous form specs fail before a connection starts', async () => {
  const f = fixture();
  for (const invalid of [{...request, fields: []}, {...request, fields: [request.fields[0], request.fields[0]]},
    {...request, url: 'file:///C:/secret'}, {...request, fields: [{query: 'Title', text: 'x'.repeat(8001)}]}]) {
    assert.equal((await f.client.fillForm(invalid)).verified, false);
  }
  assert.equal(f.connections.length, 0);
  await f.client.close();
});

test('sequential and queued requests reuse one connection and one learning status', async () => {
  const f = fixture();
  const reports = await Promise.all([f.client.fillForm(request), f.client.fillForm(request)]);
  assert(reports.every(report => report.verified && report.request_to_finished_ms >= report.request_to_verified_ms));
  assert.equal(f.connections.length, 1);
  assert.equal(f.calls.filter(call => call.args.action === 'status').length, 1);
  assert.deepEqual(reports.map(report => report.connection_reused), [false, true]);
  assert.equal(reports[1].connection_ms, 0);
  assert(reports.every(report => report.calls.every(call => call.elapsed_ms >= 0)));
  await f.client.close();
  assert.equal(f.closes.length, 1);
});

test('learning uses task_id and skips oversized parameters without inventing feedback', async () => {
  const f = fixture({enabled: true});
  assert((await f.client.fillForm(request)).verified);
  const begin = f.calls.find(call => call.args.action === 'begin');
  assert.deepEqual(begin.args.parameters, {field_0: 'New title'});
  assert.equal(f.calls.find(call => call.name === 'windows').args.task_id, 'verified-task-id');
  assert.equal(f.calls.find(call => call.args.action === 'finish').args.outcome, 'met');
  assert(!f.calls.some(call => call.args.action === 'feedback'));
  await f.client.close();
});

test('partial failure remains recorded and sends no second windows batch or done', async () => {
  const f = fixture({enabled: true, fail: true});
  const report = await f.client.fillForm(request);
  assert.equal(report.verified, false);
  assert.equal(report.failure.stopped_step, 8);
  assert.equal(f.calls.filter(call => call.name === 'windows').length, 1);
  assert(!f.calls.some(call => call.args.action === 'done'));
  assert.equal(f.calls.find(call => call.args.action === 'finish').args.outcome, 'unmet');
  await f.client.close();
});

test('closed clients cannot reopen a connection', async () => {
  const f = fixture();
  await f.client.close();
  assert.equal((await f.client.fillForm(request)).verified, false);
  assert.equal(f.connections.length, 0);
});
