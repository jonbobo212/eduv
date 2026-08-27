// Pass 3 - point every reference at the local copy.
//
// After capture, the saved HTML/CSS still refers to https://the-origin/... and
// to CDN hosts. Rewriting those to relative paths is what makes the mirror
// self-contained: it renders identically with the network switched off.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);
const MANIFEST = path.join(ROOT, 'audit', 'manifest.json');

if (!fs.existsSync(MANIFEST)) {
  console.error('!! audit/manifest.json missing - run `npm run capture` first');
  process.exit(1);
}

const { assets } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
// Longest URLs first, so a prefix never clobbers a longer match.
const pairs = assets
  .map(({ url, rel }) => [url, rel])
  .sort((a, b) => b[0].length - a[0].length);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const targets = walk(OUT).filter((f) => /\.(html?|css|js|json|svg|webmanifest)$/i.test(f));
let filesChanged = 0;
let totalSubs = 0;

for (const file of targets) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;

  // Where this file sits, so we can emit a correct relative path from it.
  const fromDir = path.dirname(file);

  for (const [url, rel] of pairs) {
    if (!text.includes(url)) {
      // Also catch the protocol-relative form (//host/path).
      const schemeless = url.replace(/^https?:/, '');
      if (!text.includes(schemeless)) continue;
    }
    const localAbs = path.join(OUT, rel);
    let relPath = path.relative(fromDir, localAbs).split(path.sep).join('/');
    if (!relPath.startsWith('.')) relPath = './' + relPath;

    const schemeless = url.replace(/^https?:/, '');
    const re = new RegExp(`(https?:)?${escapeRe(schemeless)}`, 'g');
    const hits = text.match(re);
    if (hits) {
      text = text.replace(re, relPath);
      totalSubs += hits.length;
    }
  }

  if (text !== before) {
    fs.writeFileSync(file, text);
    filesChanged++;
  }
}

// Report anything still pointing off-box, so gaps are visible rather than silent.
const stillRemote = new Set();
for (const file of targets) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    stillRemote.add(new URL(m[1]).host);
  }
  for (const m of text.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi)) {
    stillRemote.add(new URL(m[1]).host);
  }
}

console.log(`==> rewrote ${totalSubs} reference(s) across ${filesChanged} file(s)`);
if (stillRemote.size) {
  console.log('==> still loading from the network (add to extraHosts and re-run):');
  for (const h of [...stillRemote].sort()) console.log(`    ${h}`);
} else {
  console.log('==> fully self-contained: no remaining remote references');
}
