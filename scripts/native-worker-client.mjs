import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

export function nativeWorker(directory) {
  const child = spawn(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', resolve(directory, 'uia-worker.ps1')], {windowsHide: true, stdio: 'pipe'});
  const pending = new Map();
  let sequence = 0, buffer = '', diagnostic = '';
  child.stdout.setEncoding('utf8');
  child.stderr.on('data', data => {diagnostic = (diagnostic + data).slice(-2000);});
  const fail = error => {
    for (const item of pending.values()) {clearTimeout(item.timer); item.reject(error);}
    pending.clear();
  };
  child.once('error', fail);
  child.once('exit', () => fail(new Error(diagnostic || 'Owned native worker exited.')));
  child.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const response = JSON.parse(line);
        const item = pending.get(response.id);
        if (!item) continue;
        pending.delete(response.id);
        clearTimeout(item.timer);
        if (response.error !== undefined) item.reject(new Error(response.error));
        else item.resolve(response.result);
      } catch (error) {fail(error); child.kill();}
    }
  });
  return {
    async request(args) {
      const id = ++sequence;
      return new Promise((resolveRequest, reject) => {
        const timer = setTimeout(() => {fail(new Error('Owned native worker timed out.')); child.kill();}, 20000);
        pending.set(id, {resolve: resolveRequest, reject, timer});
        child.stdin.write(JSON.stringify({id, args: {max_elements: 60, max_depth: 30, ...args}}) + '\n');
      });
    },
    close() {child.kill(); fail(new Error('Owned native worker closed.'));},
  };
}
