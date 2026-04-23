---
id: 260423-nw1
mode: quick
created: 2026-04-23
status: complete
---

# Quick Task 260423-nw1: Summary

## What shipped

Claude Code Stop hook that runs both repo linters at end-of-turn and blocks the stop with stderr output when any fail. Modeled on agentkit's `lint-check.sh`, adapted for this repo's two lintable surfaces.

## Files

- **New:** `.claude/hooks/lint-check.sh` — executable, guarded against retry loops, silent on success.
- **Edit:** `.claude/settings.json` — added `hooks.Stop` block wiring the script.

## Stack adaptation (vs agentkit reference)

| Aspect | agentkit | This repo |
|--------|----------|-----------|
| Package manager | `pnpm` | `npm` (bot has `package-lock.json`) |
| Linter location | root `pnpm lint` | `bot/` (`npm run lint` → `biome check .`) |
| Extra surface | — | `contracts/` (`forge fmt --check`) |
| Failure aggregation | single tool | both surfaces run; any failure → exit 2 with combined stderr |

Each surface is guarded by existence checks (`bot/package.json` + `lint` script; `contracts/foundry.toml` + `forge` on PATH), so the hook stays portable.

## Contract

- Silent on success (exit 0).
- `stop_hook_active:true` → exit 0 (loop guard — required by Claude Code Stop hook spec).
- Any lint failure → stderr report + exit 2 (blocks stop, feeds output back to the model).

## Smoke tests passed

1. `bash -n` parse check.
2. Loop guard: `{"stop_hook_active":true}` → exit 0.
3. Failure path: `{}` → exit 2 with aggregated stderr from both linters.

## Pre-existing drift surfaced

On the first real Stop, the hook will report ~15 existing findings (Biome style/correctness warnings in `bot/src` + `bot/test`, plus `forge fmt --check` formatting diffs in `contracts/test`, `contracts/script`). These are pre-existing and out of scope for this task — fixing them is a separate cleanup. The hook is doing its job by catching drift that had accumulated silently.

## What this prevents going forward

Same failure mode agentkit hit: a lint/fmt config that nobody runs, with findings accumulating over months. End-of-turn enforcement catches regressions while the model still has context to fix them.
