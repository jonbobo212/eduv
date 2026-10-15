# Asia Academia — asiacademia.com

Static marketing site for ASIAACADEMIA SDN. BHD. (1464119-D).

## Brand

Colours were sampled from the company's own Canva business card rather than
guessed: navy `#002243` and gold `#B4985E`. The logo in `site/assets/` is the
real emblem, exported from that card and cropped — not a redraw.

The brief asked for vibrant and colourful, but the identity is navy and gold,
which is neither. The resolution: navy/gold holds the chrome (header, footer,
logo lockup) so the page stays recognisably Asia Academia, and each study
destination carries its own saturated accent — Malaysia emerald, Australia
coral, New Zealand sky, Germany crimson, pathways violet.

## Content

Sourced from the company's "Study in Malaysia and Australia" deck (40 pages)
and the business card, both in their Canva account. Malaysia and Australia
material is theirs. **New Zealand and Germany/SRH are not in that deck** — those
sections carry accurate general facts only and need the company's own
specifics before launch.

## Languages

English and Russian. Russian is first-class, not an afterthought: the source
deck is entirely Russian and the company runs an office in Dushanbe, so the
audience is Russian-speaking Central Asia. Copy lives in `site/assets/app.js`.

## Run

```bash
cd site && python3 -m http.server 8080
```

No build step — plain HTML, CSS and one JS file.

## Needs confirming before launch

- Two phone numbers appear in their material: `+60 19-781 00 47` (deck) and
  `+60 11-6990 9635` (card). Both are currently on the page.
- Two addresses: `Level 15, DPulze Cyberjaya` (deck) vs `FR-03M-05, Tamarind
  Suites` (card).
- The card prints the website as `asiacadmeia.com` and links `ariacademia.com`;
  the deck's contact page says `ARIA ACADEMIA SDN. BHD.` while its overview says
  `ASIAACADEMIA SDN. BHD.`
- Telegram handle is assumed to be `t.me/asiacademia`.
- `asiacademia.com` currently returns HTTP 500 from nginx — something is already
  deployed there and erroring.
