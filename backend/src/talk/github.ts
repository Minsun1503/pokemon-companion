import {spawn, type ChildProcess, execFile} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile);

/** Bounded Git/GitHub operations; no model-authored shell command is executed. */
export class GithubTools {
	private login?: ChildProcess;
	private loginOutput = '';
	private loginExit: number | null | undefined;
	private readonly gh: string;
	private readonly env: NodeJS.ProcessEnv;

	constructor(userData: string, private readonly isPaused: () => boolean = () => false) {
		const portable = path.join(homedir(), 'AppData/Local/pokemon-mcp/tools/gh/bin/gh.exe');
		this.gh = process.env.POKEMON_GH_PATH || (existsSync(portable) ? portable : 'gh');
		const config = path.join(userData, 'github-auth');
		mkdirSync(config, {recursive: true});
		this.env = {
			...process.env, GH_CONFIG_DIR: config, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0',
		};
		// An isolated test must not inherit an unrelated account's access token.
		delete this.env.GH_TOKEN;
		delete this.env.GITHUB_TOKEN;
	}

	close(): void {
		this.login?.kill();
	}

	async call(args: {action: string; folder?: string | undefined; repository?: string | undefined}): Promise<unknown> {
		if (args.action === 'auth_status') {
			try {
				const user = JSON.parse(await this.run(this.gh, ['api', 'user']));
				return {authenticated: true, login: user.login};
			} catch {
				return {authenticated: false, loginRunning: Boolean(this.login && this.loginExit === undefined), loginExit: this.loginExit};
			}
		}

		if (args.action === 'login') {
			if (!this.login || this.loginExit !== undefined) {
				this.loginOutput = '';
				this.loginExit = undefined;
				this.login = spawn(this.gh, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'], {
					env: {...this.env, BROWSER: 'echo'}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
				});
				const collect = (data: Buffer) => {
					this.loginOutput = (this.loginOutput + data.toString()).slice(-4000);
				};

				this.login.stdout?.on('data', collect);
				this.login.stderr?.on('data', collect);
				this.login.on('error', (error) => {
					this.loginOutput = error.message;
					this.loginExit = -1;
				});
				this.login.on('exit', (code) => {
					this.loginExit = code;
				});
				this.login.stdin?.end('\n');
			}

			const deadline = Date.now() + 10000;
			while (!/[A-Z0-9]{4}-[A-Z0-9]{4}/.test(this.loginOutput) && this.loginExit === undefined && Date.now() < deadline) {
				// Poll only startup, never block waiting for the human's authorization.
				// eslint-disable-next-line no-await-in-loop
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 100);
				});
			}

			const code = (/[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(this.loginOutput))?.[0];
			if (!code) {
				throw new Error(`GitHub login did not issue a device code: ${this.loginOutput}`);
			}

			return {verification_url: 'https://github.com/login/device', user_code: code, instruction: 'Open verification_url using windows, enter user_code and Continue. Human must enter password/2FA and click final Authorize. Then check auth_status.'};
		}

		if (args.action === 'publish') {
			const auth = await this.call({action: 'auth_status'}) as {authenticated: boolean};
			if (!auth.authenticated) {
				return {authenticated: false, incomplete: true, next_action: 'Call github login. Open its verification_url with windows. Enter the device code and intermediate steps yourself; hand off only for password/2FA/final Authorize.'};
			}
		}

		if (!args.folder || !path.isAbsolute(args.folder)) {
			throw new Error('Supply the absolute folder requested by the user.');
		}

		const folder = path.resolve(args.folder);
		if (!existsSync(folder)) {
			throw new Error('The requested local folder does not exist.');
		}

		const top = await this.run('git', ['rev-parse', '--show-toplevel'], folder);
		if (path.resolve(top).toLowerCase() !== folder.toLowerCase()) {
			throw new Error('The folder is not a repository root.');
		}

		const sha = await this.run('git', ['rev-parse', 'HEAD'], folder);
		const branch = await this.run('git', ['branch', '--show-current'], folder);
		const status = await this.run('git', ['status', '--porcelain'], folder);
		let origin = '';
		try {
			origin = await this.run('git', ['remote', 'get-url', 'origin'], folder);
		} catch {/* A new repository has no origin. */}

		if (args.action === 'inspect') {
			return {
				folder, sha, branch, clean: !status, status, origin,
			};
		}

		if (args.action !== 'publish') {
			throw new Error('Unknown GitHub operation.');
		}

		if (status || !branch) {
			throw new Error('Commit pending changes and use a named branch before publishing.');
		}

		if (!args.repository || !/^[a-zA-Z0-9_.-]{1,100}$/.test(args.repository)) {
			throw new Error('Supply the repository name requested by the user.');
		}

		const user = JSON.parse(await this.run(this.gh, ['api', 'user']));
		const fullName = `${user.login}/${args.repository}`;
		const expectedOrigin = `https://github.com/${fullName}.git`;
		if (origin && origin !== expectedOrigin) {
			throw new Error('The folder already has a different origin. It was preserved.');
		}

		let repo;
		try {
			repo = JSON.parse(await this.run(this.gh, ['api', `repos/${fullName}`]));
		} catch (error) {
			if (!String(error).includes('404')) {
				throw error;
			}

			await this.run(this.gh, ['repo', 'create', fullName, '--private']);
			repo = JSON.parse(await this.run(this.gh, ['api', `repos/${fullName}`]));
		}

		if (!repo.private) {
			throw new Error('The existing remote repository is public; visibility was preserved.');
		}

		if (!origin) {
			await this.run('git', ['remote', 'add', 'origin', expectedOrigin], folder);
		}

		// Apply the credential helper to this push only, without changing global Git settings.
		const helper = `!"${this.gh.replace(/\\/g, '/')}" auth git-credential`;
		await this.run('git', ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'push', '-u', 'origin', branch], folder);
		const remoteSha = await this.run(this.gh, ['api', `repos/${fullName}/git/ref/heads/${branch}`, '--jq', '.object.sha']);
		if (remoteSha !== sha) {
			throw new Error('Push completed, but the remote commit did not match the local commit.');
		}

		return {
			verified: true, url: repo.html_url, private: repo.private, branch, localSha: sha, remoteSha,
		};
	}

	private async run(file: string, args: string[], cwd?: string): Promise<string> {
		if (this.isPaused()) {
			throw new Error('Computer control is paused. No new GitHub operation was started.');
		}

		const {stdout} = await execute(file, args, {
			cwd, env: this.env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
		});
		return stdout.trim();
	}
}
