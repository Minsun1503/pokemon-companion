import {readFile, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {DesktopClient} from './desktop-workflows.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/desktop-client.mjs [--request file.json] [--report file.json]\nWithout --request, accepts one fill_form JSON request per stdin line and keeps MCP connected until EOF.\n--request accepts one request or an array of requests; each outcome includes setup, polling and failure timings.');
} else {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--request', '--report'].includes(args[index]) || !args[index + 1]) throw new Error('Use --help for supported arguments.');
    options[args[index].slice(2)] = args[index + 1];
  }
  const client = new DesktopClient();
  const reports = [];
  try {
    const run = async request => {
      const report = await client.fillForm(request);
      reports.push(report);
      console.log(JSON.stringify(report));
      if (!report.verified || report.error) process.exitCode = 1;
    };
    if (options.request) {
      const requests = JSON.parse(await readFile(options.request, 'utf8'));
      for (const request of Array.isArray(requests) ? requests : [requests]) await run(request);
    } else {
      const input = createInterface({input: process.stdin, crlfDelay: Infinity});
      for await (const line of input) {
        if (!line.trim()) continue;
        try {await run(JSON.parse(line));}
        catch (error) {console.log(JSON.stringify({verified: false, error: error.message})); process.exitCode = 1;}
      }
    }
  } finally {
    await client.close();
    if (options.report) await writeFile(options.report, JSON.stringify({schema_version: 1, reports}, null, 2) + '\n');
  }
}
