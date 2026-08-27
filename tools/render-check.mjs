// Load the local copy in a real browser and report what breaks.
//
// The copy is only finished if it renders standalone. This serves site/,
// loads it, scrolls it, and reports every failed request and console error -
// plus a screenshot. Requests that leave the machine are listed separately:
// some (social links) are meant to; assets are not.
import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon',
  '.mp4':'video/mp4','.webm':'video/webm' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  let f = path.join(OUT, rel);
  if (!f.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launch();
const errors = [], failed = [], external = new Set();

for (const bp of CFG.breakpoints) {
  const ctx = await browser.newContext({
    viewport: { width: bp.width, height: bp.height }, deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${bp.name}] ${m.text().slice(0,120)}`); });
  page.on('requestfailed', (r) => failed.push(`[${bp.name}] ${r.url().slice(0,90)} ${r.failure()?.errorText}`));
  page.on('request', (r) => { try { const h = new URL(r.url()).hostname;
    if (h !== '127.0.0.1' && h !== 'localhost') external.add(h); } catch {} });

  await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await s(90); }
    window.scrollTo(0, 0); await s(300);
  });
  await page.waitForTimeout(900);

  if (bp.name === 'desktop') {
    const info = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.innerText?.slice(0, 60) ?? null,
      imgs: document.images.length,
      broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
      sections: document.querySelectorAll('section, [id]').length,
      fonts: [...new Set([...document.fonts].map((f) => f.family))],
      height: document.body.scrollHeight,
    }));
    console.log('rendered:', JSON.stringify(info, null, 2));
  }
  await page.screenshot({ path: path.join(SHOTS, `local.${bp.name}.png`), fullPage: true });
  await ctx.close();
  console.log(`  shot ${bp.name}`);
}

await browser.close();
server.close();
console.log(`\nconsole errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log('  ', e));
console.log(`failed requests: ${failed.length}`);
failed.slice(0, 8).forEach((e) => console.log('  ', e));
console.log('hosts contacted (should be links/analytics only):');
[...external].sort().forEach((h) => console.log('  ', h));
