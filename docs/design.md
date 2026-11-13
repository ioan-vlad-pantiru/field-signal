# Design

**Design system:** [Field Signal design system](https://claude.ai/artifact/KbNKKCCa6yDa59por1xYRZ)
(private until shared from its Share menu). It holds the tokens, the brand book, the slide and
document rules, component previews and the logo. The app's `apps/web/src/app/globals.css` uses the
same token names and values: change both together.

## In short

- **Colour roles:** `field` green is for actions and the brand. `signal` blue marks satellite and
  data sources. `wheat` is a highlight fill only. Status colours always come with an icon and a word.
- **Type:** Bricolage Grotesque for headings, Geist for text, and Geist Mono for numbers and source
  chips.
- **Motion:** 120, 220, 420 and 900 ms, with a "settle" ease-out. Each screen gets one orchestrated
  moment, such as the replay-grid cascade. Everything is instant under `prefers-reduced-motion`.
- **Maps:** OpenFreeMap vector tiles with terrain from AWS Terrain Tiles and hillshade. 3D
  buildings appear from zoom 14, and the camera tilts as you zoom in.

## Improvement plan

| # | Area | Change | Status |
|---|---|---|---|
| 1 | Identity | Design system tokens, type roles and motion vocabulary shared by app, deck and docs | done |
| 2 | Results | A verdict card first: the best rotation for your priorities versus today's, with the gap in points | done |
| 3 | Motion | Staggered cards, count-up numbers, sparkline draw, replay-grid cascade, sheet slide-up, pin drop, marker pop-in, press feedback | done |
| 4 | Map | Terrain, hillshade, sky, 3D buildings, tilt on zoom, fly-in on load | done |
| 5 | Data provenance | Source chips in signal blue with a satellite icon | done |
| 6 | About | Cards for what it does, the AI role and its limits, plus a NASA non-endorsement note | done |
| 7 | Pitch deck | [16:9 deck](https://claude.ai/artifact/FDMuFNM8vkRnrydZriN9X4) built from the design system (private until shared) | done |
| 12 | Field plan | "What to grow where" on a grid of 1 ha hexagons: hexagons on roads, buildings, water or woods (from OpenStreetMap) are left out, the rest are split into one plot per rotation year, coloured and extruded by crop, with a season stepper and a plot × season table (illustrative boundaries) | done |
| 13 | Farmland mask | Replace the OpenStreetMap check with real parcel data: LPIS/IACS parcels (APIA), or a cropland mask (ESA WorldCover 10 m, EUCROPMAP 10 m), or field boundaries traced from Sentinel-2 | next |
| 8 | Field step | Larger map on phones, with search by commune name; let the farmer draw the real field boundary for the field plan | next |
| 9 | Results | Compare two strategies side by side on the replay grid, with the cell difference highlighted | next |
| 10 | Feed | Zone heat layer from the NDVI ramp instead of markers only, plus a legend | next |
| 11 | Quality | Lighthouse PWA and axe accessibility audits, tested on real Android and iOS | next |
