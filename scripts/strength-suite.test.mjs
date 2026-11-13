import assert from 'node:assert/strict';
import test from 'node:test';
import {auditOutcome, strengthSummary} from './strength-suite-lib.mjs';

const audit = (changes = {}) => JSON.stringify({metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...changes}}});

test('an audit passes only with valid clean evidence and a successful process', () => {
  assert.equal(auditOutcome(audit(), 0).status, 'passed');
  assert.equal(auditOutcome(audit(), 1).status, 'failed');
  assert.equal(auditOutcome(audit(), null).status, 'failed');
  assert.equal(auditOutcome(audit(), 3).status, 'failed');
});

test('known vulnerabilities remain findings even if a process returns zero', () => {
  for (const code of [0, 1]) {
    const result = auditOutcome(audit({high: 1, total: 1}), code);
    assert.equal(result.status, 'findings');
    assert.equal(result.vulnerabilities.high, 1);
  }
});

test('malformed or incomplete audit evidence cannot become a clean result', () => {
  for (const text of ['not JSON', '{}', audit({total: 1}), audit({high: -1, total: -1}), audit({high: '1', total: 1})]) {
    assert.equal(auditOutcome(text, 0).status, 'failed');
  }
});

test('suite completion distinguishes failures, findings, blocks, skips and interruption', () => {
  const passed = {status: 'passed'};
  assert.equal(strengthSummary([passed], true).exitCode, 0);
  assert.equal(strengthSummary([passed, {status: 'skipped'}], true).all_selected_checks_passed, true);
  for (const status of ['failed', 'running', 'unknown']) {
    const result = strengthSummary([passed, {status}], true);
    assert.equal(result.exitCode, 1); assert.equal(result.all_selected_checks_passed, false);
  }
  for (const status of ['findings', 'blocked']) {
    const result = strengthSummary([passed, {status}], true);
    assert.equal(result.exitCode, 2); assert.equal(result.all_selected_checks_passed, false);
  }
  assert.equal(strengthSummary([passed], false).exitCode, 1);
  assert.equal(strengthSummary([], true).all_selected_checks_passed, false);
  assert.equal(strengthSummary([{status: 'skipped'}], true).exitCode, 1);
});
