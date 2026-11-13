import {spawn} from 'node:child_process';

/** Read an existing GitHub credential without printing it or opening a login prompt. */
export async function githubToken(env = process.env) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return env.GH_TOKEN || env.GITHUB_TOKEN;
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: {...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never'}});
    let output = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('Git credential lookup timed out. Set GH_TOKEN or GITHUB_TOKEN.'));}, 10000);
    child.stdout.on('data', chunk => {output += chunk;});
    // Credential-helper output may contain secrets; never include stderr in errors.
    child.stderr.resume();
    child.once('error', () => {clearTimeout(timer); reject(new Error('Git credential lookup unavailable. Set GH_TOKEN or GITHUB_TOKEN.'));});
    child.once('close', code => {
      clearTimeout(timer);
      const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
      if (code || !token) reject(new Error('No existing GitHub credential. Set GH_TOKEN or GITHUB_TOKEN.'));
      else resolve(token);
    });
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

export class GitHubWorkflowAdapter {
  constructor({token, fetch: fetchImpl = fetch, signal} = {}) {
    if (!token) throw new Error('A GitHub credential is required.');
    this.token = token; this.fetch = fetchImpl; this.signal = signal;
  }
  async api(path, {method = 'GET', body} = {}) {
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const response = await this.fetch('https://api.github.com' + path, {method, signal,
      headers: {Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pokemon-workflow-controller', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    if (!response.ok) throw new Error(`GitHub ${method} failed (${response.status}); reconcile before any further mutation.`);
    return response.json();
  }
  async pages(path, key) {
    const values = [];
    for (let page = 1; page <= 10; page++) {
      const data = await this.api(path + (path.includes('?') ? '&' : '?') + `per_page=100&page=${page}`);
      const items = key ? data[key] : data;
      if (!Array.isArray(items)) throw new Error('Unexpected GitHub collection response.');
      values.push(...items);
      if (items.length < 100) return values;
    }
    throw new Error('GitHub result exceeds the bounded pagination limit.');
  }
  normalize(pr, request) {
    return {number: pr.number, url: pr.html_url, repository: pr.base?.repo?.full_name,
      head_repository: pr.head?.repo?.full_name, head: pr.head?.ref, base: pr.base?.ref, head_sha: pr.head?.sha,
      title: pr.title, body: pr.body ?? '', draft: pr.draft, state: pr.state,
      merged: Boolean(pr.merged), merge_sha: pr.merged ? pr.merge_commit_sha : null, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state};
  }
  async verifyHead(request) {
    const branch = await this.api(`/repos/${request.repository}/git/ref/heads/${encodeURIComponent(request.head)}`);
    if (branch.object?.sha !== request.head_sha) throw new Error('Source branch no longer matches the pinned head commit.');
  }
  async findPR(request) {
    const owner = request.repository.split('/')[0];
    const items = await this.pages(`/repos/${request.repository}/pulls?state=all&head=${encodeURIComponent(owner + ':' + request.head)}&base=${encodeURIComponent(request.base)}`);
    const matches = items.filter(pr => pr.head?.sha === request.head_sha);
    // List responses omit authoritative merged/mergeable fields; read each candidate.
    return Promise.all(matches.map(pr => this.getPR(request, pr.number)));
  }
  async getPR(request, number) {return this.normalize(await this.api(`/repos/${request.repository}/pulls/${number}`), request);}
  async createPR(request) {
    return this.normalize(await this.api(`/repos/${request.repository}/pulls`, {method: 'POST', body: {head: request.head, base: request.base, title: request.title, body: request.body, draft: false}}), request);
  }
  async checks(request) {
    const root = `/repos/${request.repository}`, sha = request.head_sha;
    const results = await Promise.allSettled([
      this.pages(`${root}/commits/${sha}/check-runs?filter=latest`, 'check_runs'),
      this.pages(`${root}/commits/${sha}/statuses`),
      this.pages(`${root}/actions/runs?head_sha=${sha}`, 'workflow_runs'),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const [runs, statuses, workflows] = results.map(result => result.value);
    const checks = runs.map(run => ({name: run.name, state: this.conclusion(run.status, run.conclusion)}));
    const contexts = new Set();
    for (const status of statuses) {
      if (contexts.has(status.context)) continue; // GitHub returns newest status first.
      contexts.add(status.context);
      checks.push({name: status.context, state: status.state === 'success' ? 'passed' : status.state === 'pending' ? 'pending' : 'failed'});
    }
    for (const run of workflows) checks.push({name: run.name, state: this.conclusion(run.status, run.conclusion)});
    return checks;
  }
  conclusion(status, conclusion) {
    if (status !== 'completed') return ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(status) ? 'pending' : 'unknown';
    return ['success', 'neutral', 'skipped'].includes(conclusion) ? 'passed' : conclusion ? 'failed' : 'unknown';
  }
  async mergePR(request, number) {
    const data = await this.api(`/repos/${request.repository}/pulls/${number}/merge`, {method: 'PUT', body: {sha: request.head_sha, merge_method: 'squash'}});
    if (data.merged !== true) throw new Error('GitHub did not accept the merge. It will not be replayed.');
  }
  async verifyBase(request, mergeSHA) {
    const base = await this.api(`/repos/${request.repository}/git/ref/heads/${encodeURIComponent(request.base)}`);
    const data = await this.api(`/repos/${request.repository}/compare/${mergeSHA}...${base.object.sha}`);
    if (!['identical', 'ahead'].includes(data.status)) throw new Error('Merged commit is not reachable from the current base branch.');
  }
}
