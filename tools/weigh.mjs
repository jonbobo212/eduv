// Measure what a phone actually downloads: on first paint, and after a full
// scroll. Total folder size is misleading when most images are lazy-loaded.
import { launch } from './browser.mjs';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT=path.resolve(import.meta.dirname,'..');
const CFG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const OUT=path.join(ROOT,CFG.outDir);
const M={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.ico':'image/x-icon'};
const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(OUT,u);if(!fs.existsSync(f)){r.writeHead(404).end();return;}r.writeHead(200,{'content-type':M[path.extname(f).toLowerCase()]??'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(0,r));
const b=await launch();
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
const by={}; let total=0;
p.on('response',async(res)=>{ try{
  const len=Number((await res.allHeaders())['content-length']||0)|| (await res.body().catch(()=>Buffer.alloc(0))).length;
  const ext=(new URL(res.url()).pathname.match(/\.[a-z0-9]+$/i)||['(doc)'])[0].toLowerCase();
  by[ext]=(by[ext]||0)+len; total+=len;
}catch{} });
await p.goto(`http://127.0.0.1:${s.address().port}/`,{waitUntil:'load',timeout:60000});
await p.waitForTimeout(2500);
const firstLoad=total, firstBy={...by};
await p.evaluate(async()=>{const z=m=>new Promise(r=>setTimeout(r,m));
  for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await z(140);} scrollTo(0,0);await z(600);});
await p.waitForTimeout(2500);
const fmt=(n)=>(n/1048576).toFixed(2)+'MB';
console.log('INITIAL LOAD (before scrolling): '+fmt(firstLoad));
Object.entries(firstBy).sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([k,v])=>console.log('   '+k.padEnd(7)+fmt(v)));
console.log('\nAFTER FULL SCROLL (everything): '+fmt(total));
Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([k,v])=>console.log('   '+k.padEnd(7)+fmt(v)));
await b.close(); s.close();
