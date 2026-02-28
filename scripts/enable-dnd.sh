#!/bin/bash
# Called by PM2 pre_stop hook — enable DND when Hub shuts down
WORKER_URL="https://sweepnspect-webhook.sweepnspect.workers.dev"
TOKEN="${HUB_API_TOKEN}"

if [ -n "$TOKEN" ]; then
  curl -s -X POST "$WORKER_URL/api/chat/dnd" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true}' \
    || true
  echo "[DND] Enabled — Hub shutting down"
fi
