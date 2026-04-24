#!/usr/bin/env bash
# deploy/bootstrap.sh — Idempotent VPS provisioner for Kleros Reputation Oracle
# Usage: sudo ./deploy/bootstrap.sh
# Must be run from /opt/reputation-oracle (the repo root).
# Assumptions: fresh Ubuntu 22.04 VPS; repo already cloned to /opt/reputation-oracle by root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CURRENT_STEP=""

on_error() {
  local exit_code=$1 line=$2 cmd=$3
  >&2 echo ""
  >&2 echo "[bootstrap] ERROR at step \"${CURRENT_STEP}\" (line ${line}): ${cmd} (exit ${exit_code})"
  >&2 echo "[bootstrap] Fix the error above and re-run: sudo ./deploy/bootstrap.sh"
  exit 1
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR

>&2 echo "[bootstrap] Starting Kleros Reputation Oracle provisioning..."
>&2 echo "[bootstrap] Repo root: ${REPO_ROOT}"

# ──────────────────────────────────────────────────────────────────────────────
# Step 1: Update apt and install prerequisites
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="1: apt prerequisites"
>&2 echo ""
>&2 echo "[bootstrap] Step 1/11: apt update + prerequisites"
apt-get update -q
apt-get install -y -q git curl ca-certificates

# ──────────────────────────────────────────────────────────────────────────────
# Step 2: NodeSource Node 22 (idempotent — skip if already v22)
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="2: Node 22 via NodeSource"
>&2 echo ""
>&2 echo "[bootstrap] Step 2/11: NodeSource Node 22"
if node --version 2>/dev/null | grep -q '^v22'; then
  >&2 echo "[bootstrap] Node 22 already installed: $(node --version) — skipping"
else
  >&2 echo "[bootstrap] Purging Ubuntu-shipped nodejs to prevent NodeSource conflict..."
  apt-get remove --purge -y nodejs libnode-dev npm 2>/dev/null || true
  apt-get autoremove -y
  >&2 echo "[bootstrap] Installing Node 22 via NodeSource apt..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  >&2 echo "[bootstrap] Installed: $(node --version)"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 3: Create oracle system user (MUST run before steps 5, 6, 7)
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="3: oracle system user"
>&2 echo ""
>&2 echo "[bootstrap] Step 3/11: oracle system user"
if id oracle &>/dev/null; then
  >&2 echo "[bootstrap] User 'oracle' already exists — skipping useradd"
else
  useradd --system --shell /usr/sbin/nologin oracle
  >&2 echo "[bootstrap] Created system user 'oracle'"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 4: Create /etc/reputation-oracle/ directory
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="4: /etc/reputation-oracle directory"
>&2 echo ""
>&2 echo "[bootstrap] Step 4/11: /etc/reputation-oracle/ directory"
if [ ! -d /etc/reputation-oracle ]; then
  mkdir -p /etc/reputation-oracle
  chmod 0755 /etc/reputation-oracle
  >&2 echo "[bootstrap] Created /etc/reputation-oracle/"
else
  >&2 echo "[bootstrap] /etc/reputation-oracle/ already exists — skipping"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 5: Transfer repo ownership to oracle (runs after step 3 creates the user)
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="5: chown repo to oracle"
>&2 echo ""
>&2 echo "[bootstrap] Step 5/11: chown /opt/reputation-oracle → oracle"
chown -R oracle:oracle "${REPO_ROOT}"
>&2 echo "[bootstrap] Ownership transferred to oracle:oracle"

# ──────────────────────────────────────────────────────────────────────────────
# Step 6: npm ci --omit=dev (as oracle, after repo is oracle-owned)
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="6: npm ci --omit=dev"
>&2 echo ""
>&2 echo "[bootstrap] Step 6/11: npm ci --omit=dev (as oracle)"
sudo -u oracle npm --prefix "${REPO_ROOT}/bot" ci --omit=dev
>&2 echo "[bootstrap] Production dependencies installed"

# ──────────────────────────────────────────────────────────────────────────────
# Step 7: Create /etc/reputation-oracle/sepolia.env stub (never clobber existing)
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="7: sepolia.env stub"
>&2 echo ""
>&2 echo "[bootstrap] Step 7/11: /etc/reputation-oracle/sepolia.env"
if [ -f /etc/reputation-oracle/sepolia.env ]; then
  >&2 echo "[bootstrap] /etc/reputation-oracle/sepolia.env already exists — skipping (will not overwrite)"
else
  install -m 0600 -o oracle -g oracle /dev/null /etc/reputation-oracle/sepolia.env
  cat >> /etc/reputation-oracle/sepolia.env << 'ENVTEMPLATE'
# Kleros Reputation Oracle — Sepolia instance environment
# Fill all values without quotes. Edit with: sudo -u oracle nano /etc/reputation-oracle/sepolia.env
# WARNING: Never use echo or shell redirection to fill secrets — bash history captures values.

# ── Required ────────────────────────────────────────────────────────────────
CHAIN_ID=11155111
RPC_URL=
ROUTER_ADDRESS=
PGTCR_ADDRESS=0x3162df9669affa8b6b6ff2147afa052249f00447
SUBGRAPH_URL=https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn
BOT_PRIVATE_KEY=

# ── Optional (uncomment to override defaults) ────────────────────────────────
# TX_RECEIPT_TIMEOUT_MS=120000
# MIN_BALANCE_WEI=5000000000000000
# PINATA_JWT=
# PINATA_TIMEOUT_MS=30000
# LOG_LEVEL=info

# ── Phase 8: Observability (fill after Betterstack setup) ───────────────────
# BETTERSTACK_SOURCE_TOKEN=
# BETTERSTACK_HEARTBEAT_URL=
# HEARTBEAT_TIMEOUT_MS=10000
ENVTEMPLATE
  >&2 echo "[bootstrap] Created /etc/reputation-oracle/sepolia.env stub (0600 oracle:oracle)"
fi

# Verify permissions regardless of whether we just created or it pre-existed
CURRENT_STEP="7: verify sepolia.env permissions"
PERMS=$(stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env)
if [ "$PERMS" != "600 oracle oracle" ]; then
  >&2 echo "[bootstrap] ERROR: /etc/reputation-oracle/sepolia.env has wrong permissions: $PERMS"
  >&2 echo "[bootstrap] Expected: 600 oracle oracle"
  >&2 echo "[bootstrap] Fix: chmod 0600 /etc/reputation-oracle/sepolia.env && chown oracle:oracle /etc/reputation-oracle/sepolia.env"
  exit 1
fi
>&2 echo "[bootstrap] Permissions verified: $PERMS"

# ──────────────────────────────────────────────────────────────────────────────
# Step 8: Install systemd unit files
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="8: systemd unit files"
>&2 echo ""
>&2 echo "[bootstrap] Step 8/11: systemd unit files → /etc/systemd/system/"
cp "${SCRIPT_DIR}/systemd/reputation-oracle@.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/systemd/reputation-oracle@.timer" /etc/systemd/system/
chmod 0644 /etc/systemd/system/reputation-oracle@.service
chmod 0644 /etc/systemd/system/reputation-oracle@.timer
>&2 echo "[bootstrap] Installed reputation-oracle@.service and reputation-oracle@.timer"

# ──────────────────────────────────────────────────────────────────────────────
# Step 9: Install journald drop-in
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="9: journald drop-in"
>&2 echo ""
>&2 echo "[bootstrap] Step 9/11: journald retention drop-in → /etc/systemd/journald.conf.d/"
mkdir -p /etc/systemd/journald.conf.d
cp "${SCRIPT_DIR}/journald.conf.d/reputation-oracle.conf" /etc/systemd/journald.conf.d/
chmod 0644 /etc/systemd/journald.conf.d/reputation-oracle.conf
>&2 echo "[bootstrap] Installed journald retention config (SystemMaxUse=500M, SystemMaxFileSize=50M)"

# ──────────────────────────────────────────────────────────────────────────────
# Step 10: systemctl daemon-reload
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="10: daemon-reload"
>&2 echo ""
>&2 echo "[bootstrap] Step 10/11: systemctl daemon-reload"
systemctl daemon-reload
>&2 echo "[bootstrap] daemon-reload complete"

# ──────────────────────────────────────────────────────────────────────────────
# Step 11: Restart systemd-journald to apply retention caps
# ──────────────────────────────────────────────────────────────────────────────
CURRENT_STEP="11: restart systemd-journald"
>&2 echo ""
>&2 echo "[bootstrap] Step 11/11: systemctl restart systemd-journald"
systemctl restart systemd-journald
>&2 echo "[bootstrap] systemd-journald restarted with new retention caps"

# ──────────────────────────────────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────────────────────────────────
>&2 echo ""
>&2 echo "[bootstrap] ════════════════════════════════════════════════════════"
>&2 echo "[bootstrap] Bootstrap complete. Next steps:"
>&2 echo "[bootstrap]"
>&2 echo "[bootstrap]   1. Fill secrets: sudo -u oracle nano /etc/reputation-oracle/sepolia.env"
>&2 echo "[bootstrap]      (WARNING: never use echo or heredoc — bash history captures values)"
>&2 echo "[bootstrap]"
>&2 echo "[bootstrap]   2. Validate dry-run (see deploy/RUNBOOK.md §First-run verification)"
>&2 echo "[bootstrap]"
>&2 echo "[bootstrap]   3. Enable timer:  sudo ./deploy/start-timer.sh sepolia"
>&2 echo "[bootstrap] ════════════════════════════════════════════════════════"
