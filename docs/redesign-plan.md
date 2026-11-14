# Field Signal redesign plan

Written 2026-11-14 for the implementing session. Feature freeze is **Sunday 15 Nov, 12:00**.
Scope: start page, navigation, farmer flow, feed buyer screen. The simulator and About pages only
pick up the new tokens.

## 1. The idea

The challenge is called *Field Shift: Adapting Farms with NASA Data*. The site follows that
sentence in order, and every screen belongs to one of its three parts:

1. **Shift** — what has changed at this farmer's own place over 25 years, seen from space.
2. **Adapt** — which rotation copes with that change, and how many poor seasons it would have avoided.
3. **Plan** — what to grow where next season, in a form the farmer can keep.

A farmer is inspired by seeing their own land and their own numbers, so the app shows real
satellite imagery of the field and states results in seasons and hectares, never in abstract points
alone.

### Who it is for

- **First: managers of larger arable farms** in Alba. Comfortable with numbers; laptop at the desk,
  phone in the field. Layout conflicts are settled in their favour.
- **Also: small family farmers** on a phone. Every screen must still work for them: plain words,
  one decision at a time, 44 px touch targets.
- **Feed buyers** on the feed screen. **The jury** sees it all in a 5-minute pitch.

### Principles

1. The answer comes first; the evidence is one tap away.
2. Say it in the farmer's units: seasons, hectares, days. Scores are secondary.
3. Every number keeps its source, period and confidence. Every agronomic risk keeps "verify with an agronomist".
4. Minimal: no decoration. The only rich element on any screen is the land itself (map or satellite image).
5. Good news is quiet, problems are loud: good seasons are pale grey-green, only weak years carry colour.

## 2. Look (update the design system first)

Minimal, white, one green. Keep the token **names** in `apps/web/src/app/globals.css` so components
keep compiling; change the values and remove decoration.

| Token | New light value | Note |
|---|---|---|
| `--ground`, `--surface` | `#ffffff` | No tinted page background |
| `--surface-sunken` | `#f3f5f1` | Quiet fills, good-season cells |
| `--line` | `#e2e6e0` | Hairlines replace card borders |
| `--ink` | `#111512` | |
| `--ink-muted` | `#5f675f` | Check 4.5:1 on white |
| `--field` | `#1f6b45` (unchanged) | The single accent: primary action, best rotation, links |
| `--wheat*` | keep | Crop colour only; no longer a highlight or badge fill |
| `--signal*` | keep | Source chips only |
| status colours | keep | Always with icon and word |

- Dark mode: keep the existing dark values, with `--ground` and `--surface` both near-black neutral. Check every screen once in dark.
- **Type:** keep Bricolage Grotesque (headings) and Geist (text); drop Geist Mono from the UI and use tabular numerals instead. Body 17 px. Result sentences 40–52 px on laptop, 28–34 px on phone. Use at most four sizes per screen.
- **Shape:** 10–12 px radius on controls, 16 px on maps. No shadows except on things that float (sheet, map overlay, sticky action bar).
- **Layout:** sections are separated by white space and one hairline, not by cards. `Card` stays only for floating or interactive containers. Page width 1200 px on laptop; text columns at most 720 px.
- **Motion:** keep the existing durations and easing. One moment per screen: the season strips fill left to right, 2001 to 2025. Nothing else animates beyond press and focus feedback. Respect `prefers-reduced-motion`.
- Remove: the decorative rings on the verdict card, the wheat "+39 points" pill, staggered card rises, eyebrow labels above titles, the large demo-data block (it becomes a one-line bar).

### New shared components (`src/components/ui/`)

| Component | Purpose |
|---|---|
| `Button` | `primary` (green fill), `secondary` (hairline), `quiet` (text). Replaces hand-written button classes |
| `Segmented` | 2–4 options, radio semantics. Used for priorities, crop tabs, list/map switch |
| `Stepper` | "1 Field · 2 Rotation · 3 Priorities" with done/current/todo states |
| `SeasonStrip` | One row of season cells for one rotation, on a shared year axis. Good = pale, watch = amber with `!`, poor = red with `×`, no data = dashed outline. Supports a selected year |
| `Disclosure` | "Details" open/close for evidence sections |
| `NoticeBar` | One-line bar for demo data and offline fallback |
| `Section` | Title, optional hint, hairline, consistent spacing; replaces `SectionTitle` + `Card` pairs |

## 3. Structure and navigation

| Route | Before | After |
|---|---|---|
| `/` | Farmer form | **New start page** |
| `/field` | did not exist | Farmer flow (moved from `/`). Keeps `?lat=&lon=&place=` |
| `/feed` | Feed buyer | Feed buyer, rebuilt |
| `/about`, `/simulator` | unchanged | New tokens only |

- Header: logo (links to `/`), then **My field · Feed buyer · About**, language switch. Phone keeps the bottom bar with the same three items.
- Update every link that points at the farmer flow: the feed zone sheet's "Compare rotations here", the simulator's back link, the PWA manifest `start_url`, the service worker's cached routes.
- Remember the last field, rotation and priorities in `localStorage` (try/catch). A returning farmer who opens `/field` sees "Continue with your field near Aiud, 42 ha" above the empty flow.

## 4. Screens

### 4.1 Start page (`/`)

Job: in ten seconds a farmer knows what this is, believes it, and starts.

1. **Hero.** A real satellite image of Transylvania or the Mureș valley fills the top of the page. Over it: "Your field has 25 years of history, seen from space." Below: "See how your rotation would have done in every season since 2001, and what would have done better." One button: **Draw your field**. Secondary link: "I buy feed".
2. **Proof strip.** The real `SeasonStrip` for the demo field near Aiud, three rotations, with the caption "A field near Aiud: 8 poor seasons with maize and wheat, 3 with a drought-tolerant rotation" (compute the numbers from the mock, do not hard-code).
3. **Three steps**, each with a small live piece of the product, not an illustration: Draw the field · Say what you grow and what matters · See 25 seasons and a plan.
4. **What it cannot see** (hail, pests, prices, your field work), taken from About. Honesty is part of the pitch.
5. Sources line and the existing non-endorsement note. No NASA logo.

Hero image: fetch one cloud-free summer MODIS true-colour scene from NASA Worldview Snapshots
(`wvs.earthdata.nasa.gov/api/v1/snapshot`, layer `MODIS_Terra_CorrectedReflectance_TrueColor`),
check it by eye, and commit it as WebP under `public/` with a credit line ("NASA Worldview"). Verify
the endpoint and parameters before relying on them. If it cannot be fetched in 20 minutes, use the
live map at region zoom as the hero instead.

### 4.2 Farmer flow (`/field`)

Three steps instead of one long form. Laptop: map on the left (sticky, about 60 % wide), step panel
on the right. Phone: map on top (at least 55 % of the screen height), panel below, sticky action bar.

**Step 1 — Field**
- **Satellite basemap by default**, with a Map/Satellite switch. Farmers recognise their parcels from above; nobody can trace a field on a street map. Candidate sources, in order: Esri World Imagery, EOX Sentinel-2 cloudless, NASA GIBS (HLS 30 m). Check each one's terms and attribution before using it and record the choice in the README data-sources table.
- **Find the place:** a search box over the commune names already in the sourcing data (zone name and centroid, no network needed), and a "Use my location" button (browser geolocation; handle refusal quietly).
- Drawing as it works today (tap corners, undo, clear, done), with the live area in hectares shown large. Keep the 1–1200 ha limits and their messages.
- Continue is disabled until a field is drawn; say why.

**Step 2 — Rotation**
- Year slots ("Year 1" to "Year 4"), each opening a crop picker. Two filled by default, add up to four.
- Presets above the slots: "Maize, wheat" and "Maize, sunflower, wheat". Offer only crops in `ROTATION_CROPS`.

**Step 3 — What matters**
- Replace the four 0–100 sliders with a three-level `Segmented` per priority: **Less · Matters · Matters most** (send 0.2 / 0.6 / 1.0; the API normalises weights). Keep the one-line hint under each.
- The irrigation switch lives here.
- Button: **Show my 25 seasons**.

**Loading:** keep the skeleton, add three plain lines of what is being read (heat and rain, vegetation, soil water). No fake progress bar.

### 4.3 Results (same route, after analysis)

One page, answer first. On laptop a sticky in-page nav: **Shift · Rotations · Plan · Evidence**.
One selected rotation for the whole page (state lifted to `ResultsView`): choosing it in one section
changes the plan map and the explanation too. Today there are three separate pickers.

1. **Header.** Place name, area, period. Actions: Change field or rotation · Print · Copy link.
2. **Verdict, as a sentence.** "A drought-tolerant rotation would have had **3 poor seasons instead of 8** since 2001." Under it: its crop sequence and "Fits your priorities 88 of 100; your rotation now 49". Count poor seasons from `replay` (`status === "bad"`). If the current rotation is already best, say so plainly.
3. **Shift — what changed at this place.** Up to three statements built from `indicators`: mean of the last 5 years with data against the mean of the first 10, with the unit and a sparkline, for example "Hot days at flowering: 21 a year lately, 12 in 2001–2010". Show a statement only when the series has enough years; state the two periods; make no causal claim. Each keeps its source chip.
4. **Adapt — rotations compared.** Three rows, best first. Each row: name, crops, score, its `SeasonStrip`. One shared year axis. Selecting a year lights that column in all rows and shows the three outcomes with their reasons (inline panel on laptop, bottom sheet on phone). Each row opens to its explanation: why, evidence, benefits, what we don't know, risks to check locally. This one component replaces `StrategyCards`, `ReplayGrid` and `StrategyExplanations`.
   - Phone: the strips stay as a compact overview (cells about 13 px wide, not tap targets); tapping a strip opens a sheet listing the years top to bottom with the three outcomes side by side.
5. **Plan — what to grow where.** The existing hexagon map and plot table for the selected rotation, with the satellite basemap. Season stepper stays. Print styles give a clean one-page plan: verdict sentence, plot table, map, sources.
6. **Evidence.** Indicators, soil, sources and caveats. Open on laptop, behind "Details" on phone.

Demo or offline data: a one-line `NoticeBar` pinned under the header for the whole page.

### 4.4 Feed buyer (`/feed`)

Laptop: map on the left (sticky), work panel on the right. Phone: a **List · Map** switch.

1. **Recommendation first**, as a sentence with its numbered actions and confidence. Assumptions behind "Details".
2. **Crop tabs** (`Segmented`).
3. **Commune table**, sorted by lowest supply risk first; sortable by name, area, supply risk, quality warnings, confidence. Columns never move; a risky commune changes its row's status mark, not the layout. Phone: the same data as rows of name, area and risk badge.
4. **Detail** on selecting a row or marker: the existing zone details, in a side panel on laptop and the sheet on phone. Keep "Compare rotations here", pointing at `/field`.
5. **Compare** by ticking two rows, instead of two dropdowns far down the page.
6. **Soybean and pea scenario** slider, then caveats and sources.

## 5. Copy

- Every string exists in both `messages/en.json` and `messages/ro.json`. Romanian stays formal ("dumneavoastră").
- Rename: "Analyse" → "Show my 25 seasons"; "Step 1 of 2" → stepper labels; "Total score" → "Fit with your priorities".
- Results are written as full sentences with the number inside them.
- Never imply NASA endorses or partners with the tool.

## 6. Order of work

| # | Work | Rough time | Done when |
|---|---|---|---|
| 0 | Commit the open draw-only change on `feat/draw-only-field`; branch `feat/redesign` from it | 10 min | Clean tree |
| 1 | Tokens, type scale, the seven shared components | 1.5 h | Old screens still render, now white and flat |
| 2 | Routes, header, bottom bar, `/field` move, link updates | 1 h | No dead links in either language |
| 3 | Results page (sections 1–6, shared selection) | 3.5 h | Works with mock and live API, phone and laptop |
| 4 | Farmer flow steps, satellite basemap, place search, locate | 3 h | A field can be found, drawn and analysed on a phone |
| 5 | Start page | 1.5 h | Hero, proof strip, steps, limits |
| 6 | Feed buyer | 2.5 h | Table, detail, compare, scenario |
| 7 | Copy pass, dark mode, keyboard and screen-reader pass, print styles | 1.5 h | See checks below |
| 8 | `docs/DESIGN.md`, design-system page, new screenshots in `docs/screenshots/`, deck screenshots | 1 h | Docs match the build |

Results come before the form because they are what the jury and the farmer judge.
**If time runs short, cut in this order:** print styles, compare-by-ticking (keep the dropdowns),
table sorting, "Use my location", the saved-field shortcut.

## 7. Rules for the implementing session

- Read `apps/web/AGENTS.md` first: this is Next.js 16 and its docs are in `node_modules/next/dist/docs/`.
- `src/lib/contracts.ts` is generated and fixed. No API changes.
- Do not touch the simulator's internals.
- Status is never colour alone. Touch targets are at least 44 px. Focus is always visible.
- Local ports 3000 and 8000 are taken; run the web app on 3010 and the API on 8010.
- Checks before calling a phase done: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/web`, then look at the screen in a browser at 390 px and 1440 px, in Romanian and English, light and dark.
- Merging to `main` deploys to fieldsignal.land. Ask before merging.
