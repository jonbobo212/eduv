// Pass 2 - render each page in a real browser and harvest everything wget
// cannot see: JS-injected images, lazy-loaded media, webfonts pulled by the
// CSSOM, XHR payloads, and the post-animation DOM.
//
// Also records an animation audit (keyframes, transitions, scroll triggers)
// so the motion side of the copy can be checked, not guessed at.

import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const SHOTS = path.join(ROOT, 'screenshots');
const AUDIT = path.join(ROOT, 'audit');

const ORIGIN = new URL(CFG.origin);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// absolute url -> path on disk, relative to OUT. Drives the rewrite pass.
const assetMap = new Map();

const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

/** Map a remote URL onto a stable path inside the mirror. */
function localPathFor(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  const external = u.host !== ORIGIN.host;
  let p = decodeURIComponent(u.pathname);

  if (p.endsWith('/')) p += 'index.html';
  // Extensionless paths are routes, not files - give them one so any plain
  // static server can serve them.
  if (!path.extname(p)) p += '.html';

  // Cache-busting query strings would otherwise collide (style.css?v=1 vs ?v=2).
  if (u.search) {
    const ext = path.extname(p);
    p = p.slice(0, -ext.length) + '__q' + shortHash(u.search) + ext;
  }

  const rel = external ? path.join('_ext', u.host, p) : p;
  return rel.replace(/^\/+/, '');
}

function saveAsset(rawUrl, body) {
  const rel = localPathFor(rawUrl);
  if (!rel) return;
  const abs = path.join(OUT, rel);
  // Guard against a crafted path escaping the output directory.
  if (!abs.startsWith(OUT + path.sep)) return;
  mkdirp(path.dirname(abs));
  fs.writeFileSync(abs, body);
  assetMap.set(rawUrl.split('#')[0], rel);
}

/** Scroll the whole page slowly so lazy-loads and scroll animations fire. */
async function fullScroll(page) {
  await page.evaluate(async ({ step, delay }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const height = () => document.body.scrollHeight;
    for (let y = 0; y < height(); y += step) {
      window.scrollTo(0, y);
      await sleep(delay);
    }
    window.scrollTo(0, height());
    await sleep(delay * 2);
    window.scrollTo(0, 0);
    await sleep(delay);
  }, { step: CFG.scrollStepPx, delay: CFG.scrollDelayMs });
}

/** Read every CSS rule the page actually has, including injected <style>. */
async function animationAudit(page) {
  return page.evaluate(() => {
    const keyframes = [];
    const rules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list;
      try { list = sheet.cssRules; } catch { continue; } // cross-origin sheet
      if (!list) continue;
      for (const rule of Array.from(list)) {
        if (rule.type === CSSRule.KEYFRAMES_RULE) {
          keyframes.push({ name: rule.name, css: rule.cssText });
        } else if (rule.style) {
          const { animation, transition, transform, willChange } = rule.style;
          if (animation || transition || (transform && transform !== 'none') || willChange) {
            rules.push({
              selector: rule.selectorText,
              animation: animation || null,
              transition: transition || null,
              transform: transform || null,
              willChange: willChange || null,
            });
          }
        }
      }
    }

    // Elements currently mid-animation, plus anything the page marked up for
    // a scroll-reveal library (AOS, GSAP, Framer, Locomotive, data-scroll...).
    const animated = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const marked = Array.from(el.attributes).some((a) =>
        /^data-(aos|scroll|animate|gsap|framer|motion|reveal|parallax)/i.test(a.name));
      const moving = cs.animationName !== 'none' || cs.transitionDuration !== '0s';
      if (!marked && !moving) continue;
      animated.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString?.().slice(0, 160) || null,
        animationName: cs.animationName !== 'none' ? cs.animationName : null,
        animationDuration: cs.animationDuration,
        animationTimingFunction: cs.animationTimingFunction,
        animationDelay: cs.animationDelay,
        transitionProperty: cs.transitionDuration !== '0s' ? cs.transitionProperty : null,
        transitionDuration: cs.transitionDuration,
        dataAttrs: Object.fromEntries(
          Array.from(el.attributes)
            .filter((a) => a.name.startsWith('data-'))
            .map((a) => [a.name, a.value])),
      });
    }

    // Which animation library is driving it, if any.
    const libs = Object.keys(window).filter((k) =>
      /^(gsap|ScrollTrigger|AOS|Swiper|Lenis|Locomotive|anime|Motion|Rellax|Splide|barba)/i.test(k));

    return {
      keyframes,
      rules,
      animated: animated.slice(0, 500),
      animatedTotal: animated.length,
      libraries: libs,
      fonts: Array.from(document.fonts).map((f) => ({
        family: f.family, weight: f.weight, style: f.style, status: f.status,
      })),
      media: Array.from(document.querySelectorAll('video, audio, source')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        src: el.currentSrc || el.src || el.getAttribute('src'),
        poster: el.getAttribute('poster'),
        autoplay: el.autoplay ?? null,
        loop: el.loop ?? null,
      })),
    };
  });
}

async function discoverLinks(page) {
  return page.evaluate((host) =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.href)
      .filter((h) => { try { return new URL(h).host === host; } catch { return false; } })
      .map((h) => { const u = new URL(h); u.hash = ''; return u.href; }),
  ORIGIN.host);
}

/** Seed the crawl from sitemap.xml when the site publishes one. */
async function sitemapUrls(page) {
  try {
    const res = await page.request.get(new URL('/sitemap.xml', ORIGIN).href, { timeout: 15000 });
    if (!res.ok()) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((m) => m[1])
      .filter((u) => { try { return new URL(u).host === ORIGIN.host; } catch { return false; } });
  } catch { return []; }
}

async function main() {
  [OUT, SHOTS, AUDIT].forEach(mkdirp);

  const browser = await launch();
  const desktop = CFG.breakpoints.find((b) => b.name === 'desktop') ?? CFG.breakpoints.at(-1);
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: desktop.width, height: desktop.height },
    deviceScaleFactor: desktop.dsf,
  });
  const page = await ctx.newPage();

  // Harvest every byte the browser fetches.
  page.on('response', async (res) => {
    try {
      if (!res.ok()) return;
      const req = res.request();
      if (req.method() !== 'GET') return;
      saveAsset(res.url(), await res.body());
    } catch { /* body unavailable (redirect, cached, aborted) - fine */ }
  });

  const queue = [];
  const seen = new Set();
  const enqueue = (href) => {
    const clean = href.split('#')[0];
    if (!seen.has(clean)) { seen.add(clean); queue.push(clean); }
  };

  CFG.startPaths.forEach((p) => enqueue(new URL(p, ORIGIN).href));
  (await sitemapUrls(page)).forEach(enqueue);
  console.log(`==> seeded ${queue.length} url(s)`);

  const visited = [];

  while (queue.length && visited.length < CFG.maxPages) {
    const url = queue.shift();
    process.stdout.write(`  -> ${url} `);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (err) {
      console.log(`FAILED (${err.message.split('\n')[0]})`);
      continue;
    }

    await fullScroll(page);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(CFG.settleMs);

    // Rendered DOM, after everything has run.
    const html = await page.content();
    const rel = localPathFor(url) ?? 'index.html';
    const abs = path.join(OUT, rel);
    mkdirp(path.dirname(abs));
    fs.writeFileSync(abs, html);
    assetMap.set(url, rel);

    const audit = await animationAudit(page);
    const slug = rel.replace(/[\/\\]/g, '_').replace(/\.html$/, '') || 'index';
    fs.writeFileSync(path.join(AUDIT, `${slug}.json`), JSON.stringify(audit, null, 2));

    (await discoverLinks(page)).forEach(enqueue);
    visited.push({ url, rel, animated: audit.animatedTotal, libs: audit.libraries });
    console.log(`ok (${audit.animatedTotal} animated nodes)`);
  }

  // Screenshot every visited page at every breakpoint.
  console.log('==> screenshots');
  for (const bp of CFG.breakpoints) {
    const bctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: bp.dsf,
    });
    const bpage = await bctx.newPage();
    for (const v of visited) {
      try {
        await bpage.goto(v.url, { waitUntil: 'networkidle', timeout: 60000 });
        await fullScroll(bpage);
        await bpage.waitForTimeout(CFG.settleMs);
        const slug = v.rel.replace(/[\/\\]/g, '_').replace(/\.html$/, '') || 'index';
        await bpage.screenshot({
          path: path.join(SHOTS, `${slug}.${bp.name}.png`),
          fullPage: true,
        });
      } catch (err) {
        console.log(`  !! ${v.url} @ ${bp.name}: ${err.message.split('\n')[0]}`);
      }
    }
    await bctx.close();
    console.log(`  ${bp.name} done`);
  }

  await browser.close();

  fs.writeFileSync(path.join(AUDIT, 'manifest.json'), JSON.stringify({
    origin: CFG.origin,
    capturedAt: new Date().toISOString(),
    pages: visited,
    assets: [...assetMap.entries()].map(([url, rel]) => ({ url, rel })),
  }, null, 2));

  console.log(`==> ${visited.length} pages, ${assetMap.size} assets`);
  console.log('==> now run: npm run rewrite');
}

main().catch((e) => { console.error(e); process.exit(1); });
