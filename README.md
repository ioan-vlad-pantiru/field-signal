# Field Signal

Field Signal, by team Farm Titans, is crop-rotation decision support for Romanian farmers, built on NASA Earth observation data. It combines climate, soil-moisture and vegetation signals with soil and crop maps to show which rotation choices fit a field's changing conditions, plus a feed-buyer sourcing view that helps livestock operations find where forage and feed crops are likely to be available (SPACE2FEED, Direction A).

Created at the **NASA Space Apps Challenge 2026** (14–15 Nov 2026) for the challenge *Field Shift: Adapting Farms with NASA Data*. This is an independent hackathon project; it is not endorsed by or affiliated with NASA.

**Live demo:** https://fieldsignal.land. Both scale to zero, so the first visit after a quiet spell takes a few seconds.

## Team

| Who | Role | Owns |
|---|---|---|
| Vlad | Web + API | `apps/web`, `services/api` |
| Bogdan | Data pipelines | `data/` |
| Răzvan | Modelling | `ml/` |

## Repo map

```
apps/web/        Next.js (App Router, TS, Tailwind, next-intl ro/en, MapLibre GL)
services/api/    FastAPI (Python 3.12, pydantic v2)
data/            datasets and pipelines (scripts/; raw/ and cache/ are gitignored)
ml/              risk / yield-anomaly model + notebooks
contracts/       shared JSON Schemas for team handoffs
docs/            brief, decisions, submission notes
```

## Quickstart

Requirements: Node 22+, pnpm 10, [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you).

```bash
cp .env.example .env          # fill in Earthdata credentials
pnpm install
uv sync --all-packages
```

**Web** — http://localhost:3000 (redirects to `/ro`; `/en` for English)

```bash
pnpm dev:web
```

**API** — http://localhost:8000/health, docs at `/docs`

```bash
pnpm dev:api
```

**Data**

```bash
uv run --package farm-data python data/scripts/<script>.py
```

Lint / format everything: `pnpm lint`, `pnpm format` (or `make lint`, `make format`).

## Deploy

Both apps run on Azure Container Apps (consumption plan, scale to zero) in resource group `rg-field-signal`. Every push to `main` that passes CI deploys automatically (`.github/workflows/deploy.yml`); day-to-day work goes to `dev` and reaches `main` through a PR. To deploy by hand, after `az login`, `scripts/deploy-azure.sh` builds the images, pushes them to the registry and rolls out both apps; pass `api` or `web` to deploy only one. A Cloudflare Worker (`deploy/cloudflare`, deploy with `npx wrangler deploy` there) serves fieldsignal.land: `/api/*` goes to the API, everything else to the web app. The web app calls the API at the same-origin path `/api`.

## Data sources

| Source | What we use it for | Resolution, period | Licence / attribution | Code |
|---|---|---|---|---|
| NASA POWER (daily, AG community) | T2M, T2M_MAX/MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, WS2M, GWETROOT; FAO-56 ET0 | 0.5° × 0.625° (solar 1°), 1981–2025 | NASA open data; "data obtained from the NASA Langley Research Center POWER Project" | `farm_data.power` |
| NASA SMAP L4 `SPL4SMGP.008` | Root-zone soil moisture in each crop's critical window | 9 km, 3-hourly → daily, 2015-03-31 onward | NASA open data, via AppEEARS (Earthdata login) | `farm_data.appeears` |
| NASA MODIS `MOD13Q1.061` + `MYD13Q1.061` | NDVI/EVI peak and anomaly, pixel reliability | 250 m, 16-day (8-day combined), 2000–2025 | NASA open data, via AppEEARS | `farm_data.appeears` |
| ISRIC SoilGrids 2.0 | SOC, pH(H₂O), clay, sand at 0–30 cm (depth-weighted 0–5/5–15/15–30) | 250 m | CC BY 4.0 | `farm_data.soil` (WCS) |
| JRC EUCROPMAP 2018, 2022 | Cropland sample points; commune crop areas | 10 m; 2018 is Sentinel-1 only; 2022 overall accuracy 70.6 % (19 crops) | CC BY 4.0 | `farm_data.cropmap` |
| INS TEMPO AGR108A, AGR109A, AGR110A | County area (ha), production (t), yield (kg/ha → t/ha) for 6 feed crops | County, yearly, 1990–2025 | Free reuse with attribution: "Sursa: INS" | `farm_data.ins` |
| Eurostat GISCO NUTS 2024, LAU 2024 | County and commune boundaries | 1:1M (NUTS), LAU 2024 | © EuroGeographics for the administrative boundaries | `farm_data.zones` |

How to rebuild everything: [`data/README.md`](data/README.md).

## License

[MIT](LICENSE)
