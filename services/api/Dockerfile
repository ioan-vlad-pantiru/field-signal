# Field Signal API. Build from the repo root: docker build -f services/api/Dockerfile .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"
WORKDIR /app
# The uv workspace needs every member's pyproject to read the lockfile; only the API is installed.
COPY pyproject.toml uv.lock ./
COPY data/pyproject.toml data/pyproject.toml
COPY ml/pyproject.toml ml/pyproject.toml
COPY services/api/pyproject.toml services/api/pyproject.toml
RUN uv sync --frozen --no-dev --package api --no-install-workspace
COPY services/api/src services/api/src
# APIA parcel outlines: CI downloads the file from a release first; without it parcel picking is off.
COPY services/api/parcels services/api/parcels
RUN useradd --uid 10001 app
USER app
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "services/api/src", "--proxy-headers"]
