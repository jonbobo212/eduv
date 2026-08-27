# eduv — Eduvisa site mirror

Makes a self-contained static copy of the live Eduvisa Consulting site so it
can be relaunched on **eduvisaconsulting.uz**, a domain the business controls.

Runs on Windows, macOS and Linux. Node 18+ is the only requirement — no bash,
no wget, no jq.

## Status

**The copy has not been made.** The Claude Code session this was built in sits
behind an egress proxy that refuses `eduvisaconsulting.com` at the CONNECT
stage (HTTP 403). No page, image, or stylesheet from the site was ever
retrieved here, so nothing in this repo is derived from guesswork about the
design — it is the machinery to do the copy, not the copy.

Run it from an ordinary machine with normal internet access and you get the
real thing. Every pass is tested end to end against a local fixture.

Note the `.com` is still **publicly served**, so mirroring needs no account
access and no password — only a network that can reach it. Losing control of
the domain does not prevent copying what it serves.

## Run it

```bash
npm install
npm run doctor    # check prerequisites and that the site is reachable
npm run copy      # capture -> harvest -> rewrite
npm run serve     # preview at http://localhost:8080
npm run verify    # pixel-diff the copy against the live site
```

Start with `doctor`. It fails loudly if the site is unreachable, which saves
you a long crawl that would otherwise fill `site/` with error pages.

## The passes

| Pass | What it does |
|---|---|
| **capture** | Headless Chromium loads each page, scrolls it top to bottom, and saves every response it fetches. This is what gets the JS-injected and lazy-loaded imagery a plain download misses. Also crawls internal links, writes a per-page animation audit, and screenshots four breakpoints. |
| **harvest** | Parses the saved HTML and CSS for assets that are *referenced but were never loaded* — other `srcset` candidates, `preload`/icon links, `og:image`, and `url()` inside media queries that don't apply at the captured viewport. Fetches them and repeats until nothing new appears. |
| **rewrite** | Repoints every absolute and CDN URL at the local copy — HTML attributes, `srcset` lists, `<meta>` content, and CSS `url()`. Ends by naming anything still loading off-box. |
| **verify** | Screenshots live vs. local at each breakpoint and pixel-diffs them, writing a diff image wherever the copy drifts. |

`capture` and `harvest` are complementary and both matter. Capture alone misses
the responsive variants — resize the copy on a phone and you get a broken
image. Harvest alone would miss everything that only exists after JS runs.

## Why harvest exists

Tested against a fixture where the browser loaded exactly one image but the
markup referenced five. Capture saved 1. Harvest recovered the 2x and 3x
`srcset` candidates, the `og:image`, and a background used only under
`@media (max-width:500px)` — then confirmed on a second round that nothing was
left. Rewrite pointed all of them at local files.

## Animations

`audit/*.json` records, per page:

- every `@keyframes` block verbatim
- every rule with `animation`, `transition`, `transform`, or `will-change`
- computed duration, delay and easing for each animated element
- `data-aos` / `data-scroll` / `data-gsap`-style scroll-reveal attributes
- which animation library is present (GSAP, AOS, Swiper, Lenis, Locomotive…)
- loaded webfonts, and every `<video>` / `<source>`

Because capture downloads the animation library itself, motion usually carries
over rather than needing reimplementation. The audit is there to check it, and
to rebuild by hand if a library turns out to be hotlink-protected.

## Configuration

`config.json`:

- `origin` — site to copy
- `outDir` — where the copy lands (default `site/`)
- `extraHosts` — extra hosts for the optional wget pass
- `breakpoints` — viewports for screenshots and diffing
- `maxPages` — crawl ceiling (default 100)
- `scrollStepPx` / `scrollDelayMs` — scroll pacing; slow it down if a
  lazy-loader is being missed
- `settleMs` — wait after scrolling before snapshotting

If `rewrite` reports hosts still loading from the network, add them to
`extraHosts` and re-run. That loop is what gets you to fully self-contained.

## Output

```
site/          the copy - open it with wifi off, it still works
audit/         per-page animation audits, asset manifest, verify results
screenshots/   full-page captures at every breakpoint
diffs/         pixel-diff images, written only where the copy drifts
```

`site/` is gitignored so the first commit stays reviewable. Once you have run
the copy and are happy with it, drop that line from `.gitignore` to commit it.

## Going live on .uz

1. Run the copy, confirm `npm run verify` diffs are near zero
2. Deploy `site/` to any static host — Cloudflare Pages, Vercel, Netlify
3. Check it on the host's own preview URL first (`*.pages.dev`, `*.vercel.app`)
4. Point `eduvisaconsulting.uz` and `www` at it
5. Set up email separately — the `.com` has no MX records at all

Nothing before step 4 touches DNS, and the `.uz` isn't serving yet, so there is
no live site to break.

## Notes

- Backend is out of scope by request. Forms render but do not submit; wire them
  to an endpoint afterwards.
- Prefer the owner's original assets over scraped ones where they exist — real
  resolution, correct fonts, no recompression.
- Chromium resolves via `CHROME_PATH`, then `/opt/pw-browsers/chromium`, then
  the system browser, then Playwright's own download.
- `npm run mirror:wget` is an optional extra wget pass. It needs bash/wget/jq
  and is not part of `npm run copy`.
- Re-running is safe and refreshes content in place.
