import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {connect} from './client.mjs';

const boundedString = (value, name, max, empty = true) => {
  assert(typeof value === 'string' && value.length <= max && (empty || value.trim()), `${name} must be a ${empty ? '' : 'nonempty '}string of at most ${max} characters.`);
  return value;
};

/** A reviewed form template: fresh discovery, overwrite checks, one write per field, full readback. */
export function formPlan(request) {
  assert(request && request.kind === 'fill_form', 'Only kind=fill_form is supported.');
  boundedString(request.query, 'query', 4096, false);
  boundedString(request.window_query, 'window_query', 200, false);
  assert(Array.isArray(request.fields) && request.fields.length >= 1 && request.fields.length <= 3, 'Supply 1–3 fields.');
  const timeout = request.timeout_ms ?? 5000;
  assert(Number.isInteger(timeout) && timeout >= 1 && timeout <= 15000, 'timeout_ms must be 1–15000.');
  const steps = [{action: 'get_windows', query: request.window_query, max_chars: 8000}];
  if (request.url !== undefined) {
    boundedString(request.url, 'url', 8000, false);
    const url = new URL(request.url);
    assert(['http:', 'https:'].includes(url.protocol), 'Expected URL must use http or https.');
    steps.push({action: 'get_ui', window_step: 0, query: boundedString(request.url_query ?? 'Address and search bar', 'url_query', 200, false), control_type: 'Edit', max_depth: 30});
    steps.push({action: 'read_text', target_step: 1, expect_text: request.url, timeout_ms: 1_000, max_chars: 16000});
  }
  if (request.scroll !== undefined) {
    boundedString(request.scroll.query, 'scroll.query', 200, false);
    assert(['up', 'down'].includes(request.scroll.direction), 'scroll.direction must be up or down.');
    const count = request.scroll.count ?? 1;
    assert(Number.isInteger(count) && count >= 1 && count <= 3, 'scroll.count must be 1–3.');
    const target = steps.length;
    steps.push({action: 'get_ui', window_step: 0, query: request.scroll.query, max_depth: 30, max_chars: 8000});
    for (let index = 0; index < count; index++) steps.push({action: 'scroll', target_step: target, direction: request.scroll.direction});
  }
  const queries = new Set();
  const targets = [];
  for (const field of request.fields) {
    boundedString(field.query, 'field.query', 200, false);
    boundedString(field.text, 'field.text', 8000);
    boundedString(field.expected_before ?? '', 'field.expected_before', 8000);
    assert(!queries.has(field.query.toLowerCase()), 'Field queries must be unique.');
    queries.add(field.query.toLowerCase());
    const target = steps.length;
    targets.push(target);
    steps.push({action: 'wait_for', window_step: 0, query: field.query, control_type: 'Edit', timeout_ms: timeout, max_depth: 30, max_chars: 8000});
    // Check every field before the first write, so an overwrite conflict sends no field input.
    steps.push({action: 'read_text', target_step: target, expect_text: field.expected_before ?? '', timeout_ms: 1000, max_chars: 16000});
  }
  for (const [index, field] of request.fields.entries()) {
    steps.push({action: 'set_value', target_step: targets[index], text: field.text});
    steps.push({action: 'read_text', target_step: targets[index], expect_text: field.text, timeout_ms: timeout, max_chars: 16000});
  }
  assert(steps.length <= 16, 'Form exceeds the 16-step batch limit.');
  return steps;
}

export class DesktopClient {
  constructor(options = {}) {
    this.options = options;
    this.tail = Promise.resolve();
    this.closed = false;
  }

  /** Serialize requests and keep the same MCP server/native worker alive between tasks. */
  fillForm(request) {
    const received = performance.now(), receivedAt = new Date().toISOString();
    const work = this.tail.then(() => this.runForm(request, received, receivedAt));
    this.tail = work.catch(() => undefined);
    return work;
  }

  async runForm(request, received, receivedAt) {
    const report = {schema_version: 1, kind: 'fill_form', request_received_at: receivedAt, verified: false,
      connection_reused: Boolean(this.session), queue_ms: performance.now() - received, calls: [],
      boundary: 'Structured request accepted by DesktopClient to verified full field readback. Includes validation, cold MCP connection/native startup, learning setup and readback polling. Excludes agent inference, request generation and Node/module startup. No form submission.'};
    let taskId;
    let finishAttempted = false;
    let previousFinished;
    const call = async (name, args) => {
      const start = performance.now();
      report.first_tool_started_ms ??= start - received;
      const timing = {tool: name, action: args.action ?? 'batch', started_ms: start - received,
        client_gap_ms: previousFinished === undefined ? null : start - previousFinished};
      report.calls.push(timing);
      try {
        const result = await this.session.client.callTool({name, arguments: {...args, ...(taskId && name !== 'learning' ? {task_id: taskId} : {})}}, undefined, {timeout: 120000});
        const body = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        let data;
        try {data = JSON.parse(body);}
        catch {throw new Error(result.isError ? body : 'MCP returned an unexpected non-JSON response.');}
        if (result.isError || data.ok === false) {
          const error = new Error(data.error ?? 'MCP operation failed.');
          error.details = data;
          throw error;
        }
        timing.ok = true;
        return data;
      } catch (error) {
        timing.ok = false;
        throw error;
      } finally {
        previousFinished = performance.now();
        timing.elapsed_ms = previousFinished - start;
      }
    };
    try {
      assert(!this.closed, 'Desktop client is closed.');
      const steps = formPlan(request);
      if (!this.session) {
        const start = performance.now();
        this.session = await (this.options.connect ?? connect)(this.options.connection ?? {});
        report.connection_ms = performance.now() - start;
      } else report.connection_ms = 0;
      // Cache session capability once. Do not replace the user's profile for ordinary tasks.
      if (this.learningEnabled === undefined) this.learningEnabled = (await call('learning', {action: 'status'})).enabled;
      if (this.learningEnabled) {
        const parameters = {};
        request.fields.forEach((field, index) => {if (field.text.length <= 1000) parameters['field_' + index] = field.text;});
        const begun = await call('learning', {action: 'begin', query: request.query, parameters});
        assert(typeof begun.task_id === 'string', 'learning begin did not return task_id.');
        taskId = begun.task_id;
      }
      await call('pokemon', {action: 'task', message: 'Filling and verifying form fields'});
      const result = await call('windows', {steps, max_chars: 16000});
      assert(result.ok && result.completed === steps.length && result.result?.verified && !result.truncated && !result.result.truncated, 'Complete field verification was not returned.');
      report.verified = true;
      report.verified_at = new Date().toISOString();
      report.request_to_verified_ms = performance.now() - received;
      report.field_count = request.fields.length;
      report.completed_steps = result.completed;
      await call('pokemon', {action: 'done', message: 'Form fields verified; form remains unsubmitted'});
      if (taskId) {
        finishAttempted = true;
        await call('learning', {action: 'finish', task_id: taskId, outcome: 'met', summary: 'Every field fully read back and matched. Form not submitted. User satisfaction unknown.'});
      }
    } catch (error) {
      report.error = error.message;
      if (error.details) {
        const {completed, stopped_step, retry_scope, error_details} = error.details;
        report.failure = {completed, stopped_step, retry_scope, error_details};
      }
      if (taskId && !finishAttempted) {
        try {await call('learning', {action: 'finish', task_id: taskId, outcome: report.verified ? 'met' : 'unmet', summary: 'Form workflow stopped. Earlier inputs, if any, were not replayed. User satisfaction unknown.'});}
        catch (finishError) {report.finish_error = finishError.message;}
      }
    }
    report.completed_at = new Date().toISOString();
    report.request_to_finished_ms = performance.now() - received;
    report.tool_call_ms = report.calls.reduce((sum, entry) => sum + entry.elapsed_ms, 0);
    return report;
  }

  async close() {
    this.closing ??= (async () => {
      await this.tail;
      this.closed = true;
      if (this.session) await this.session.client.close();
    })();
    await this.closing;
  }
}
