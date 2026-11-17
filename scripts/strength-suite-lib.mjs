import assert from 'node:assert/strict';

export function auditOutcome(stdout, exitCode) {
  try {
    const data = JSON.parse(stdout), counts = data.metadata?.vulnerabilities;
    assert(counts, 'Missing audit summary.');
    const severities = ['info', 'low', 'moderate', 'high', 'critical'];
    for (const key of [...severities, 'total']) assert(Number.isInteger(counts[key]) && counts[key] >= 0, 'Invalid vulnerability count: ' + key);
    assert.equal(severities.reduce((total, key) => total + counts[key], 0), counts.total, 'Inconsistent audit total.');
    assert(exitCode === 0 || exitCode === 1, 'Audit process did not exit normally.');
    return {status: counts.total > 0 ? 'findings' : exitCode === 0 ? 'passed' : 'failed', vulnerabilities: counts};
  } catch (error) {
    return {status: 'failed', error: 'Audit output could not be validated: ' + error.message};
  }
}

export function strengthSummary(checks, complete) {
  const summary = Object.fromEntries(['passed', 'failed', 'blocked', 'findings', 'skipped', 'running'].map(status => [status, checks.filter(row => row.status === status).length]));
  const unknown = checks.some(row => !Object.hasOwn(summary, row.status));
  const all_selected_checks_passed = complete === true && summary.passed > 0 && !unknown && summary.failed === 0 && summary.blocked === 0 && summary.findings === 0 && summary.running === 0;
  const exitCode = complete !== true || unknown || summary.failed || summary.running || !summary.passed ? 1 : summary.findings || summary.blocked ? 2 : 0;
  return {summary, all_selected_checks_passed, exitCode};
}
