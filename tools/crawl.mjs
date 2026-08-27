// Page crawler over plain HTTP.
//
// The browser pass needs to reach the live site, which is not always possible
// (a proxied network whose upstream resets the browser's tunnel, for one).
// This walks the site with fetch instead, saving each page and following
// internal links. It handles server-rendered sites completely; anything that
// only appears after JS runs is recovered afterwards by the local render pass.

import './net.mjs';
import { UA } from './net.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const AUDIT = path.join(ROOT, 'audit');
const ORIGIN = new URL(CFG.origin);

const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const shortHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
};

function localPathFor(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const external = u.host !== ORIGIN.host;
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html';
  if (u.search) {
    const ext = path.extname(p);
    p = p.slice(0, -ext.length) + '__q' + shortHash(u.search) + ext;
  }
  return (external ? path.join('_ext', u.host, p) : p).replace(/^\/+/, '');
}

const internalLinks = (html, baseUrl) => {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1];
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(raw)) continue;
    try {
      const u = new URL(raw, baseUrl);
      if (u.host !== ORIGIN.host) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      // skip obvious file downloads - harvest handles assets
      if (/\.(pdf|zip|docx?|xlsx?|jpe?g|png|gif|svg|webp|mp4|webm)$/i.test(u.pathname)) continue;
      u.hash = ''; u.search = '';
      out.add(u.href);
    } catch { /* malformed href */ }
  }
  return [...out];
};

async function sitemapUrls() {
  const urls = [];
  for (const p of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const r = await fetch(new URL(p, ORIGIN), { headers: { 'user-agent': UA } });
      if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        try { if (new URL(m[1]).host === ORIGIN.host) urls.push(m[1]); } catch {}
      }
    } catch { /* no sitemap */ }
  }
  return urls;
}

async function main() {
  [OUT, AUDIT].forEach(mkdirp);

  const queue = [];
  const seen = new Set();
  const enqueue = (u) => { const c = u.split('#')[0]; if (!seen.has(c)) { seen.add(c); queue.push(c); } };

  CFG.startPaths.forEach((p) => enqueue(new URL(p, ORIGIN).href));
  const sm = await sitemapUrls();
  sm.forEach(enqueue);
  console.log(`==> seeded ${queue.length} url(s)${sm.length ? ` (${sm.length} from sitemap)` : ''}`);

  const pages = [];
  const assets = [];

  while (queue.length && pages.length < CFG.maxPages) {
    const url = queue.shift();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow' });
      if (!res.ok) { console.log(`  skip ${url} (HTTP ${res.status})`); continue; }
      const ctype = res.headers.get('content-type') ?? '';
      if (!/text\/html/i.test(ctype)) { console.log(`  skip ${url} (${ctype})`); continue; }

      const html = await res.text();
      const rel = localPathFor(url) ?? 'index.html';
      const abs = path.join(OUT, rel);
      mkdirp(path.dirname(abs));
      fs.writeFileSync(abs, html);

      pages.push({ url, rel, bytes: html.length });
      assets.push({ url, rel });
      internalLinks(html, url).forEach(enqueue);
      console.log(`  ok   ${url} -> ${rel} (${html.length} bytes)`);
    } catch (e) {
      console.log(`  FAIL ${url} (${e.message})`);
    }
  }

  fs.writeFileSync(path.join(AUDIT, 'manifest.json'), JSON.stringify({
    origin: CFG.origin, capturedAt: new Date().toISOString(), pages, assets,
  }, null, 2));

  console.log(`==> ${pages.length} page(s) saved`);
}

main().catch((e) => { console.error(e); process.exit(1); });
