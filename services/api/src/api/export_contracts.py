"""Write JSON Schemas for every exported contract into `contracts/`.

    uv run --package api python -m api.export_contracts

Then regenerate the web types:

    npx --yes json-schema-to-typescript@15 -i contracts/field_analysis.schema.json ...
    (see contracts/README.md)
"""

from __future__ import annotations

import json
from pathlib import Path

from api.contracts import EXPORTED, SCHEMA_VERSION

CONTRACTS_DIR = Path(__file__).resolve().parents[4] / "contracts"


def main() -> None:
    CONTRACTS_DIR.mkdir(exist_ok=True)
    for name, model in EXPORTED.items():
        schema = model.model_json_schema(mode="serialization")
        schema["$id"] = f"https://farm-titans/contracts/{name}/{SCHEMA_VERSION}"
        path = CONTRACTS_DIR / f"{name}.schema.json"
        path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(CONTRACTS_DIR.parent)}")


if __name__ == "__main__":
    main()
