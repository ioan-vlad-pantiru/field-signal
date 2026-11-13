# Brief

- **Event:** NASA Space Apps Challenge 2026, Alba Iulia, 14–15 Nov 2026
- **Challenge:** Field Shift: Adapting Farms with NASA Data
- **Local challenge:** SPACE2FEED, Direction A: livestock feed (maize, wheat, barley, soybean, sunflower, feed pea)
- **Team:** Farm Titans — Vlad (market research, app, pitch), Bogdan (datasets), Răzvan (ML model)

## Deadlines (Romania time)

| When | What |
|---|---|
| Sat 11:00 | Building starts |
| **Sun 12:00** | Feature freeze |
| **Sun 15:00** | Local pitch form (with files or links). Submit by 14:45. |
| Sun 15:30 | Pitch (usually English; e.g. 5 min + 3 min Q&A) |
| **Sun 18:50** | NASA Space Apps project page submitted (Field Shift). Repo must be public by then. |

## What we build

**Screen 1 — Farmer (NASA core, shown first in the pitch).** Drop a pin on a field near Aiud, enter
the current rotation and priorities (yield, water, soil, risk). See ≥ 3 NASA indicators over ≥ 5
years for that place, soil data, and **three rotation strategies** (current + two alternatives, at
least one with soybean or peas), each with explained scores: why, evidence, benefits, gaps, risks
needing local review. A replay grid shows how each strategy would have fared in each past season.

**Screen 2 — Feed buyer (SPACE2FEED lens).** The same engine run over ~10–20 communes around
Sântimbru/Aiud. Per zone and crop: **availability** (production risk), **quality** (heat/drought at
maize flowering → aflatoxin risk; humidity at wheat flowering → fusarium risk; rain at harvest) and
**environmental impact** (water deficit, legume share, winter cover). One plain-language sourcing
recommendation, and a slider: *if X% of suppliers add soybean to their rotation → +Y t of soy
protein (range)*.

**Every number** shows its data, period, assumptions and confidence. Every agronomic risk carries a
"verify locally" flag. The tool supports farmer judgment; it does not replace it.

## Must-haves (from the brief and the local guide)

1. Area on a map (Alba county).
2. ≥ 3 NASA indicators over ≥ 5 years: NASA POWER (heat, rain, humidity), MODIS MOD13Q1 (NDVI), SMAP L4 (root-zone soil moisture).
3. Soil data (SoilGrids: organic carbon, texture, pH).
4. Crop characteristics (`data/crops.toml`).
5. Farmer priorities set by the user.
6. ≥ 3 rotation strategies over 3–4 years with explained scores.
7. Buyer view aggregated by zone: availability, quality, impact.
8. Sourcing recommendation.
9. Transparency: data, period, assumptions, confidence on every result.
10. AI with a declared role and stated failure modes.
11. Romanian and English, mobile-first.
12. No NASA logos; nothing implying NASA endorsement. Public repo with no private data.

## AI role (declared)

- **Risk model (Răzvan):** predicts the chance of a bad season per zone and crop from NASA-derived
  critical-window features; validated leave-one-year-out against detrended official county yields
  (INS AGR110A). We publish hits **and misses**.
- **Explanation layer:** an LLM turns the computed numbers into farmer-friendly text, constrained to
  a JSON schema and to values we computed. It cannot see local hail, pests, markets or management.

## Out of scope for the weekend (stretch only)

30 m HLS layer, CMIP6 climate scenarios, CAP/GAEC badge, emissions modelling, crop-type inference.

## Where things live

- Contracts and mocks: `contracts/` (start here)
- Crop knowledge base: `data/crops.toml` (draft, needs agronomist review)
- Point data fetch: `data/scripts/fetch_point.py`
- Decisions log: `docs/decisions.md`
