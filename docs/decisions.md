# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-13 | Monorepo: Next.js web + FastAPI + uv workspace for data/ml | One repo, shared contracts |
| 2026-11-13 | SPACE2FEED Direction A (livestock feed) | Our crops already match; soy protein is the buyer's real need |
| 2026-11-13 | Demo region: Alba around Sântimbru/Aiud | Recommended by the local guide; real sourcing area |
| 2026-11-13 | Roles: Vlad (research, app, pitch), Bogdan (data), Răzvan (ML) | Team call |
| 2026-11-13 | Pydantic models in `services/api/src/api/contracts.py` are the source of truth; JSON Schema + TS generated | One definition, typed end to end |
| 2026-11-13 | API serves `mock=true` data until the pipeline lands | Web work starts at 11:00 without waiting |
| 2026-11-13 | Crop KB in TOML (stdlib `tomllib`) | No extra dependency; readable for the agronomist |
| 2026-11-13 | MODIS MOD13Q1 is the must-have vegetation source; HLS 30 m is stretch | 48 h scope; organiser tip: start small |
| 2026-11-13 | Small, interpretable risk model, leave-one-year-out validation | ~200 rows per crop; overfitting risk; judges will ask |
