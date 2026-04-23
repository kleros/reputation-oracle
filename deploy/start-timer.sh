#!/usr/bin/env bash
# deploy/start-timer.sh — Enable and start the reputation-oracle timer for a given instance.
# Usage: sudo ./deploy/start-timer.sh [sepolia|mainnet]
# Run this once after bootstrap + secret-fill + dry-run validation.
set -euo pipefail

INSTANCE="${1:-sepolia}"
case "$INSTANCE" in
  sepolia|mainnet) ;;
  *)
    >&2 echo "[start-timer] ERROR: unknown instance '${INSTANCE}'. Use: sepolia | mainnet"
    exit 1
    ;;
esac

>&2 echo "[start-timer] Enabling and starting reputation-oracle@${INSTANCE}.timer..."
systemctl enable --now "reputation-oracle@${INSTANCE}.timer"
>&2 echo "[start-timer] Enabled and started reputation-oracle@${INSTANCE}.timer"
>&2 echo ""
systemctl status "reputation-oracle@${INSTANCE}.timer" --no-pager
