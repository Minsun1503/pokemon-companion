import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BenchmarkBlocked, commonOptions, decode, failureStatus, observedLoopbackUrl, oneControl, pairedOrder, renderCommonReport, stats, summarize, textPdf} from './common-task-benchmark-lib.mjs';
import {createCommonFixture} from './common-task-fixture.mjs';

test('canonicalizes Edge loopback display addresses without accepting another origin', () => {
  const exact = 'http://127.0.0.1:50155/invoice-token.pdf';
  assert.equal(observedLoopbackUrl(exact), exact);
  assert.equal(observedLoopbackUrl(exact.slice(7)), exact);
  assert.notEqual(observedLoopbackUrl('127.0.0.1:50156/invoice-token.pdf'), exact);
  for (const value of ['https://127.0.0.1:50155/invoice-token.pdf', '127.0.0.1.evil:50155/invoice-token.pdf', 'http://127.0.0.1@evil/invoice-token.pdf']) {
    assert.equal(observedLoopbackUrl(value), undefined);
  }
});

test('browser resource and stale event requests cannot erase independent action evidence', async () => {
  const server = createCommonFixture('test');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await fetch(base + '/work?token=current');
    await fetch(base + '/event?token=current&kind=search&query=Record%20current');
    await fetch(base + '/event?token=current&kind=click');
    assert.equal((await fetch(base + '/favicon.ico')).status, 404);
    await fetch(base + '/event?token=old&kind=search&query=Wrong');
    assert.equal((await fetch(base + '/invoice-current.pdf')).headers.get('content-type'), 'application/pdf');
    const observed = await (await fetch(base + '/state')).json();
    assert.equal(observed.token, 'current'); assert.equal(observed.query, 'Record current');
    assert.equal(observed.search, 1); assert.equal(observed.click, 1);
  } finally {await new Promise(done => {server.close(done); server.closeAllConnections();});}
});

test('rejects invalid options and repeated strategies before desktop work', () => {
  for (const args of [['--runs', '0'], ['--runs', '1.5'], ['--cases', 'send_everyone'], ['--modes', 'optimized,optimized'], ['--output', 'report.md'], ['--timeout', '90000'], ['--runs']]) {
    assert.throws(() => commonOptions(args));
  }
  assert.equal(commonOptions(['--runs', '3', '--cases', 'excel_read', '--window-id', '123']).runs, 3);
  assert.deepEqual(pairedOrder(['baseline', 'optimized'], 1), ['optimized', 'baseline']);
});
test('records failures, timeouts and blocked preparations without treating them as fast successes', () => {
  const rows = [{case: 'excel_read', mode: 'baseline', status: 'passed', elapsed_ms: 50, action_ms: 40, verification_ms: 10, calls: [{response_chars: 100}]},
    {case: 'excel_read', mode: 'baseline', status: 'failed', elapsed_ms: 1, calls: []},
    {case: 'excel_read', mode: 'baseline', status: 'timed_out', elapsed_ms: 15000, calls: []},
    {case: 'excel_read', mode: 'baseline', status: 'blocked', started: false, calls: []},
    {case: 'excel_read', mode: 'baseline', status: 'passed', elapsed_ms: 1, warmup: true, calls: []}];
  const summary = summarize(rows, ['excel_read'], ['baseline'])['excel_read:baseline'];
  assert.equal(summary.scheduled, 4); assert.equal(summary.attempted, 3); assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1); assert.equal(summary.timed_out, 1); assert.equal(summary.blocked, 1);
  assert.equal(summary.elapsed.median_ms, 50); assert.deepEqual(summary.calls, [1]); assert.deepEqual(summary.response_chars, [100]);
  const report = renderCommonReport({complete: true, summary: {'excel_read:baseline': summary}, limits: [], notes: []});
  assert(report.includes('1/3')); assert(report.includes('1/1/1'));
});
test('small sample statistics use real order statistics', () => {
  assert.equal(stats([]), null); assert.equal(stats([10]).p95_ms, 10);
  assert.equal(stats([100, 10, 30, 20]).median_ms, 25); assert.equal(stats([100, 10, 30, 20]).p95_ms, 100);
});
test('refuses incomplete, duplicate and unsupported controls before selecting a target', () => {
  const node = {id: 3, name: 'Find record', targetable: true, actions: ['invoke']};
  const base = {complete: true, snapshot: 'a'.repeat(32), nodes: [node]};
  assert.deepEqual(oneControl(base, node.name, 'invoke'), {snapshot: base.snapshot, element_id: 3});
  for (const changed of [{complete: false}, {truncated: true}, {nodes: [node, {...node, id: 4}]}, {nodes: [{...node, targetable: false}]}, {nodes: [{...node, actions: []}]}]) {
    assert.throws(() => oneControl({...base, ...changed}, node.name, 'invoke'));
  }
});
test('propagates explicit native failures and rejects screenshots in text-only cases', () => {
  assert.throws(() => decode({isError: true, content: [{type: 'text', text: JSON.stringify({ok: false, error: 'provider timeout', error_details: {code: 'TIMEOUT'}})}]}), error => failureStatus(error) === 'timed_out');
  assert.throws(() => decode({content: [{type: 'image', data: 'x'}, {type: 'text', text: '{}'}]}));
  assert.equal(failureStatus(new BenchmarkBlocked('PDF inaccessible')), 'blocked');
  assert.equal(failureStatus(new Error('Wrong result')), 'failed');
});
test('generated PDF has a text stream and byte-correct cross references', () => {
  const pdf = textPdf('Invoice (test)', ['Total: 48.75 USD', 'Marker abc-123']).toString();
  assert(pdf.startsWith('%PDF-1.4')); assert(pdf.includes('(Total: 48.75 USD) Tj'));
  assert(pdf.includes('/Title (Invoice \\(test\\))'));
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]); assert.equal(pdf.slice(xref, xref + 4), 'xref');
  const entries = pdf.slice(xref).split('\n').slice(3, 9);
  entries.forEach((entry, index) => assert(pdf.slice(Number(entry.slice(0, 10))).startsWith((index + 1) + ' 0 obj')));
  const stream = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);
  assert.equal(Buffer.byteLength(stream[2]), Number(stream[1]));
});
