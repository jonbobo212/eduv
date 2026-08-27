# eduv — site mirror toolkit

A four-pass pipeline that produces a self-contained, byte-faithful static copy
of `eduvisaconsulting.com`, then measures how close the copy actually is.

## Status

**The copy has not been made yet.** The Claude Code session this was built in
runs behind an egress proxy that denies `eduvisaconsulting.com` at the CONNECT
stage:

```
kind:   connect_rejected
detail: gateway answered 403 to CONNECT (policy denial or upstream failure)
host:   eduvisaconsulting.com:443
```

Both `curl` and the sandbox's fetch tool were refused, so no page, image, or
stylesheet from the site was ever retrieved. Rather than guess at the design,
this repo contains the machinery to do the copy properly. Run it from any
machine with normal internet access and you get the real thing — or allowlist
the domain on the environment and run it here.

Everything below has been tested end-to-end against a local fixture site
(animations, scroll-triggered lazy images, absolute CDN-style URLs, multi-page
crawl). The passes work; they just need reachable input.

## Run it

```bash
npm install
npm run copy     # mirror -> capture -> rewrite
npm run serve    # preview at http://localhost:8080
npm run verify   # pixel-diff the copy against the live site
```

`npm run copy` is the whole job. `verify` needs the live site reachable too.

## The four passes

| Pass | Command | What it does |
|---|---|---|
| 1 | `npm run mirror` | `wget` recursive pull — HTML, CSS, JS, images, fonts. Catches everything reachable by parsing markup and stylesheets. |
| 2 | `npm run capture` | Headless Chromium renders each page, scrolls it top to bottom, and saves **every response the browser fetches**. This is what gets the JS-injected images, lazy-loaded media, and webfonts pass 1 cannot see. Also writes an animation audit and full-page screenshots at 4 breakpoints. |
| 3 | `npm run rewrite` | Repoints every absolute and CDN URL at the local copy, in both HTML attributes and CSS `url()`. Ends by listing anything still loading off-box. |
| 4 | `npm run verify` | Screenshots live vs. local at each breakpoint and pixel-diffs them. Prints a % difference per page and writes a diff image wherever it drifts. |

Passes 1 and 2 overlap deliberately — that redundancy is what closes the gap
between "looks right" and "is the same".

## Why two fetch passes

`wget` alone misses anything that only exists after JavaScript runs, which on a
modern marketing site is usually most of the imagery. The browser pass fixes
that by recording traffic rather than parsing source: it scrolls the full page
so lazy-loaders and scroll-reveal animations fire, then saves what came over
the wire. Anything either pass finds lands in the same tree.

## Animations

`audit/*.json` (per page) records:

- every `@keyframes` block, verbatim
- every rule carrying an `animation`, `transition`, `transform`, or `will-change`
- computed timing for each animated element — duration, delay, easing
- `data-aos` / `data-scroll` / `data-gsap`-style attributes that drive scroll reveals
- which animation library is on the page (GSAP, AOS, Swiper, Lenis, Locomotive, …)
- loaded webfonts and every `<video>` / `<source>`

Since pass 2 downloads the animation library itself, motion is usually carried
over by the copy rather than reimplemented. The audit is there to check it —
and to rebuild by hand if a library turns out to be loaded from a host that
blocks hotlinking.

## Configuration

`config.json`:

- `origin` — site to copy
- `outDir` — where the mirror lands (default `site/`)
- `extraHosts` — CDN / font hosts to pull down too. **If pass 3 reports hosts
  still loading from the network, add them here and re-run** — that is the loop
  that gets you to fully self-contained.
- `breakpoints` — viewports for screenshots and diffing
- `maxPages` — crawl ceiling (default 100)
- `scrollStepPx` / `scrollDelayMs` — scroll pacing. Slow it down if a lazy-loader
  is being missed.

## Output

```
site/          the copy - open it with the network off, it still works
audit/         per-page animation audits, manifest, verify results
screenshots/   full-page captures at every breakpoint
diffs/         pixel-diff images, written only where the copy drifts
```

`site/` is gitignored by default so the first commit stays reviewable. Once
you have run the copy and are happy with it, drop that line from `.gitignore`
to commit the mirror itself.

## Notes

- Backend is out of scope by request. Forms will render but not submit; wire
  them to whatever endpoint you want afterwards.
- Chromium resolution order is `CHROME_PATH`, then `/opt/pw-browsers/chromium`,
  then the system browser, then Playwright's own download — so it runs both in
  a sandbox with a preinstalled browser and on a normal laptop.
- Re-running is safe and refreshes content in place.
