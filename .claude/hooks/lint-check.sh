#!/usr/bin/env bash
# Stop hook: run bot + contracts linters at end-of-turn. Block the stop
# (feed errors back to the model) if any fail. Silent on success.
#
# Prevents slow drift — catches lint regressions while the model still has
# context to fix them.

set -u

INPUT=$(cat)

# Prevent infinite retry loop: if Claude Code already invoked us and the model
# is now trying to stop again after our feedback, let it through.
if printf '%s' "$INPUT" | grep -q '"stop_hook_active":[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

FAILED=()
OUTPUTS=()

# Bot: biome via npm (keeps hook portable — skips if bot/ absent or lint script missing).
if [ -f bot/package.json ] && grep -q '"lint"[[:space:]]*:' bot/package.json 2>/dev/null; then
  BOT_OUTPUT=$(cd bot && npm run --silent lint 2>&1)
  BOT_EXIT=$?
  if [ "$BOT_EXIT" -ne 0 ]; then
    FAILED+=("bot lint (exit $BOT_EXIT)")
    OUTPUTS+=("── bot ──"$'\n'"$BOT_OUTPUT")
  fi
fi

# Contracts: forge fmt --check (skips if forge not installed or contracts/ absent).
if [ -f contracts/foundry.toml ] && command -v forge >/dev/null 2>&1; then
  FORGE_OUTPUT=$(cd contracts && forge fmt --check 2>&1)
  FORGE_EXIT=$?
  if [ "$FORGE_EXIT" -ne 0 ]; then
    FAILED+=("forge fmt (exit $FORGE_EXIT)")
    OUTPUTS+=("── contracts ──"$'\n'"$FORGE_OUTPUT")
  fi
fi

if [ ${#FAILED[@]} -eq 0 ]; then
  exit 0
fi

{
  echo "Lint failed (${FAILED[*]}). Fix these errors before ending the turn:"
  echo
  for O in "${OUTPUTS[@]}"; do
    echo "$O"
    echo
  done
} >&2
exit 2
