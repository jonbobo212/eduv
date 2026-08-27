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

/**
 * Chromium does not read HTTPS_PROXY from the environment, so on a machine
 * where egress is proxied it connects direct and the connection is reset.
 * Pass it through explicitly when the env sets one.
 */
export function proxyConfig() {
  const server = process.env.HTTPS_PROXY || process.env.https_proxy
              || process.env.HTTP_PROXY  || process.env.http_proxy;
  if (!server) return null;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  return { server, ...(noProxy ? { bypass: noProxy } : {}) };
}

export async function launch(opts = {}) {
  const executablePath = chromePath();
  // --no-sandbox is required when running as root in a container.
  const args = ['--no-sandbox', '--disable-dev-shm-usage', ...(opts.args ?? [])];
  const proxy = proxyConfig();
  return chromium.launch({
    ...opts,
    args,
    ...(executablePath ? { executablePath } : {}),
    ...(proxy ? { proxy } : {}),
  });
}
