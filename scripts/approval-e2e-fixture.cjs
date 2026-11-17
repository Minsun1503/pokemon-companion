// Isolated test companion entry. This fixture is never imported by the production companion.
const {app} = require('electron');
const net = require('node:net');
const {writeFileSync} = require('node:fs');
const path = require('node:path');
const {CompanionApprovals} = require('../frontend/build/main/companion/approval.js');
const root = path.resolve(__dirname, '../frontend');
app.setPath('userData', process.env.POKEMON_USER_DATA_DIR);
let clock = 1, sequence = 0, approvals, socket, queue = Promise.resolve(), buffer = '';
const waits = new Map();
const send = value => socket.write(JSON.stringify(value) + '\n');
app.whenReady().then(() => {
  socket = net.connect(process.env.POKEMON_BRIDGE_PIPE);
  socket.setEncoding('utf8');
  socket.on('connect', () => send({kind:'hello', token:process.env.POKEMON_BRIDGE_TOKEN}));
  socket.on('close', () => app.quit());
  socket.on('data', chunk => {
    buffer += chunk;
    while(buffer.includes('\n')) {
      const end=buffer.indexOf('\n'), command=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
      if(command.kind==='protection_result') {waits.get(command.id)?.(command.protected); waits.delete(command.id); continue;}
      queue=queue.then(async()=>{
        try {
          if(command.kind==='approval_check') {
            approvals ??= new CompanionApprovals(root, app.getPath('userData'), async(window,approval)=>{
              const handle=window.getNativeWindowHandle(), id=++sequence;
              const result=await new Promise(resolve=>{
                waits.set(id,resolve);
                send({kind:'protect_window',id,window_id:handle.readBigUInt64LE().toString(),process_id:process.pid,approval});
              });
              if(!result) throw new Error('Native protection failed');
            }, ()=>clock);
            send({kind:'approval_result',id:command.id,...await approvals.check(command.request)}); return;
          }
          if(command.kind==='approval_revoke') approvals?.revokeScope(command.scope);
          if(command.kind==='fixture_decide' && !approvals.decide(command.digest,command.choice)) throw new Error('No matching test dialog');
          if(command.kind==='fixture_clock') clock=command.time;
          if(command.kind==='fixture_inspect') {
            const entry=[...approvals.windows.values()][0];
            if(!entry) throw new Error('No test dialog');
            const dom=await entry.window.webContents.executeJavaScript(`({scopeHidden:document.getElementById('scope').hidden,preview:document.getElementById('preview').textContent,buttons:[...document.querySelectorAll('footer button:not([hidden])')].map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent,visible:r.top>=0&&r.bottom<=innerHeight}})})`);
            writeFileSync(process.env.POKEMON_APPROVAL_E2E_REPORT,JSON.stringify({request:entry.request,dom}));
            if(command.capture) writeFileSync(process.env.POKEMON_APPROVAL_E2E_IMAGE,(await entry.window.webContents.capturePage()).toPNG());
          }
          send({kind:'ack',id:command.id});
        } catch(error) {
          if(command.kind==='approval_check') send({kind:'approval_result',id:command.id,authorized:false,action_id:command.request.action_id});
          else send({kind:'ack',id:command.id,error:String(error)});
        }
      });
    }
  });
});
app.on('window-all-closed',()=>{});
app.on('will-quit',()=>approvals?.close());
