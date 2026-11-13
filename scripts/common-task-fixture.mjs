import http from 'node:http';
import {textPdf} from './common-task-benchmark-lib.mjs';

export const titleFor = token => 'Common Tasks ' + token;
export const factsFor = token => ['Shipment quantity: 37 cases.', 'Invoice total: 48.75 USD.', 'Record key: ' + token + '.'];
export function createCommonFixture(nonce) {
  let fixtureState = {};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/state') {response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(fixtureState)); return;}
  if (url.pathname === '/event') {
    if (url.searchParams.get('token') === fixtureState.token) {
      const kind = url.searchParams.get('kind');
      if (['search', 'click', 'details', 'load'].includes(kind)) fixtureState[kind]++;
      if (kind === 'search') fixtureState.query = url.searchParams.get('query');
    }
    response.end('ok'); return;
  }
  if (url.pathname.startsWith('/invoice-')) {
    const token = url.pathname.slice(9, -4);
    response.setHeader('Content-Type', 'application/pdf');
    response.end(textPdf('Common PDF ' + token, ['Common invoice ' + token, ...factsFor(token)])); return;
  }
  // Browser resource requests must not reset the scenario's independent evidence.
  if (url.pathname !== '/work') {response.writeHead(404); response.end(); return;}
  const token = url.searchParams.get('token') || nonce;
  fixtureState = {token, query: '', search: 0, click: 0, details: 0, load: 0};
  const content = Array.from({length: 180}, (_, i) => '<p>Historical message ' + i + ': supporting background material without the requested current facts.</p>').join('')
    + factsFor(token).map(fact => '<p>' + fact + '</p>').join('');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><title>${titleFor(token)}</title><style>
    body{font:16px sans-serif;margin:12px}header{position:sticky;top:0;background:white;padding:12px}p{margin:5px}
    </style><header><label>Record search <input aria-label="Record search"></label><button id="find">Find record</button>
    <button id="load">Load document</button><button id="details">Open details</button></header>
    <p>Ready ${token}</p><div id="results"></div><div id="status"></div><article></article><script>
    const token=${JSON.stringify(token)}, content=${JSON.stringify(content).replaceAll('<', '\\u003c')};
    const event=(kind,query='')=>fetch('/event?token='+token+'&kind='+kind+'&query='+encodeURIComponent(query));
    document.querySelector('#find').onclick=()=>{const value=document.querySelector('input').value;event('search',value);
      document.querySelector('#results').textContent='Loading';setTimeout(()=>{
        if(value!=='Record '+token)return; const link=document.createElement('a');link.href='#record';link.textContent='Record '+token;
        link.onclick=()=>{document.querySelector('article').innerHTML=content;event('click');};document.querySelector('#results').replaceChildren(link);
      },150);};
    document.querySelector('#load').onclick=()=>{document.querySelector('article').innerHTML=content;event('load');};
    document.querySelector('#details').onclick=()=>{document.querySelector('#status').textContent='Record status: Active. Record key: '+token+'.';event('details');};
    </script></html>`);
});
  return server;
}
