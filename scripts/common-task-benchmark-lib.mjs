import assert from 'node:assert/strict';

export const commonCases = ['window_discovery', 'control_discovery', 'enter_text_verify', 'search_and_open', 'button_result', 'document_passages', 'url_open', 'pdf_open_read', 'excel_read', 'excel_write_calculate_save'];
// Edge sometimes omits the HTTP scheme after navigation. Normalize only the
// fixture's loopback addresses, preserving origin, port, path and query checks.
export function observedLoopbackUrl(value) {
  try {
    const url = new URL(value.startsWith('127.0.0.1:') ? 'http://' + value : value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password ? url.href : undefined;
  } catch {return undefined;}
}
export function commonOptions(argv) {
  const options = {runs: 5, modes: ['baseline', 'optimized'], cases: commonCases, output: 'benchmarks/results/common-tasks.json', timeout: 15000};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    assert(['--runs', '--modes', '--cases', '--output', '--window-id', '--timeout'].includes(key), 'Unknown option: ' + key);
    const value = argv[++i]; assert(value, 'Missing value for ' + key);
    if (key === '--runs') options.runs = Number(value);
    if (key === '--modes') options.modes = value.split(',');
    if (key === '--cases') options.cases = value.split(',');
    if (key === '--output') options.output = value;
    if (key === '--window-id') options.windowId = value;
    if (key === '--timeout') options.timeout = Number(value);
  }
  assert(Number.isInteger(options.runs) && options.runs >= 1 && options.runs <= 50);
  assert(Number.isInteger(options.timeout) && options.timeout >= 1000 && options.timeout <= 30000);
  assert(options.modes.length && new Set(options.modes).size === options.modes.length && options.modes.every(mode => ['baseline', 'optimized'].includes(mode)));
  assert(options.cases.length && new Set(options.cases).size === options.cases.length && options.cases.every(name => commonCases.includes(name)));
  assert(options.output.endsWith('.json'));
  return options;
}
export function pairedOrder(modes, round) {return round % 2 ? [...modes].reverse() : [...modes];}
export function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {samples: sorted.length, median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], min_ms: sorted[0], max_ms: sorted.at(-1)};
}
export function summarize(samples, cases, modes) {
  return Object.fromEntries(cases.flatMap(name => modes.map(mode => {
    const rows = samples.filter(row => row.case === name && row.mode === mode && !row.warmup);
    const passed = rows.filter(row => row.status === 'passed');
    return [name + ':' + mode, {scheduled: rows.length, attempted: rows.filter(row => row.started !== false).length, passed: passed.length, failed: rows.filter(row => row.status === 'failed').length,
      blocked: rows.filter(row => row.status === 'blocked').length, timed_out: rows.filter(row => row.status === 'timed_out').length,
      elapsed: stats(passed.map(row => row.elapsed_ms)), action: stats(passed.map(row => row.action_ms)), verification: stats(passed.map(row => row.verification_ms)),
      calls: passed.map(row => row.calls.length), response_chars: passed.map(row => row.calls.reduce((sum, call) => sum + call.response_chars, 0))}];
  })));
}
export class BenchmarkBlocked extends Error {}
export function failureStatus(error) {
  if (error instanceof BenchmarkBlocked) return 'blocked';
  return error.code === 'TIMEOUT' || error.details?.code === 'TIMEOUT' ? 'timed_out' : 'failed';
}
export function oneControl(ui, name, action) {
  assert(ui.complete === true && !ui.truncated && typeof ui.snapshot === 'string' && Array.isArray(ui.nodes), 'Incomplete control discovery.');
  const nodes = ui.nodes.filter(node => node.name === name && node.targetable && node.actions?.includes(action));
  assert.equal(nodes.length, 1, 'Expected one ' + action + ' control named ' + name);
  return {snapshot: ui.snapshot, element_id: nodes[0].id};
}
export function decode(result) {
  const body = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  assert(!result.content.some(item => item.type === 'image'), 'Unexpected screenshot in a text-only scenario.');
  const data = JSON.parse(body);
  if (result.isError || data.ok === false) {
    const error = new Error(data.error || body.slice(0, 400)); error.details = data.error_details; throw error;
  }
  return {data, response_chars: body.length};
}
export function renderCommonReport(report) {
  const number = value => value == null ? '—' : value.toFixed(1);
  const rows = Object.entries(report.summary).map(([name, row]) => '| ' + name + ' | ' + row.passed + '/' + row.attempted + ' | ' + number(row.elapsed?.median_ms)
    + ' | ' + number(row.elapsed?.p95_ms) + ' | ' + row.failed + '/' + row.timed_out + '/' + row.blocked + ' | ' + (row.calls.length ? row.calls.join(', ') : '—') + ' |');
  return '# Common task benchmark\n\n' + (report.complete ? 'All requested attempts recorded.' : 'Incomplete run: ' + (report.error || 'interrupted'))
    + ' Successful measurements require independently verified outcomes.\n\n'
    + '| Operation / strategy | Passed / attempted | Median ms | Observed p95 ms | Failed / timeout / blocked | MCP calls |\n| --- | ---: | ---: | ---: | ---: | --- |\n' + rows.join('\n')
    + '\n\n' + report.limits.join('\n\n') + '\n\n' + report.notes.join('\n\n') + '\n';
}

// A real text PDF served to Edge, including a correct xref table and text layer.
export function textPdf(title, lines) {
  const escape = value => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = 'BT /F1 16 Tf 40 740 Td ' + lines.map((line, index) => (index ? '0 -24 Td ' : '') + '(' + escape(line) + ') Tj').join('\n') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Title (' + escape(title) + ') >>'];
  let body = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => {offsets.push(Buffer.byteLength(body)); body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';});
  const start = Buffer.byteLength(body);
  body += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(body);
}
