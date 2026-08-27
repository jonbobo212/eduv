// Preflight. Tells you what is missing before you waste a long crawl on it.
import fs from 'node:fs';
import path from 'node:path';
import { chromePath } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const warn = (m) => console.log(`  warn  ${m}`);
let failures = 0;
let blocked = false;

console.log('\nchecking prerequisites\n');

const [maj] = process.versions.node.split('.').map(Number);
maj >= 18 ? ok(`node ${process.versions.node}`)
          : bad(`node ${process.versions.node} - need 18 or newer`);

try {
  await import('playwright');
  ok('playwright installed');
} catch {
  bad('playwright missing - run `npm install`');
}

const chrome = chromePath();
if (chrome) {
  ok(`chromium at ${chrome}`);
} else {
  warn('no system chromium found - playwright will use its own download');
  warn('if launching fails, run: npx playwright install chromium');
}

console.log(`\nchecking target: ${CFG.origin}\n`);

try {
  const ctl = AbortSignal.timeout(20000);
  const res = await fetch(CFG.origin, {
    signal: ctl,
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
  });
  if (res.ok) {
    ok(`reachable - HTTP ${res.status}`);
  } else if ([403, 407].includes(res.status)) {
    // A 403/407 on a plain GET of a public homepage is almost always the
    // egress proxy refusing the host, not the site refusing us. Crawling
    // would produce a directory full of error pages, so treat it as blocking.
    bad(`HTTP ${res.status} - the host is being refused, most likely by a ` +
        'network policy between you and the site');
    blocked = true;
  } else {
    warn(`responded HTTP ${res.status} - check the URL`);
  }
} catch (e) {
  bad(`unreachable: ${e.message}`);
  blocked = true;
}

if (blocked) {
  console.log('\n  The copy cannot run from here: it has to actually load the');
  console.log('  site. Run it from an ordinary machine with normal internet');
  console.log('  access, or allowlist the domain on this environment.');
}

console.log(failures ? `\n${failures} blocking problem(s)\n` : '\nall clear - run `npm run copy`\n');
process.exit(failures ? 1 : 0);
