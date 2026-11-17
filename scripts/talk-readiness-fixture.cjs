// Disposable native surfaces shared by the live Ollama and external MCP smoke arms.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn,execFileSync}=require('node:child_process');
const {createInterface}=require('node:readline');
const {randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const profile=process.env.POKEMON_READINESS_DATA;
assert(profile);app.setPath('userData',profile);
const names=['window_discovery','control_discovery','enter_text_verify','search_and_open','button_result','document_passages','url_open','pdf_open_read','excel_read','excel_write_calculate_save'];
const nonce=randomBytes(3).toString('hex');
let web,control,window,excel,current,excelInfo,excelLines;
const pending=[];
const closeExcel=()=>{
  const input=excel?.stdin;
  if(input&&!input.destroyed&&!input.writableEnded)input.end('close\n');
};
const excelCommand=command=>new Promise((resolve,reject)=>{pending.push({resolve,reject});excel.stdin.write(command+'\n');});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const safeJson=value=>JSON.stringify(value).replaceAll('<','\\u003c');
(async()=>{
  const {createCommonFixture,titleFor}=await import('./common-task-fixture.mjs');
  await app.whenReady();web=createCommonFixture(nonce);await listen(web);
  const base=`http://127.0.0.1:${web.address().port}`;
  window=new BrowserWindow({width:1000,height:720,title:'Readiness fixture',webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const compiler=path.join(profile,'compile.ps1'),executable=path.join(profile,'ExcelFixture.exe');
  fs.writeFileSync(compiler,'param($source,$output)\n$ErrorActionPreference="Stop"\nAdd-Type -Path $source -ReferencedAssemblies System.Web.Extensions -OutputAssembly $output -OutputType ConsoleApplication\n');
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',compiler,path.join(__dirname,'common-task-excel-fixture.cs'),executable],{windowsHide:true});
  excel=spawn(executable,[profile,nonce],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  excelLines=createInterface({input:excel.stdout});
  let ready;const started=new Promise((resolve,reject)=>{ready={resolve,reject};});
  excelLines.on('line',line=>{
    const data=JSON.parse(line.replace(/^\uFEFF/,''));const item=excelInfo?pending.shift():ready;
    if(data.kind==='error') item?.reject(new Error(data.error));else {if(data.kind==='ready')excelInfo=data;item?.resolve(data);}
  });
  excel.once('error',error=>ready.reject(error));await started;
  control=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/prepare') {
        const id=url.searchParams.get('case'),arm=url.searchParams.get('arm');assert(names.includes(id));assert(['cloud','local'].includes(arm));
        const token=`${nonce}-${arm}-${names.indexOf(id)+1}`,title=titleFor(token),work=`${base}/work?token=${token}`,pdf=`${base}/invoice-${token}.pdf`;
        await window.loadURL(work);window.show();
        let prompt;
        const scope=`Use only the disposable test window '${title}' and the test workbook named below. `;
        if(id==='window_discovery')prompt=scope+`Find the window '${title}', inspect it, and report its title.`;
        if(id==='control_discovery')prompt=scope+`Find the 'Record search' text input and report whether it supports entering text. Do not enter anything.`;
        if(id==='enter_text_verify')prompt=scope+`Enter 'smoke-${token}' into 'Record search' and read it back to verify the exact value.`;
        if(id==='search_and_open')prompt=scope+`Search for 'Record ${token}' using 'Record search' and 'Find record', open that result, and read the Shipment quantity and Invoice total from its document. Use the course tool if needed.`;
        if(id==='button_result')prompt=scope+`Click 'Open details' and read the resulting Record status and Record key.`;
        if(id==='document_passages')prompt=scope+`Click 'Load document' then read the Shipment quantity, Invoice total and Record key from the document using the course tool if needed.`;
        if(id==='url_open')prompt=scope+`Open ${work}&opened=1 and verify the loaded document title.`;
        if(id==='pdf_open_read')prompt=scope+`Open ${pdf} and read the Shipment quantity and Invoice total in this actual invoice PDF using the course tool if needed.`;
        const row=arm==='cloud'?2:3;
        if(id==='excel_read')prompt=`Use only the disposable Excel workbook '${excelInfo.name}', sheet Data. Read A1:J1 and report all ten cell values. The other workbook must remain untouched.`;
        if(id==='excel_write_calculate_save')prompt=`Use only the disposable Excel workbook '${excelInfo.name}', sheet Data, at '${excelInfo.path}'. Read A${row}:K${row} to confirm it is empty, write numbers 1 through 10 to A${row}:J${row}, put formula =SUM(A${row}:J${row}) into K${row}, calculate, save the existing workbook, and read back the calculated result. The other workbook must remain untouched.`;
        current={id,arm,token,title,work,pdf,prompt,row,excel:excelInfo};
        res.end(JSON.stringify(current));return;
      }
      if(url.pathname==='/verify') {
        assert(current);const state=await (await fetch(base+'/state')).json();
        const observation={url:window.webContents.getURL(),title:window.getTitle(),...state};
        if(!current.id.startsWith('excel_') && current.id!=='pdf_open_read') observation.input=await window.webContents.executeJavaScript('document.querySelector("input")?.value');
        if(current.id.startsWith('excel_')) observation.excel=await excelCommand(`${current.id==='excel_read'?'read:1':'persist:'+current.row}`);
        res.end(JSON.stringify({current,observation}));return;
      }
      if(url.pathname==='/quit') {res.end('{}');closeExcel();app.quit();return;}
      res.end(JSON.stringify({cases:names,base,excel:excelInfo,current}));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  await listen(control);console.log(JSON.stringify({port:control.address().port,profile,nonce}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;app.quit();});
app.on('will-quit',()=>{web?.close();control?.close();closeExcel();excelLines?.close();});
