// Same broken-image measure applied to the live site and the local copy.
// A count that matches means the copy is faithful; images hidden in inactive
// tabs never decode on either side, so only a DIFFERENCE indicates a gap.
import { launch } from './browser.mjs';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT=path.resolve(import.meta.dirname,'..');
const CFG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const OUT=path.join(ROOT,CFG.outDir);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.json':'application/json'};
const srv=http.createServer((q,s)=>{let r=decodeURIComponent(q.url.split('?')[0]);if(r.endsWith('/'))r+='index.html';let f=path.join(OUT,r);if(!f.startsWith(OUT)){s.writeHead(403).end();return;}if(!fs.existsSync(f)&&fs.existsSync(f+'.html'))f+='.html';if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404).end();return;}s.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]??'application/octet-stream'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(0,r));
const localBase=`http://127.0.0.1:${srv.address().port}/`;
const b=await launch();
async function measure(url){
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  try{
    await p.goto(url,{waitUntil:'load',timeout:60000});
    await p.evaluate(async()=>{const s=m=>new Promise(r=>setTimeout(r,m));
      for(let y=0;y<document.body.scrollHeight;y+=400){scrollTo(0,y);await s(120);}scrollTo(0,0);await s(500);});
    await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.addEventListener('load',r,{once:true});i.addEventListener('error',r,{once:true});setTimeout(r,10000);})));});
    await p.waitForTimeout(1200);
    const res=await p.evaluate(()=>{
      const bad=[...document.images].filter(i=>!i.complete||i.naturalWidth===0);
      return {total:document.images.length, broken:bad.length,
        names:bad.map(i=>(i.currentSrc||i.src||'').split('/').pop()).sort(),
        height:document.body.scrollHeight};
    });
    return res;
  } catch(e){ return {error:e.message.split('\n')[0]}; }
  finally{ await ctx.close(); }
}
const local=await measure(localBase);
console.log('LOCAL:', JSON.stringify({total:local.total,broken:local.broken,height:local.height}));
const live=await measure(CFG.origin+'/');
console.log('LIVE :', JSON.stringify(live.error?{error:live.error}:{total:live.total,broken:live.broken,height:live.height}));
if(local.names&&live.names){
  const onlyLocal=local.names.filter(n=>!live.names.includes(n));
  console.log('broken only in the copy:', onlyLocal.length? onlyLocal.slice(0,10):'(none)');
}
await b.close(); srv.close();
