#!/bin/bash
# Drive the full-region build to completion. Each step halts on failure, so `set -e`
# stops the chain rather than producing a partial dataset silently.
set -e
cd /home/jovyan/work/crop_rotation
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

log "waiting for step1 to finish"
while pgrep -f "code/run.py step1" > /dev/null; do sleep 60; done

log "step1 re-run to verify completeness (resumes, skips existing tiles)"
venv/bin/python -u code/run.py step1 --region full

log "step2: sample 300k points over the full region"
venv/bin/python -u code/run.py step2 --region full

log "step3 (GEE, 16 workers) and step4 (POWER) in parallel"
GEE_WORKERS=16 venv/bin/python -u code/run.py step3 --region full &
S3=$!
venv/bin/python -u code/run.py step4 --region full
S4=$?
wait $S3; S3=$?
log "step3 exit=$S3 step4 exit=$S4"
[ $S3 -eq 0 ] && [ $S4 -eq 0 ]

log "manifest"
venv/bin/python -u code/run.py manifest --region full
log "DONE"
