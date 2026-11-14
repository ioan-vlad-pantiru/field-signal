"""Secrets loader. Reads files from the secrets dir only; never prints values.

The dir is container-local by default because the NFS volume squashes every UID
to nobody, so a private (mode 700) dir cannot live there.

Logical names -> files:
  cdse      -> cdse       two lines: username, password
  earthdata -> earthdata  two lines: username, password
  gee-sa    -> gee-sa.json  returns {"path": "<the JSON file>"}
  wekeo     -> wekeo      two lines: username, password

No defaults, placeholders or silent fallbacks: a missing file is a SystemExit
naming the file.
"""
import os
from pathlib import Path

SECRETS_DIR = Path(os.environ.get("CROP_SECRETS_DIR", "/home/jovyan/.crop_secrets"))

FILES = {
    "cdse": "cdse",
    "earthdata": "earthdata",
    "gee-sa": "gee-sa.json",
    "wekeo": "wekeo",
}


def load(required):
    """Return {logical_name: credentials} for every name in `required`."""
    unknown = [name for name in required if name not in FILES]
    if unknown:
        raise SystemExit(
            "unknown secret(s): " + ", ".join(unknown) + "; known: " + ", ".join(FILES)
        )

    missing = [FILES[name] for name in required if not (SECRETS_DIR / FILES[name]).is_file()]
    if missing:
        raise SystemExit(
            "missing secrets file(s): " + ", ".join(str(SECRETS_DIR / name) for name in missing)
        )

    out = {}
    for name in required:
        path = SECRETS_DIR / FILES[name]
        if path.suffix == ".json":
            # shortcut: only the path is returned, JSON shape is not validated,
            # validate when GEE auth is actually wired up in step 3.
            out[name] = {"path": str(path)}
            continue
        lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
        if len(lines) < 2:
            raise SystemExit(
                f"{path} must contain two non-empty lines: username, password"
            )
        out[name] = {"username": lines[0], "password": lines[1]}
    return out
