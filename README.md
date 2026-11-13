# Field Signal

Field Signal, by team Farm Titans, is crop-rotation decision support for Romanian farmers, built on NASA Earth observation data. It combines climate, soil-moisture and vegetation signals with soil and crop maps to show which rotation choices fit a field's changing conditions, plus a feed-buyer sourcing view that helps livestock operations find where forage and feed crops are likely to be available (SPACE2FEED, Direction A).

Created at the **NASA Space Apps Challenge 2026** (14–15 Nov 2026) for the challenge *Field Shift: Adapting Farms with NASA Data*. This is an independent hackathon project; it is not endorsed by or affiliated with NASA.

**Live demo:** https://fieldsignal.ioan-vlad-pantiru.com (API docs: https://fieldsignal.ioan-vlad-pantiru.com/api/docs). Both scale to zero, so the first visit after a quiet spell takes a few seconds.

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

Both apps run on Azure Container Apps (consumption plan, scale to zero) in resource group `rg-field-signal`. After `az login`, `scripts/deploy-azure.sh` builds the images, pushes them to the registry and rolls out both apps; pass `api` or `web` to deploy only one. A Cloudflare Worker (`deploy/cloudflare`, deploy with `npx wrangler deploy` there) serves the public domain: `/api/*` goes to the API, everything else to the web app. The web image bakes in the public API URL at build time.

## Data sources

| Source | What we use it for | Notes |
|---|---|---|
| NASA POWER | Daily weather / agroclimate | TBD |
| SMAP | Soil moisture | TBD |
| MODIS MOD13Q1 | NDVI / EVI vegetation indices | TBD |
| SoilGrids | Soil properties | TBD |
| EUCROPMAP | Crop type map (EU) | TBD |
| INS TEMPO | Romanian agricultural statistics | TBD |

## License

[MIT](LICENSE)
