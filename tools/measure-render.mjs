// Record the largest size each image is actually displayed at, across every
// breakpoint. Sizing an asset to its display size (x2 for retina) is where the
// real weight saving is - a photo shown in a 222px card does not need 1600px.
import { launch } from './browser.mjs';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT=path.resolve(import.meta.dirname,'..');
const CFG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const OUT=path.join(ROOT,CFG.outDir);
const M={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(OUT,u);if(!fs.existsSync(f)){r.writeHead(404).end();return;}r.writeHead(200,{'content-type':M[path.extname(f).toLowerCase()]??'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(0,r));
const base=`http://127.0.0.1:${s.address().port}`;
const b=await launch();
const widest={};
for(const bp of CFG.breakpoints){
  const p=await (await b.newContext({viewport:{width:bp.width,height:bp.height}})).newPage();
  await p.goto(base+'/',{waitUntil:'load',timeout:60000});
  await p.evaluate(async()=>{const z=m=>new Promise(r=>setTimeout(r,m));
    for(let y=0;y<document.body.scrollHeight;y+=500){scrollTo(0,y);await z(110);}scrollTo(0,0);await z(400);});
  await p.waitForTimeout(1500);
  const seen=await p.evaluate(()=>{
    const o={};
    for(const i of document.images){
      const u=new URL(i.currentSrc||i.src,location.href).pathname;
      const r=i.getBoundingClientRect();
      const w=Math.max(r.width,i.width||0);
      if(w>0) o[u]=Math.max(o[u]||0,Math.round(w));
    }
    // CSS background images count too
    for(const el of document.querySelectorAll('*')){
      const bg=getComputedStyle(el).backgroundImage;
      const m=bg&&bg.match(/url\(["']?([^"')]+)["']?\)/);
      if(m){ try{const u=new URL(m[1],location.href).pathname;
        const r=el.getBoundingClientRect();
        if(r.width>0) o[u]=Math.max(o[u]||0,Math.round(r.width));}catch{} }
    }
    return o;
  });
  for(const [u,w] of Object.entries(seen)) widest[u]=Math.max(widest[u]||0,w);
  await p.close();
}
await b.close(); s.close();
fs.mkdirSync(path.join(ROOT,'audit'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'audit','render-sizes.json'),JSON.stringify(widest,null,1));
const e=Object.entries(widest).sort((a,b)=>b[1]-a[1]);
console.log('measured',e.length,'images');
console.log('widest displayed:'); e.slice(0,6).forEach(([u,w])=>console.log(`  ${String(w).padStart(5)}px  ${u}`));
console.log('narrowest:');      e.slice(-5).forEach(([u,w])=>console.log(`  ${String(w).padStart(5)}px  ${u}`));
