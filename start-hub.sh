#!/bin/bash
# ── SweepNspect Hub — Boot Script ──────────────────────────
# Runs on Genesis startup via Task Scheduler.
# Pulls latest code, injects secrets, starts PM2.
# ────────────────────────────────────────────────────────────

set -e
HUB_DIR="D:/Hive/Projects/SweepNspect-Hub"
VW_GET="D:/Hive/Terminal/vaultwarden/scripts/vw-get.sh"
WORKER_URL="https://sweepnspect-webhook.sweepnspect.workers.dev"

cd "$HUB_DIR"
echo "[hub] Starting SweepNspect Hub — $(date)"

# ── 1. Git pull latest ─────────────────────────────────────
echo "[hub] Pulling latest code..."
git pull origin main || echo "[hub] WARNING: git pull failed, continuing with current code"

# ── 2. Pull secrets from Vaultwarden ──────────────────────
echo "[hub] Fetching secrets from vault..."
export NODE_TLS_REJECT_UNAUTHORIZED=0
export ANTHROPIC_API_KEY=$("$VW_GET" "Anthropic API Key" 2>/dev/null || echo "")
export HUB_API_TOKEN=$("$VW_GET" "SweepNspect Hub Token" 2>/dev/null || echo "")

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[hub] WARNING: ANTHROPIC_API_KEY not found in vault — AI proxy will be unavailable"
fi
if [ -z "$HUB_API_TOKEN" ]; then
  echo "[hub] WARNING: HUB_API_TOKEN not found in vault"
fi

# ── 3. Create logs dir ────────────────────────────────────
mkdir -p "$HUB_DIR/logs"

# ── 4. Start PM2 ─────────────────────────────────────────
echo "[hub] Starting PM2 processes..."
pm2 start ecosystem.config.js --update-env
pm2 save

echo "[hub] PM2 processes started:"
pm2 list

# ── 5. Clear DND flag on CF Worker ────────────────────────
# Hub is up = J is available. Disable DND.
if [ -n "$HUB_API_TOKEN" ]; then
  echo "[hub] Clearing DND flag on worker..."
  curl -s -X POST "$WORKER_URL/api/chat/dnd" \
    -H "Authorization: Bearer $HUB_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":false}' \
    || echo "[hub] WARNING: Failed to clear DND flag"
  echo ""
fi

echo "[hub] Boot complete — $(date)"
