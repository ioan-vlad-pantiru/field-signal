.PHONY: install dev-web dev-api lint format

install:
	pnpm install
	uv sync --all-packages

dev-web:
	pnpm dev:web

dev-api:
	pnpm dev:api

lint:
	pnpm lint

format:
	pnpm format
