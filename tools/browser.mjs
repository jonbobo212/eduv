// Shared browser launcher.
//
// Sandboxed/CI images often ship a Chromium that does not match the Playwright
// npm version's expected build. Prefer an explicit binary when one is present
// (CHROME_PATH, or the image's pre-installed Chromium) and only fall back to
// Playwright's own download when neither exists.

import { chromium } from 'playwright';
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function chromePath() {
  return CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
}

export async function launch(opts = {}) {
  const executablePath = chromePath();
  // --no-sandbox is required when running as root in a container.
  const args = ['--no-sandbox', '--disable-dev-shm-usage', ...(opts.args ?? [])];
  return chromium.launch({ ...opts, args, ...(executablePath ? { executablePath } : {}) });
}
