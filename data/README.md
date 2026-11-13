# data — owner: Bogdan

Datasets and fetch pipelines. `scripts/` holds fetch scripts; `raw/` and `cache/` are gitignored.

```bash
uv sync --all-packages
uv run --package farm-data python data/scripts/<script>.py
```
