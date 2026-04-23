#!/usr/bin/env bash
# deploy/update.sh — Atomic update for Kleros Reputation Oracle
# Usage: sudo ./deploy/update.sh [sepolia|mainnet]
# Sequence: stop timer → git pull → npm ci → start timer
# Safe to re-run after a mid-sequence failure.
set -euo pipefail

INSTANCE="${1:-sepolia}"
case "$INSTANCE" in
  sepolia|mainnet) ;;
  *)
    >&2 echo "[update] ERROR: unknown instance '${INSTANCE}'. Use: sepolia | mainnet"
    exit 1
    ;;
esac

REPO_ROOT="/opt/reputation-oracle"

on_error() {
  local exit_code=$1 line=$2 cmd=$3
  local timer_state
  timer_state=$(systemctl is-active "reputation-oracle@${INSTANCE}.timer" 2>/dev/null || echo "unknown")
  >&2 echo ""
  >&2 echo "[update] FAILED at line ${line}: ${cmd} (exit ${exit_code})"
  >&2 echo "[update] Timer state: ${timer_state}"
  >&2 echo "[update] Recovery: rerun 'sudo ./deploy/update.sh ${INSTANCE}'"
  >&2 echo "[update]   or to restore timer only: sudo systemctl start reputation-oracle@${INSTANCE}.timer"
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR

>&2 echo "[update] Starting update for instance: ${INSTANCE}"

# ── Step 1: Stop timer ──────────────────────────────────────────────────────
>&2 echo ""
>&2 echo "[update:1/4] Stopping timer: reputation-oracle@${INSTANCE}.timer"
systemctl stop "reputation-oracle@${INSTANCE}.timer"
>&2 echo "[update:1/4] Timer stopped"

# ── Step 2: git pull --ff-only ──────────────────────────────────────────────
>&2 echo ""
>&2 echo "[update:2/4] git pull (fast-forward only)"
sudo -u oracle git -C "${REPO_ROOT}" pull --ff-only
>&2 echo "[update:2/4] git pull complete"

# ── Step 3: npm ci --omit=dev ───────────────────────────────────────────────
>&2 echo ""
>&2 echo "[update:3/4] npm ci --omit=dev"
sudo -u oracle npm --prefix "${REPO_ROOT}/bot" ci --omit=dev
>&2 echo "[update:3/4] npm ci complete"

# ── Step 4: Start timer ─────────────────────────────────────────────────────
>&2 echo ""
>&2 echo "[update:4/4] Starting timer: reputation-oracle@${INSTANCE}.timer"
systemctl start "reputation-oracle@${INSTANCE}.timer"

>&2 echo ""
>&2 echo "[update] Done. Timer state: $(systemctl is-active "reputation-oracle@${INSTANCE}.timer")"
