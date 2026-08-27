// Shrink the mirror's images.
//
// The weight is dimensions, not encoder settings: several photos ship at
// 3072x4096 for cards that render around 220-390px wide. Capping the longest
// edge and re-encoding does the work; quality at display size is unchanged.
//
// Two details worth knowing about this site's assets:
//   - 69 files are JPEG data with a .png extension. Re-encoding them as JPEG
//     keeps that arrangement (browsers sniff content, not the extension) and
//     avoids touching a single reference.
//   - A handful genuinely are PNG with transparency. Those stay PNG, or the
//     logos gain black boxes.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, CFG.outDir);

const FALLBACK_EDGE = Number(process.env.MAX_EDGE ?? 1400); // used when a size wasn't measured
const DPR = Number(process.env.DPR ?? 2);   // serve retina, not more
const MIN_EDGE = 320;                        // never shrink below something usable

// Measured display widths from tools/measure-render.mjs, keyed by URL path.
const sizesPath = path.join(ROOT, 'audit', 'render-sizes.json');
const rendered = fs.existsSync(sizesPath)
  ? JSON.parse(fs.readFileSync(sizesPath, 'utf8')) : {};
if (!Object.keys(rendered).length)
  console.log('note: no render-sizes.json - falling back to a flat cap. Run `npm run measure` first.\n');

/** Target pixel width for this file: what it displays at, times DPR. */
function targetEdge(file) {
  const url = '/' + path.relative(OUT, file).split(path.sep).join('/');
  const shown = rendered[url];
  if (!shown) return FALLBACK_EDGE;
  return Math.max(MIN_EDGE, Math.min(FALLBACK_EDGE, Math.ceil(shown * DPR)));
}
const JPEG_Q     = Number(process.env.JPEG_Q     ?? 82);
const MIN_BYTES  = Number(process.env.MIN_BYTES  ?? 20_000); // leave tiny files alone

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

const files = walk(OUT).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
let before = 0, after = 0, changed = 0, skipped = 0;
const notes = [];

for (const f of files) {
  const buf = fs.readFileSync(f);
  before += buf.length;

  let meta;
  try { meta = await sharp(buf).metadata(); }
  catch { after += buf.length; skipped++; continue; }

  // Constrain WIDTH, not the longest edge. An image is displayed at a CSS
  // width; capping the longest edge of a portrait photo clamps its height and
  // leaves the width far under target, which shows up as a soft image on a
  // retina screen.
  const MAX_EDGE = targetEdge(f);
  const oversized = (meta.width ?? 0) > MAX_EDGE;

  // Small and correctly sized already - not worth recompressing.
  if (buf.length < MIN_BYTES && !oversized) { after += buf.length; skipped++; continue; }

  let pipe = sharp(buf, { animated: false });
  if (oversized) pipe = pipe.resize({ width: MAX_EDGE, withoutEnlargement: true });

  // Transparency must survive; everything else becomes JPEG regardless of
  // the name on the file.
  const keepPng = meta.hasAlpha === true;
  pipe = keepPng
    ? pipe.png({ compressionLevel: 9, palette: true, effort: 8 })
    : pipe.jpeg({ quality: JPEG_Q, mozjpeg: true, progressive: true });

  let outBuf;
  try { outBuf = await pipe.toBuffer(); }
  catch (e) { after += buf.length; skipped++; notes.push(`  skip ${f}: ${e.message.slice(0,60)}`); continue; }

  // Never make a file bigger.
  if (outBuf.length >= buf.length) { after += buf.length; skipped++; continue; }

  fs.writeFileSync(f, outBuf);
  after += outBuf.length;
  changed++;
  const saved = ((1 - outBuf.length / buf.length) * 100).toFixed(0);
  if (buf.length > 300_000) {
    notes.push(`  ${path.relative(OUT, f)}  ${(buf.length/1048576).toFixed(2)}MB -> ${(outBuf.length/1048576).toFixed(2)}MB (-${saved}%)` +
               (oversized ? `  ${meta.width}x${meta.height} -> ${MAX_EDGE}w` : ''));
  }
}

console.log(notes.join('\n'));
console.log(`\nrewrote ${changed}, left ${skipped} alone`);
console.log(`images: ${(before/1048576).toFixed(1)}MB -> ${(after/1048576).toFixed(1)}MB ` +
            `(-${((1-after/before)*100).toFixed(0)}%)`);
