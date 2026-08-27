// Pass 4 - prove the copy matches.
//
// Screenshots the live site and the local mirror side by side at every
// breakpoint and pixel-diffs them. "1-1" stops being a claim and becomes a
// number you can look at, with a diff image showing exactly where it drifts.

import { launch } from './browser.mjs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const DIFFS = path.join(ROOT, 'diffs');
const MANIFEST = path.join(ROOT, 'audit', 'manifest.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
};

/** Minimal static server over the mirror. */
function serve(root) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function shoot(page, url, bp) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // Freeze motion so a diff measures layout, not which frame we caught.
  await page.addStyleTag({ content: `*,*::before,*::after{
    animation-play-state:paused!important;
    animation-delay:0s!important;
    transition:none!important;
  }` });
  await page.evaluate(async ({ step, delay }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y); await sleep(delay);
    }
    window.scrollTo(0, 0); await sleep(delay);
  }, { step: CFG.scrollStepPx, delay: 60 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(CFG.settleMs);
  return page.screenshot({ fullPage: true });
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('!! run `npm run capture` first'); process.exit(1);
  }
  fs.mkdirSync(DIFFS, { recursive: true });

  const { pages } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const server = await serve(OUT);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const rows = [];

  for (const bp of CFG.breakpoints) {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 1,
    });
    const live = await ctx.newPage();
    const local = await ctx.newPage();

    for (const p of pages) {
      const slug = p.rel.replace(/[\/\\]/g, '_').replace(/\.html$/, '') || 'index';
      try {
        const [a, b] = await Promise.all([
          shoot(live, p.url, bp),
          shoot(local, `${base}/${p.rel}`, bp),
        ]);
        const imgA = PNG.sync.read(a);
        const imgB = PNG.sync.read(b);

        // Compare over the shared area; height drift is reported separately.
        const w = Math.min(imgA.width, imgB.width);
        const h = Math.min(imgA.height, imgB.height);
        const crop = (img) => {
          const o = new PNG({ width: w, height: h });
          PNG.bitblt(img, o, 0, 0, w, h, 0, 0);
          return o;
        };
        const ca = crop(imgA), cb = crop(imgB);
        const diff = new PNG({ width: w, height: h });
        const bad = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.1 });
        const pct = (bad / (w * h)) * 100;

        if (pct > 0.1) {
          fs.writeFileSync(path.join(DIFFS, `${slug}.${bp.name}.diff.png`), PNG.sync.write(diff));
        }
        rows.push({
          page: p.rel, bp: bp.name, diffPct: +pct.toFixed(3),
          liveH: imgA.height, localH: imgB.height,
          heightDelta: imgA.height - imgB.height,
        });
        const flag = pct < 0.5 ? 'OK  ' : pct < 3 ? 'WARN' : 'FAIL';
        console.log(`  ${flag} ${slug} @ ${bp.name}: ${pct.toFixed(2)}% differing, ` +
                    `height ${imgA.height} vs ${imgB.height}`);
      } catch (err) {
        console.log(`  ERR  ${slug} @ ${bp.name}: ${err.message.split('\n')[0]}`);
        rows.push({ page: p.rel, bp: bp.name, error: err.message.split('\n')[0] });
      }
    }
    await ctx.close();
  }

  await browser.close();
  server.close();

  fs.writeFileSync(path.join(ROOT, 'audit', 'verify.json'), JSON.stringify(rows, null, 2));
  const scored = rows.filter((r) => typeof r.diffPct === 'number');
  const worst = scored.slice().sort((a, b) => b.diffPct - a.diffPct)[0];
  const avg = scored.reduce((s, r) => s + r.diffPct, 0) / (scored.length || 1);
  console.log(`\n==> average ${avg.toFixed(2)}% differing across ${scored.length} comparisons`);
  if (worst) console.log(`==> worst: ${worst.page} @ ${worst.bp} (${worst.diffPct}%)`);
  console.log('==> diff images in diffs/, full data in audit/verify.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
