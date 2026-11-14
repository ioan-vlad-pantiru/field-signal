#!/usr/bin/env bash
# Redeploy Field Signal to Azure Container Apps (rg-field-signal, Germany West Central).
# Builds both images locally for linux/amd64 (ACR Tasks are blocked on student subscriptions),
# pushes them to the registry and rolls each app to the new tag. Needs: az login, Docker.
#   scripts/deploy-azure.sh           # deploy api + web
#   scripts/deploy-azure.sh web       # deploy one of them
set -euo pipefail

RG=rg-field-signal
ACR=fieldsignal952178
REGISTRY=$ACR.azurecr.io
API_APP=field-signal-api
WEB_APP=field-signal
TAG=$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo "-dirty")
TARGETS=${1:-"api web"}

cd "$(git rev-parse --show-toplevel)"
az acr login -n "$ACR" >/dev/null
# The browser calls the API on its own subdomain (same site as fieldsignal.land, so the sign-in
# cookie works); the API's CORS_ORIGINS allows the web app's domains.
API_URL=${PUBLIC_API_URL:-https://api.fieldsignal.land}

for target in $TARGETS; do
  case $target in
    api)
      app=$API_APP; dockerfile=services/api/Dockerfile; args=()
      # Parcel outlines for "tap your parcel" live in a release, not in git.
      [ -f services/api/parcels/apia_parcels_alba.sqlite ] ||
        gh release download apia-parcels-2025 -p apia_parcels_alba.sqlite -D services/api/parcels
      ;;
    web) app=$WEB_APP; dockerfile=apps/web/Dockerfile; args=(--build-arg "NEXT_PUBLIC_API_URL=$API_URL") ;;
    *) echo "unknown target: $target" >&2; exit 1 ;;
  esac
  image=$REGISTRY/$app:$TAG
  echo "→ $target: building $image"
  docker buildx build --platform linux/amd64 -f "$dockerfile" "${args[@]}" -t "$image" --push .
  az containerapp update -g "$RG" -n "$app" --image "$image" -o none
  echo "✓ $target: https://$(az containerapp show -g "$RG" -n "$app" --query properties.configuration.ingress.fqdn -o tsv)"
done
