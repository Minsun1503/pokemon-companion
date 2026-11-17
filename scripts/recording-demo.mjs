import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const directory=join(process.env.LOCALAPPDATA||homedir(),'pokemon-companion','recording-demo');
await mkdir(directory,{recursive:true});
Object.assign(process.env,{POKEMON_USER_DATA_DIR:join(directory,'companion'),POKEMON_RECORDING_DIR:join(directory,'recording'),POKEMON_API_DIR:join(directory,'api'),POKEMON_ACTIONS_DIR:join(directory,'actions'),POKEMON_LEARNING_DIR:join(directory,'learning'),POKEMON_LEARNING:'off',POKEMON_APPROVAL_WAIT:'on'});
const {PokemonRuntime}=await import('../backend/dist/pokemon/runtime.js');
const {DesktopCompanion}=await import('../backend/dist/pokemon/companion.js');
let closing=false;
const runtime=new PokemonRuntime(new DesktopCompanion(()=>void close()));
const site=createServer((req,res)=>{
  const address=new URL(req.url,'http://localhost');
  if(address.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({action:address.pathname,items:['Demo video one','Demo video two']}));return;}
  res.setHeader('Content-Type','text/html');
  res.end(`<!doctype html><title>Pokémon recording practice</title><style>body{font:18px system-ui;max-width:700px;margin:80px auto;background:#f9f7ef;color:#243024}button,input{font:inherit;padding:12px;border:1px solid #aaa;border-radius:10px;margin:6px}button{background:#ffe36d}</style><h1>Try Pokémon Record</h1><p>Click your Pokémon → Record. Choose this browser tab, name your action, and start recording. Then try the buttons below.</p><label>Search demo videos <input id="query" value="pikachu"></label><button id="search">Search</button><button id="comments">Load comments</button><p id="result">Ready for your demonstration.</p><script>document.getElementById('search').onclick=()=>fetch('/api/search?q='+encodeURIComponent(document.getElementById('query').value)).then(r=>r.json()).then(r=>document.getElementById('result').textContent=r.items.join(', '));document.getElementById('comments').onclick=()=>fetch('/api/comments').then(r=>r.json()).then(()=>document.getElementById('result').textContent='Comments loaded.');</script>`);
});
await new Promise(done=>site.listen(0,'127.0.0.1',done));
const browser=await runtime.browser.launch('chromium',false,join(directory,'browser'));
await runtime.browser.page(browser.page_id).goto('http://127.0.0.1:'+site.address().port);
await runtime.companion.update({message:'Recording demo ready — click me, then Record.',task:'',activity:'idle'});
console.log(JSON.stringify({ready:true,pid:process.pid,directory,browser:browser.page_id,url:'http://127.0.0.1:'+site.address().port,instruction:'Click the demo Pokémon, then Record. Browser and desktop targets share this isolated demo session.'}));
async function close(){if(closing)return;closing=true;site.closeAllConnections();site.close();await runtime.close();process.exit();}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
