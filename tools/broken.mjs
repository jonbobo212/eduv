// List the images that fail to load in the local copy, so the gap is a
// concrete list of URLs rather than a count.
import { launch } from './browser.mjs';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon'};
const srv=http.createServer((q,s)=>{let r=decodeURIComponent(q.url.split('?')[0]);if(r.endsWith('/'))r+='index.html';let f=path.join(OUT,r);if(!f.startsWith(OUT)){s.writeHead(403).end();return;}if(!fs.existsSync(f)&&fs.existsSync(f+'.html'))f+='.html';if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404).end();return;}s.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]??'application/octet-stream'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(0,r));
const base=`http://127.0.0.1:${srv.address().port}`;
const b=await launch();
const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(base+'/',{waitUntil:'load',timeout:60000});
// Scroll to trigger lazy-loading, then WAIT for the images to finish.
// Sampling naturalWidth straight after a scroll counts still-loading images
// as broken, which is how a complete mirror looks half-empty.
await p.evaluate(async()=>{const s=m=>new Promise(r=>setTimeout(r,m));
  for(let y=0;y<document.body.scrollHeight;y+=400){scrollTo(0,y);await s(120);}
  scrollTo(0,0);await s(500);});
await p.evaluate(async()=>{
  await Promise.all([...document.images].map(i =>
    i.complete ? Promise.resolve() : new Promise(r => {
      i.addEventListener('load', r, {once:true});
      i.addEventListener('error', r, {once:true});
      setTimeout(r, 10000);
    })));
});
await p.waitForTimeout(1500);
const res=await p.evaluate(()=>{
  const bad=[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.currentSrc||i.src||i.getAttribute('src')||'(no src)');
  const byHost={};
  for(const u of bad){ let h='(relative/empty)'; try{h=new URL(u).host;}catch{} (byHost[h] ||= []).push(u); }
  return {total:document.images.length, badCount:bad.length, byHost};
});
console.log('images total:',res.total,' broken:',res.badCount);
for(const [h,list] of Object.entries(res.byHost)){
  console.log(`\n${h}  (${list.length})`);
  [...new Set(list)].slice(0,6).forEach(u=>console.log('   ',u.slice(0,110)));
}
await b.close(); srv.close();
