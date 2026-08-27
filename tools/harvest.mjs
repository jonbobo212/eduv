// Supplemental asset pass - pure Node, no wget needed.
//
// The browser pass only saves what the page actually *loaded*. That misses
// things that are referenced but not fetched in the run we observed:
//   - srcset candidates the browser didn't pick for our viewport/DPR
//   - <link rel=preload/prefetch/icon>, og:image, manifest icons
//   - url() inside stylesheets that only apply to other breakpoints
//   - @import chains
// Those matter: resize the copy on a phone and the missing srcset entry is a
// broken image. This pass parses what we saved, finds every referenced URL we
// don't yet have, and fetches it - repeating until nothing new turns up.

import './net.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const MANIFEST = path.join(ROOT, 'audit', 'manifest.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

if (!fs.existsSync(MANIFEST)) {
  console.error('!! audit/manifest.json missing - run `npm run capture` first');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const ORIGIN = new URL(manifest.origin ?? CFG.origin);

// rel -> original url, so a saved file can resolve its own relative refs.
const relToUrl = new Map(manifest.assets.map(({ url, rel }) => [rel, url]));
const haveUrl = new Set(manifest.assets.map((a) => a.url));

const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const shortHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
};

const EXT_BY_TYPE = [
  [/text\/css/i, '.css'],
  [/javascript|ecmascript/i, '.js'],
  [/image\/png/i, '.png'], [/image\/jpe?g/i, '.jpg'], [/image\/gif/i, '.gif'],
  [/image\/svg/i, '.svg'], [/image\/webp/i, '.webp'], [/image\/avif/i, '.avif'],
  [/font\/woff2|application\/font-woff2/i, '.woff2'], [/font\/woff/i, '.woff'],
  [/font\/ttf|application\/x-font-ttf/i, '.ttf'], [/font\/otf/i, '.otf'],
  [/application\/json/i, '.json'],
  [/video\/mp4/i, '.mp4'], [/video\/webm/i, '.webm'],
  [/text\/html/i, '.html'],
];
const extFor = (ctype) => (EXT_BY_TYPE.find(([re]) => re.test(ctype ?? '')) ?? [null, '.bin'])[1];

function localPathFor(rawUrl, ctype) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const external = u.host !== ORIGIN.host;
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index' + (ctype ? extFor(ctype) : '.html');
  // No extension in the path (e.g. /css2): take it from what the server said.
  if (!path.extname(p)) p += ctype ? extFor(ctype) : '.html';
  if (u.search) {
    const ext = path.extname(p);
    p = p.slice(0, -ext.length) + '__q' + shortHash(u.search) + ext;
  }
  return (external ? path.join('_ext', u.host, p) : p).replace(/^\/+/, '');
}

/** Every URL referenced by a chunk of HTML or CSS. */
function extractRefsFromJs(text) {
  const out = new Set();
  // Bundled code refers to assets as plain string literals:
  //   "/assets/curtinuniversity-C6v_Hy2G.png"
  // Match quoted paths ending in an asset extension.
  const ASSET = /["'`]([^"'`\s]+\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp4|webm|mp3|json))["'`]/gi;
  for (const m of text.matchAll(ASSET)) {
    const v = m[1];
    if (/^(data:|blob:)/i.test(v)) continue;
    // UI strings can look like filenames ("Foto 3x4 (jpg or png)"). A real
    // path has no spaces, parentheses or commas - skip the prose.
    if (/[\s(),]/.test(v)) continue;
    out.add(v);
  }
  return [...out];
}

function extractRefs(text, isCss) {
  const out = new Set();
  const add = (v) => { if (v) out.add(v.trim()); };

  // url(...) and @import - present in CSS and in inline style attributes.
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]);
  for (const m of text.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) add(m[1]);

  if (isCss) return [...out];

  for (const m of text.matchAll(/\b(?:src|href|poster|data-src|data-bg)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  // srcset / data-srcset: "a.jpg 1x, b.jpg 2x" - take every candidate.
  for (const m of text.matchAll(/\b(?:srcset|data-srcset|imagesrcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const cand of m[1].split(',')) add(cand.trim().split(/\s+/)[0]);
  }
  // og:image and friends live in content="".
  for (const m of text.matchAll(/<meta[^>]+content\s*=\s*["'](https?:\/\/[^"']+|\/[^"']+)["'][^>]*>/gi)) {
    if (/property\s*=\s*["'](og:image|twitter:image)/i.test(m[0])) add(m[1]);
  }
  return [...out];
}

const SKIP = /^(data:|blob:|javascript:|mailto:|tel:|#|about:)/i;

function resolveRef(ref, fromRel, isJs = false) {
  if (!ref || SKIP.test(ref)) return null;
  const baseUrl = relToUrl.get(fromRel);
  if (!baseUrl) return null;
  try {
    // A bare filename inside a bundle ("16.png") is data, not a path relative
    // to the bundle: the build emits the file at the site root, so resolving
    // it against /assets/ gives a 404. Try the root for those.
    const base = (isJs && !ref.includes('/')) ? ORIGIN.href : baseUrl;
    const u = new URL(ref, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

async function fetchOne(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ctype = res.headers.get('content-type') ?? '';
  // An off-origin HTML response is a third-party page, not an asset we need.
  if (/text\/html/i.test(ctype) && new URL(url).host !== ORIGIN.host) {
    throw new Error('skipped: off-origin HTML');
  }
  return { body: Buffer.from(await res.arrayBuffer()), ctype };
}

async function main() {
  let round = 0;
  let grandTotal = 0;

  while (round < 5) {
    round++;
    const candidates = new Set();

    for (const file of walk(OUT)) {
      if (!/\.(html?|css|js|mjs)$/i.test(file)) continue;
      const rel = path.relative(OUT, file).split(path.sep).join('/');
      // Off-origin HTML is somebody else's site. Parsing it for links turns a
      // mirror into an unbounded crawl of the whole web (one embedded map
      // widget is enough to do it). External hosts contribute assets only.
      if (rel.startsWith('_ext/') && /\.html?$/i.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const isJs = /\.m?js$/i.test(file);
      const refs = isJs ? extractRefsFromJs(text) : extractRefs(text, /\.css$/i.test(file));
      for (const ref of refs) {
        const abs = resolveRef(ref, rel, isJs);
        if (abs && !haveUrl.has(abs)) candidates.add(abs);
      }
    }

    if (!candidates.size) {
      console.log(`==> round ${round}: nothing new referenced - harvest complete`);
      break;
    }

    console.log(`==> round ${round}: ${candidates.size} referenced asset(s) not yet saved`);
    let ok = 0, fail = 0;

    // Modest concurrency - enough to be quick, gentle enough not to look hostile.
    const list = [...candidates];
    const WORKERS = 6;
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      while (list.length) {
        const url = list.pop();
        haveUrl.add(url); // claim it up front so we never fetch it twice
        try {
          const { body, ctype } = await fetchOne(url);
          const rel = localPathFor(url, ctype);
          if (!rel) { fail++; continue; }
          const abs = path.join(OUT, rel);
          if (!abs.startsWith(OUT + path.sep)) { fail++; continue; }
          mkdirp(path.dirname(abs));
          fs.writeFileSync(abs, body);
          relToUrl.set(rel, url);
          manifest.assets.push({ url, rel });
          ok++;
        } catch (e) {
          fail++;
          console.log(`    miss ${url} (${e.message})`);
        }
      }
    }));

    grandTotal += ok;
    console.log(`    saved ${ok}, failed ${fail}`);
    if (!ok) break; // nothing retrievable; another round would repeat itself
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`==> harvest added ${grandTotal} asset(s); ${manifest.assets.length} total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
