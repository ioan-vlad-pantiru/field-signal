# Field Signal: mobile-first redesign, Step 0 (audit and proposal)

Branch `redesign/mobile-first`, cut from `origin/main` at `fffea08` (15 Nov 2026).
`feat/import-origins` is **not merged** into main, so the imported soy origins view is left out.
The Buyers segmented control has room for a third option, "Origins", once it lands.

Baseline on this commit: `pnpm test` 61/61 pass, `pnpm lint` clean, `pnpm typecheck` clean.

---

## 1. Inventory: what exists and where it goes

### Navigation and chrome

| Today | What it is | New design |
|---|---|---|
| Bottom tab bar, 6 items (Field, Farm, Feed, Stocks, About, Account) | Full-width bar on phones | **Replaced** by a floating pill bar with 3 items: My fields · Buyers · More |
| Top links, 6 items (icons only at `sm`, labels only at `lg`) | Desktop header | **Replaced** by a compact top bar with the same 3 items |
| Language picker (dropdown with globe, name, code, check) | Header | **Slimmed** to a one-tap `EN / RO` pill switch. It keeps the path and query, as today. On phones it sits in More and in the header of the landing page |
| Floating Assistant launcher (`fixed bottom-[9.5rem] right-4 z-30`) | Every page | **Moved**: a contextual "Ask" action (see §2.4) |
| Site footer (credit and team, `pb-28`) | Every page | **Moved** into More › About. The landing page keeps one line |
| Site header with logo and name | Every page | **Kept** on desktop. On phones it is only on the landing page; app screens show the screen title instead |

### `/field` (farmer flow, `farmer-flow.tsx` + `field-form.tsx`)

| Today | New design |
|---|---|
| `AccountFieldsBar`: "Your fields" chips, tick several, Open | **Merged** into the new **Start** screen as field cards |
| `SavedFieldBar`: "Continue with your field near X" (local, signed out) | **Merged**: shown as a field card on Start, tagged "This device" |
| Stepper 1 Field · 2 Rotation · 3 Priorities | **Removed**. The steps become two screens: Field (map) and Setup (one sheet). Progress shows as a 2-dot indicator in the action bar |
| Basemap segmented control on the map (Satellite / Map) | **Kept** as a round floating icon toggle, not a segmented control |
| Field step panel: h1, hint, place search, Locate, help text, selected-parcels box (Use / Separate / Clear), pick note, area and Restart | **Moved** onto the map as floating controls: search pill at the top, Locate and Brush as round buttons, a selection chip with the hectares and Use / Separate / Clear just above the action bar |
| Brush toggle "drag to select" | **Kept** as a floating round button |
| Hint pill on the map (`parcel.mapHint` / `zoomHint`) | **Kept** as the only hint: one short line in a floating chip |
| `FieldList` "kept fields" box + "Editing field N" | **Moved** into a "Fields in this analysis" sheet, opened from a counter chip on the map ("3 fields") |
| `SaveToAccount` (name + Save) inside steps 1 and 2 | **Moved**: a name field in the Setup sheet and a Save action in the results header. No separate block |
| Rotation step: presets, year slots, crop picker grid, limits line | **Merged** into the Setup sheet: crop chips in a row (tap a chip to change it, + to add, long-press or × to remove). The presets stay as two chips |
| Priorities step: 4 × Segmented (less / matters / most) + irrigation switch | **Merged** into the Setup sheet: 4 toggles ("Matters most"), off = "matters". The irrigation switch stays. Defaults leave Continue usable right away (see §2.3) |
| "Add another field" button + hint | **Moved** to a secondary action on the Field screen ("+ Field") |
| Sticky action bar (Back / Continue / Analyze, `needField` line) | **Kept and restyled** as the thumb-zone `ActionBar` |
| Pinned-from-feed `NoticeBar` | **Kept** as a dismissible chip on the map |

### Results (`results-view.tsx`, `results/*`)

| Today | New design |
|---|---|
| `DemoBanner` (full NoticeBar) | **Kept**, shrunk to a one-line chip under the header; the text opens on tap |
| `ResultsHeader`: place, area and period, then Back, Save, Print and Copy link as quiet buttons | **Kept, compact**: title + meta. Actions become icon buttons: Edit, Save, Share (opens a small sheet with Copy link and Print), Ask |
| Rotation `Segmented` (desktop) / native `select` (phone) above the map | **Removed**. The selected strategy card drives the map |
| `FieldPlan`: season label, ‹ Play ›, 3D terrain map, season buttons, note | **Map untouched.** The controls move into one floating pill on the map (‹ 2027 Maize ›, Play). Season buttons are **removed** (the pill steps through them). The note moves to the sheet |
| `Verdict` (big sentence + sequence + fit scores) | **Replaced** by the **headline verdict card**: best rotation (one sentence), main risk (one sentence), confidence badge |
| Tab row Rotations / What changed here / Evidence, each with a `*.hint` paragraph | **Removed.** Rotations become the strategy deck; "What changed" and "Evidence" move into the strategy sheet and the "Data behind this" sheet |
| `Rotations` rows: name, tags, sequence, score, poor seasons, strip, Show details, plus the laptop year panel and the phone years sheet | **Replaced** by **strategy cards** in a swipe deck: name, crop icons, score (count-up), one-line why, season strip, confidence. Desktop shows the cards in a 3-column grid. The year detail (laptop panel, phone `YearsList`) moves into the sheet as the "Seasons" section |
| `Explanation` (why, breakdown, range, confidence, evidence, benefits, gaps, risks + agronomist badge, simulator link) | **Moved** into the **strategy sheet** as collapsible sections: Why · Evidence · Benefits · Gaps · Risks · Seasons, plus the simulator link |
| `ShiftList` ("What changed here") | **Moved** into the "Data behind this" sheet, first section |
| `Evidence` (indicators + sparklines + InfoTips, soil, caveats, sources) | **Moved** into the "Data behind this" sheet. It opens from a row on the verdict card and from each strategy sheet |
| `OptimizerSection` (long inline section with plans, rules, shares, caveats) | **Replaced** by an **"Optimized plan" card** (status, best score versus today, one line). The full plan opens in its own sheet. The background job and the Retry button stay |
| `FieldSwitcher` (horizontal tabs "All fields" + one per field) | **Kept as a compact chip row** above the verdict card (only with several fields) |
| `ResultsOverview` (map coloured by verdict + list) | **Kept**, restyled as the "All fields" view: the map plus field cards. It uses the same card component as Start |
| `ResultsSkeleton` | **Rebuilt** to match the new layout: header, map, verdict card, deck |
| Print stylesheet (one-page plan) | **Kept**: map, selected rotation, verdict and sources. The deck prints as a list of the 3 strategies |

### `/farm` (`farm-view.tsx`, 652 lines)

| Today | New design |
|---|---|
| Header: h1, lead, farm-name input, Save / sign-in link | **Moved** into the Import flow sheet header (name + save) |
| Stepper Parcels · Fields · Plan | **Removed.** Import is a secondary path inside My fields: "Import from file" on Start, or under "+ Add" |
| Step 0 cards (import, pick, rematch, ha total) | **Merged** into one "Import" sheet: file button, two sample links, result line. Picking extra parcels uses the same map controls as the Field screen |
| Step 1 field grouping (list, inline rename, move-to bar, soil flags) | **Kept** as a "Group into fields" screen made of field cards. Move-to becomes a sheet. The soil flags become a badge on the card that opens a sheet |
| Step 2 `PlanStep` (priorities, Make, table, totals, checks, CSV download) | **Kept** as the "Whole-farm plan" sheet (see question Q2). Priorities reuse the Setup toggles. The table becomes field cards on phones and stays a table on desktop. CSV export stays |
| `ParcelDetails` sheet | **Kept**, on the new BottomSheet |
| Local draft `fs-farm-draft`, `/v1/me/farm` load and save | **Kept** unchanged |

> Correction to the brief: `/farm`'s plan is **not** a background job. It is one synchronous
> `POST /v1/farm/plan` call (20 s timeout), lost when the step unmounts. The background job is the
> optimizer on the results page (`/v1/farm/optimize/jobs`). The two are different engines: the farm
> plan staggers each field's best rotation; the optimizer solves allocations across weather scenarios.
> Both stay. The redesign only changes how they are reached (Q2).

### `/feed` (`components/feed/*`)

| Today | New design |
|---|---|
| `DemoBanner` | One-line chip |
| Header card: h1, intro, region line | **Cut** to h1 + one meta line |
| Recommendation card (label, title, text, actions, confidence, assumptions disclosure) | **Kept** as the **headline recommendation card**: title, one line, confidence. Actions and assumptions open in a sheet |
| Crop `Segmented` (one per reference crop) | **Changed to a chip row** (a filter, not navigation), so the page keeps a single segmented control: Region / Stocks |
| List / Map `Segmented` (phones only) | **Removed.** On phones the map is a collapsed card ("Map · 12 communes"); tapping it expands it to full-bleed. On desktop the map sits beside the list, as today |
| `RiskSummary` 3 tiles | **Kept** as 3 small count chips in the crop row |
| Step 1 card "Communes" + `listHint`; table on md, list on phones | **Phone: card list. Desktop: table kept** (sortable and denser, which is genuinely better there). The hint goes |
| Laptop detail panel under the map / phone `Sheet` with `ZoneDetails` | **Sheet everywhere** on phones; desktop keeps the side panel. The `LowerRisk` link `/field?lat=&lon=&place=` is kept |
| Step 2 "Compare" card + `compareHint` + `ZoneCompare` | **Moved** into a sheet: tick 2 communes, then a floating "Compare 2" pill opens it |
| `ValidationCard` (method, hits, legend, pills, honest note, table disclosure) | **Moved** behind a tap: a one-line "Track record: 7 of 9 seasons right" row that opens a sheet |
| Caveats + sources | **Moved** behind a tap: an "About this data" row that opens a sheet |

### `/stocks` and `/stocks/report`

| Today | New design |
|---|---|
| h1, intro, demo `NoticeBar` | h1 + demo chip |
| Path `Segmented` A / B | **Changed to a chip pair** under the headline, because Buyers already has the one segmented control (Region / Stocks). Both are inside Buyers › Stocks, so there is still one segmented control per screen |
| `context` paragraph | **Cut** to one line |
| `InventoryTable` + `inventoryHint` + legend | **Phone: inventory cards** (product, cover days, status badge). **Desktop: table kept.** The hint goes; the legend becomes an InfoTip |
| `SupplierPanel` inline (shortfall, allocation + hint, up to 4 notices, 6 candidate cards, more) | **Headline card**: "Biggest gap: X, N days. Best source: Y". Tapping a product opens the supplier sheet with the allocation, notices and candidate cards (the cards are restyled; the rest is behind "More candidates") |
| Method disclosure (9 bullets) | **Moved** into the "About this data" sheet |
| Report link (`/stocks/report?path=`, RO) | **Kept** as a header action ("Report") |
| `/stocks/report` (Romanian, A4 print CSS, watermark, page footer) | **Kept as is.** Only the back bar is restyled. It stays Romanian-only |
| Bug: `/stocks` ignores `?path=`, so the report's back link always lands on path A | **Fixed**: Buyers reads `?path=` |

### `/account`, `/about`, `/simulator`, landing

| Today | New design |
|---|---|
| Account: h1, sign-in / sign-up tablist, `passwordHint` | **Moved** to More › Account. Sign in is the default; "Create account" is a text link that swaps the form (no tab row) |
| Device field import (`DeviceFieldImport`) | **Kept** as one card on My fields › Start after signing in |
| Saved-fields section: map, search, sort segmented control, select all, rows with Analyze / Edit / Rename / Delete, sticky selection bar | **Moved** to **My fields › Start**: field cards (shape thumbnail, name, area, last verdict, Analyze). Rename, Edit and Delete sit in a card overflow sheet. Multi-select is a "Select" mode with a sticky "Analyze N" bar. The map overview and search/sort appear only when there are more than 6 fields; sort becomes a chip |
| Profile panel (email, since, name, password disclosure, sign out, delete) | **Moved** to More › Account as a grouped list. Password and delete open sheets |
| About: intro, judgment, what, sources table, AI, limits, demo | **Moved** to More › About & data: a short page with collapsible sections. The NASA sources stay as a card list, and the glossary (ET, NDVI, soil-moisture anomaly, water balance, frost risk) is added here |
| Simulator (strategy chips, shape segmented control, scene, controls, stats) | **Restyled only.** The `?strategy=&seq=&field=` deep link is kept. Note: the results page links with `seq`, not `field`; both keep working |
| Landing: hero + stats + 7 blocks + CTA | **Hero untouched** (only its text and button are restyled). Below it: (1) the proof strip, (2) how it works in 3 steps, (3) a CTA with two doors (Farmer / Buyer). The stats fold into the proof strip. *what*, *look*, *get*, *audience* and *limits* go to About or are dropped |

---

## 2. Information architecture and navigation

### 2.1 Three destinations

```
My fields   /field              Start → Field → Setup → Results   (+ Import, + All fields)
Buyers      /buyers?view=…      [ Region | Stocks ]   (Origins later)
More        /more               Account · About & data · Language · (Ask)
```

Why this split:
- **My fields** is the farmer's whole job in one place. `/field`, `/farm` and the saved fields from
  `/account` were three doors to the same things (a field and its plan). The Start screen is now
  the saved-fields list, so "My fields" means exactly what it says.
- **Buyers** groups the feed buyer's two questions: *where should we source* (Region) and *what
  is running short* (Stocks). One segmented control at the top, nothing else above the fold.
- **More** collects what is used once (account, data sources, language). About doesn't need a
  tab; the jury still reaches it in one tap.
- I kept the route `/field` as the My fields root instead of a new `/fields`. It keeps every existing
  deep link and the WhatsApp bot's link (`/{lang}/field?lat=&lon=&place=`) working without a redirect.

### 2.2 Routes and redirects

| Route | Becomes |
|---|---|
| `/field` | My fields: Start when there is no query, otherwise the flow. All current query handling stays: `?lat&lon&place` opens the Field screen at the pin; `?saved=ids&run=1` runs; `?saved=ids&edit=1` opens Field; `?saved=ids` opens Setup |
| `/field?import=1` | New: opens the Import sheet |
| `/farm` | **Redirect** → `/field?import=1` (plus the farm draft, which is in localStorage and so survives) |
| `/feed` | **Redirect** → `/buyers?view=region` (query kept) |
| `/stocks` | **Redirect** → `/buyers?view=stocks` (query kept, `path` included) |
| `/stocks/report?path=` | **Unchanged** |
| `/account` | **Redirect** → `/more/account` |
| `/about` | **Redirect** → `/more/about` |
| `/simulator?strategy=&seq=&field=` | **Unchanged** (not in the nav) |
| `/` | Landing (hero untouched) |

Redirects are page-level `redirect()` calls in the old route files (they keep the query), so they
go through next-intl and keep the locale.

### 2.3 The "my field" journey

1. **Start** (`/field`). Signed in with fields, or a local field on this device: rounded field
   cards (SVG shape thumbnail, name, area, last verdict chip, **Analyze**). On top: "+ Add field"
   (primary) and an overflow with "Import from file" and "Select several". With no fields, Start
   is skipped and the map opens directly.
2. **Field**: a full-bleed map under the floating bottom bar. Floating on it: the search pill and
   Locate button at the top; Basemap and Brush as round buttons on the right; at the bottom the
   selection chip (ha, Use, Separate, Clear) and then the ActionBar with **Continue**. A "+ Field"
   button adds another field; a counter chip opens the list of fields in this analysis.
3. **Setup** sheet (snaps to about 70 % of the screen; the map stays visible above it):
   - Name (optional)
   - Rotation as crop chips (maize → wheat by default, + to add a year, two preset chips)
   - Four toggles labelled "Matters most" for Yield, Water, Soil and Risk (default all off, which
     means "matters" for every priority). Off sends 0.6 and on sends 1.0. The "less" level (0.2)
     is still available in an "Adjust" disclosure that shows the current three-level control, so
     no request the API accepts today is lost.
   - Irrigation switch
   - **Analyze** is ready straight away.
4. **Results**:
   - Header: place, then "42 ha · 2001–2025", then icon actions (Edit, Save, Share, Ask).
   - The 3D field map, unchanged, with the season pill floating on it.
   - The **verdict card**: best rotation and main risk, one sentence each, with a confidence badge
     and a row "Data behind this ›".
   - The **strategy deck**: swipe cards with snap and dots. Selecting a card updates the map;
     tapping it opens the strategy sheet.
   - The **Optimized plan** card, which opens its own sheet.
   - With several fields: a field chip row on top, "All fields" first.

The main risk sentence uses the same rule as the WhatsApp bot (`_main_risk`: the reason that most
often made the current rotation's past seasons poor), ported to a pure, tested TS function, so the
bot and the web say the same thing.

### 2.4 The Assistant

**Proposal: drop the global floating button and make it contextual.**
- On results: an **Ask** icon button in the header ("Ask about this field"). It opens the assistant
  in a bottom sheet (on desktop, a right-side panel), already scoped to the fields on screen. It
  keeps using `setAssistantFields`.
- On Buyers: the same Ask action in the header (the API gets `page: "buyers"`).
- More has an "Ask Field Signal" row for general questions.

Why: a third floating element on top of the pill bar, the sheets and the map controls on the Field
screen collides somewhere on every screen at 360 px. The assistant is most useful with context,
and the header action makes that context explicit.

---

## 3. Design direction

The identity stays: field green, wheat, status colours, light and dark. The token approach stays.
The changes make the app softer, rounder and more tactile.

### 3.1 Colour (values change, names stay; new tokens marked +)

| Token | Light | Dark | Note |
|---|---|---|---|
| `--ground` | `#f4f6f1` (was `#fff`) | `#0c110e` | A warm off-white canvas, so white cards lift without borders |
| `--surface` | `#ffffff` | `#151c17` | Cards and sheets |
| `--surface-sunken` | `#ecefe8` | `#1c2620` | Chip fills, tracks |
| + `--surface-raised` | `#ffffff` | `#1d2620` | Sheets and the bar in dark mode (elevation through lightness, not shadow) |
| `--line` | `#e2e6e0` | `#2c3a31` | Used less: cards rely on shadow, not borders |
| + `--scrim` | `rgb(8 14 10 / .45)` | `rgb(0 0 0 / .6)` | The sheet backdrop (today hard-coded in CSS) |
| + `--field-soft` | `#eef6f0` | `#132a1c` | Active tint in the nav and selected cards (softer than `--field-tint`) |
| others | unchanged | unchanged | Every text/background pair is re-checked for AA in Phase 2 |

### 3.2 Shape and elevation (new)

```
--radius-xs: .5rem    small marks, season cells
--radius-sm: .75rem   inputs, small buttons
--radius-md: 1rem     buttons, chips (non-pill)
--radius-lg: 1.25rem  cards
--radius-xl: 1.75rem  sheets, map frames, hero cards
--radius-pill: 999px  chips, nav bar, segmented control, toggles

--shadow-1   resting card      0 1px 2px / 4%, 0 2px 8px / 4%
--shadow-2   raised / pressed  0 6px 20px / 8%
--shadow-3   sheet             0 -8px 40px / 16%
+ --shadow-float  nav bar and floating map controls  0 8px 24px / 14%, 0 1px 3px / 8%

--space-gutter: 1rem   phone side gutter (1.5rem from 640px)
--bar-h: 4rem          floating bar height; --bar-gap: .75rem from the safe area
--tap: 2.75rem         minimum target
```

### 3.3 Type

- Geist for the UI and Bricolage Grotesque for display numbers and screen titles only.
- **At most two weights per screen: 400 and 600.** Today 500 and 600 are mixed everywhere.
- Scale tokens: `--text-xs .8125` · `--text-sm .9375` · `--text-base 1.0625` · `--text-lg 1.25` ·
  `--text-xl 1.5` · `--text-2xl 2` (display) · `--text-3xl 2.5` (hero numbers). Tabular numbers on
  every figure.

### 3.4 Motion (existing tokens plus three)

```
--duration-fast 120ms · --duration-base 220ms · --duration-slow 420ms · --duration-hero 900ms (kept)
--ease-settle, --ease-standard, --ease-pop (kept)
+ --ease-spring: linear(…)   a CSS spring curve (about 0.3 % overshoot), for sheets and the bar indicator
+ --duration-sheet: 480ms
+ --press-scale: .97
```

- **Sheets**: spring in and scrim fade, a drag handle, drag to dismiss (velocity- and
  distance-based), snap points (half / full) for Setup and the strategy sheet. Focus is trapped
  (the `<dialog>` element is kept) and focus returns to the opener.
- **Strategy deck**: native CSS `scroll-snap` with an IntersectionObserver for the dots. The
  browser handles the scrolling, so it stays smooth on mid-range phones.
- **Card → sheet**: the View Transitions API (`document.startViewTransition`, the card and the
  sheet header share a `view-transition-name`). Where it isn't supported, the sheet simply
  springs in.
- **Route and step transitions**: CSS view transitions (slide on step changes, fade between tabs).
- Staggered `rise` for result cards (the existing `--i` pattern), the existing `useCountUp` on
  scores, the existing `season-in` on strips, and a skeleton for each final layout.
- `prefers-reduced-motion`: the existing global rule stays; drag still works, without the spring.
- The hero canvas and the results terrain map are never animated or transformed by page
  transitions: they are excluded from view-transition snapshots (`view-transition-name: none` on
  their containers) and no ancestor gets a transform.

**No `motion` (Framer Motion) package.** The four pieces it would help with (sheet drag, deck
swipe, card→sheet, route transitions) are covered by pointer events (about 100 lines in one
`useSheetDrag` hook), CSS scroll-snap and View Transitions. That saves roughly 35–50 KB of JS on
every route, keeps all motion on the compositor, and adds no dependency. If the sheet drag doesn't
feel right on real phones in Phase 8, I'll add `motion` to `BottomSheet` only and say so.

### 3.5 New base components (Phase 2)

`BottomSheet` (drag, snaps, scrim, View Transition), `BottomBar` and `TopBar` (nav), `Card`
(`interactive` variant with press feedback), `Chip` and `ChipGroup`, `Toggle` (switch), `SwipeDeck`
(snap + dots + keyboard arrows), `ActionBar` (sticky thumb-zone bar that sits above the floating
nav), `IconButton`, `InfoTip` (now opens a popover sheet on phones and keeps working inline),
`Term` (jargon with a tap-to-reveal definition), `LanguageSwitch`, `ScreenHeader`, `StatusChip`,
`ListRow` and `ListGroup` (More, sheets). `Segmented` gets the pill style. `Stepper` is deleted.

---

## 4. Copy budget

Measured today in `messages/en.json`: 910 keys, about 5,530 words (RO: 910 keys, about 5,880 words,
59 KB). 45 `*hint` keys.

### 4.1 Words visible before any tap (phone, 390 px)

| Screen | Today (approx.) | Budget |
|---|---|---|
| Landing below the hero | ~600 | **60** |
| My fields › Start | ~40 + field rows | **15** + card data |
| Field (map) | ~70 | **12** |
| Setup sheet | ~110 (rotation + priorities steps) | **25** |
| Results (one field) | ~180 + rows | **35** + card data |
| Strategy sheet (sections closed) | — | **20** |
| Optimized plan card | ~250 inline | **15** |
| Buyers › Region | ~200 | **35** + card data |
| Buyers › Stocks | ~280 | **35** + card data |
| More | — | **20** |
| More › About & data (sections closed) | ~650 | **60** |
| Account (signed out) | ~60 | **20** |

### 4.2 Cut plan per namespace (keys today → target)

| Namespace | Today | Plan | Target |
|---|---|---|---|
| Results | 130 / 829 words | Delete `nav.*`, every `*.hint`/`hintPhone`, `loadingSteps`, the tags; shorten the `verdict.*` sentences to one clause; add `verdictCard.*`, `sheet.*`, `glossary` refs | ~80 |
| Farm | 131 / 818 | Remove the stepper, card hints, `lead`, `pick.how`; keep import, group, plan, parcel | ~70 |
| Field | 100 / 612 | Delete `steps.*`, `field.hint`, `rotation.hint`, `prioritiesHint`, `priority.*.hint`, `draw.*`, `multi.addAnotherHint`; add `setup.*` | ~55 |
| Stocks | 62 / 515 | Delete `intro`, `context`, `inventoryHint`, `allocationHint`; shorten `method.*` (moves to a sheet) | ~45 |
| Account | 97 / 415 | Delete `picker.*` (Start replaces it), `intro`, `passwordHint`, `fields.selectHint`; merge with `More` | ~60 |
| Feed | 75 / 405 | Delete `intro`, `regionLine`, `listHint`, `compareHint`, `view.*`, `step*`; keep `zone.*` | ~55 |
| Home | 52 / 419 | Keep `title`, `lead`, `start`, credits, the proof strip and 3 steps; delete `what*`, `look.*`, `get.*`, `audience*`, `limits*`, `stats.*` | ~18 |
| About | 40 / 368 | Rewrite shorter as sections; add `glossary.*` (5 terms × term + one line) | ~35 |
| Optimizer | 45 / 349 | Delete `hint`, `perFieldHint`, `rules.hint`, `loadingHint`; shorten the rule labels | ~35 |
| Simulator | 60 / 270 | Trim `intro`, `banner`, `demoNote`, `passesHint`, `timeHint` | ~45 |
| Assistant | 31 / 174 | Trim the welcome text and suggestions | ~22 |
| FarmPlan, FeedExtra | 32 | Fold into Farm / Feed | ~20 |
| New: `Nav` (3 items), `More`, `Glossary`, `Sheet` | — | — | ~35 |

Overall target: **~600 keys and under 2,700 English words (−50 %)**, with zero orphans. Phase 7
adds `scripts/check-messages.mjs`: it fails when a key in `en.json` is missing from `ro.json` (or
the other way round), or when a key is never referenced in `src/` (dynamic keys come from a small
allowlist). It runs inside `pnpm test`.

Rules for the copy: English first; Romanian written as natural Romanian (not translated word for
word); no marketing language; one headline and at most one supporting line per screen; jargon
wrapped in `Term`.

### 4.3 Required content (judging brief): where it lives

| Required | Where |
|---|---|
| Why / evidence / benefits / gaps / risks for every strategy | Strategy sheet, collapsible sections |
| Confidence on every strategy | Badge on every strategy card and in the sheet header |
| Confidence on every risk | Each risk row shows the strategy's confidence plus `needs_local_review` (see §5) |
| "Check with an agronomist" where risks appear | One short note on every Risks section and on the verdict card's risk line |
| Definitions: ET, NDVI, soil-moisture anomaly, water balance, frost risk | `Term` popovers wherever they appear, plus the glossary in More › About & data |
| NASA data sources | "Data behind this" sheet (source chips) and the About & data list |

---

## 5. API changes

**None planned.** Everything above is presentation over the current responses:

- *Main risk* (verdict card): computed client-side from `replay[].reasons`, using the same rule as
  the bot.
- *Confidence per risk*: `LocalRisk` has only `text` and `needs_local_review`. A risk inherits the
  confidence of its strategy (the API computes one confidence per strategy) and keeps its
  agronomist flag. That shows an uncertainty label on every risk without inventing new data.
- *Last verdict on field cards*: cached on the device per saved-field id
  (`field-signal.last-verdict.v1`: kind, best rotation id, poor seasons, date) when results are
  shown. A card with nothing cached shows "Not analysed yet".

Two candidates, **only if you want them** (each would update `contracts/`, the TS types and the
bot, and change no model logic):
1. `SavedField.last_result` (an optional summary written by `PUT /v1/me/fields/{id}`), so the last
   verdict follows the account across devices instead of staying on one phone.
2. `LocalRisk.confidence` (optional), if you'd rather the API state risk confidence explicitly.

The WhatsApp bot is unaffected either way: its only link into the web is
`/{lang}/field?lat=&lon=&place=`, which keeps working on the same route.

## 6. Language

- `defaultLocale: "en"`. next-intl locale detection stays on (Accept-Language, then cookie), so a
  phone set to Romanian still lands on `/ro`. `/` with no preference goes to `/en`.
- The manifest `start_url` becomes `/` (it is `/ro` today) and `lang` becomes `en`; the middleware
  picks the language.
- `LanguageSwitch`: a pill `EN | RO`, one tap, keeps the path and query.
- Unchanged: the bot's language behaviour and the Romanian-only stocks report.

## 7. Phases (as you set them out) and how I'd use the other sessions

The rule for parallel work: after Phase 3 lands the shared base (tokens, components, nav, routes),
Phase 4 (My fields) and Phase 5 (Buyers) touch separate folders and separate message namespaces.
They can run in two worktrees in parallel and merge back here. Phases 6–9 run on this branch.

## 8. Decisions (15 Nov 2026)

- **Assistant**: keeps a floating button. On phones it docks beside the pill bar, at the same
  height, so the two never overlap. It hides while a bottom sheet is open and rises above the
  ActionBar on input screens. The results-page context (`setAssistantFields`) is unchanged.
- **Whole-farm plan**: kept as its own sheet after Import and grouping (`/v1/farm/plan`, any
  number of fields, CSV export).
- **Priorities**: four "Matters most" toggles. The three-level control stays behind "Adjust".
- **Ground**: off-white `#f4f6f1` in light mode and `#0c110e` in dark mode; cards lift in both.
- **Language**: follows the phone's language, with English as the fallback. An EN/RO picker is
  always available and keeps the page and its query.
