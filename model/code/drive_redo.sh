#!/bin/bash
# Rebuild from step 2 after the ROI mask fix. Step 1 tiles are still valid; every raw
# dataset is not, because the point set and its ordering changed.
set -e
cd /home/jovyan/work/crop_rotation
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

rm -rf data/raw/*
mkdir -p data/raw && chmod 777 data/raw
log "raw outputs cleared"

log "step2: resample with the ROI mask"
venv/bin/python -u code/run.py step2 --region full

log "step3 (GEE, 16 workers) and step4 (POWER) in parallel"
GEE_WORKERS=16 venv/bin/python -u code/run.py step3 --region full &
S3=$!
venv/bin/python -u code/run.py step4 --region full
wait $S3; S3=$?
log "step3 exit=$S3"
[ $S3 -eq 0 ]

log "manifest"
venv/bin/python -u code/run.py manifest --region full
log "DONE"
