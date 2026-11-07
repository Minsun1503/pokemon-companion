import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const sharp = require('sharp'), Jimp = require('jimp');
const {screen, imageToJimp} = require('@nut-tree-fork/nut-js');
const image = imageToJimp(await screen.grab());
const width = image.getWidth(), height = image.getHeight();
const scale = Math.min(1, 1568 / Math.max(width,height), Math.sqrt(1.15*1024*1024/(width*height)));
const targetWidth=Math.floor(width*scale),targetHeight=Math.floor(height*scale);
const raw={width,height,channels:4};
const reference=image.clone().resize(targetWidth,targetHeight).bitmap.data;
const results=[];
for(const kernel of ['nearest','linear','cubic','lanczos2','lanczos3']) {
  const resized=await sharp(image.bitmap.data,{raw}).resize(targetWidth,targetHeight,{fit:'fill',kernel}).raw().toBuffer();
  assert.equal(resized.length,reference.length);
  let absolute=0,squared=0,max=0;
  for(let index=0;index<resized.length;index++) if(index%4!==3) {const difference=Math.abs(resized[index]-reference[index]);absolute+=difference;squared+=difference*difference;max=Math.max(max,difference);}
  const count=targetWidth*targetHeight*3;
  results.push({kernel,mean_absolute_error:absolute/count,rmse:Math.sqrt(squared/count),max_channel_difference:max});
}
const crosshair=new Jimp(targetWidth,targetHeight,0x00000000),cx=Math.floor(targetWidth/2),cy=Math.floor(targetHeight/2);
function drawCrosshair(target) {
  for(let offset=-20;offset<=20;offset++)for(let thickness=-1;thickness<=1;thickness++) {
    target.setPixelColor(0xff0000ff,cx+offset,cy+thickness);
    target.setPixelColor(0xff0000ff,cx+thickness,cy+offset);
  }
}
drawCrosshair(crosshair);
const pipelines={
  old:async()=>{const resized=image.clone().resize(targetWidth,targetHeight);drawCrosshair(resized);return sharp(resized.bitmap.data,{raw:{width:targetWidth,height:targetHeight,channels:4}}).png({quality:80,compressionLevel:9}).toBuffer();},
  sharp:async()=>sharp(image.bitmap.data,{raw}).resize(targetWidth,targetHeight,{fit:'fill',kernel:'linear'}).composite([{input:crosshair.bitmap.data,raw:{width:targetWidth,height:targetHeight,channels:4}}]).png({quality:80,compressionLevel:9}).toBuffer(),
};
const timings=[];
for(const pipeline of Object.values(pipelines))await pipeline();
for(let run=0;run<20;run++)for(const name of run%2?['sharp','old']:['old','sharp']) {
  const started=performance.now(),png=await pipelines[name]();
  timings.push({name,run,elapsed_ms:performance.now()-started,bytes:png.length});
  const metadata=await sharp(png).metadata();assert.equal(metadata.format,'png');assert.equal(metadata.width,targetWidth);assert.equal(metadata.height,targetHeight);
}
function distribution(values) {const sorted=values.toSorted((a,b)=>a-b);return {median:(sorted[9]+sorted[10])/2,p95:sorted[18]};}
const pipeline_summary=Object.keys(pipelines).map(name=>({name,elapsed_ms:distribution(timings.filter(row=>row.name===name).map(row=>row.elapsed_ms)),bytes:timings.find(row=>row.name===name).bytes}));
const output=resolve(process.argv[2]||'benchmarks/results/perf-resize-pixels.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({complete:true,measured_at:new Date().toISOString(),source:{width,height},output:{width:targetWidth,height:targetHeight},reference:'Jimp default two-pass downsampling; same raw desktop sample for every kernel. Pipeline trials alternate order, include identical crosshairs and PNG settings, and exclude metadata verification.',results,pipeline_summary,timings},null,2)+'\n');
console.table(results);
console.table(pipeline_summary.map(row=>({name:row.name,median:row.elapsed_ms.median,p95:row.elapsed_ms.p95,bytes:row.bytes})));
