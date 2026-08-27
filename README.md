# eduv — Eduvisa site mirror

Makes a self-contained static copy of the live Eduvisa Consulting site so it
can be relaunched on **eduvisaconsulting.uz**, a domain the business controls.

Runs on Windows, macOS and Linux. Node 18+ is the only requirement — no bash,
no wget, no jq.

## Status

**The copy is made.** `site/` holds a self-contained mirror of the live site:
125 files, 48 MB, with every referenced asset present and every reference
repointed locally. It renders standalone with the network off.

What the site is: a **single-page React app**. All navigation is hash anchors
(`#home`, `#services`, `#universities`, `#contact`), so one 297 KB HTML file is
the whole site. A crawl reporting "1 page" is correct, not a failure.

Contents: 97 PNG, 12 JPG, 6 JS bundles, 2 CSS, 7 Inter woff2 fonts.

Verified by loading the copy in Chromium at four breakpoints: every image
request returns 200, and the only images that do not decode are the 11 sitting
inside `DIV.reveal` scroll-reveal wrappers, which start at `opacity: 0` and are
marked `loading="lazy"`. The live site behaves identically. Nothing is missing.

### Known gaps

- The page calls `api.eduvisaconsulting.com` for `banners`, `partners` and
  `news`. `banners` and `news` return empty arrays upstream; `partners` returns
  one item whose logo lives at `/api/uploads/`. That content is **not** part of
  the static copy - if the relaunch needs it, it needs the API or hardcoded
  replacements.
- The Yandex map is an iframe and still loads from `yandex.uz`.
- Social and contact links (Telegram, WhatsApp, Instagram, mail) stay remote,
  which is correct - they are outbound links, not assets.
- Forms render but do not submit. Backend was out of scope by request.

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
