# Phase 8: Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `08-CONTEXT.md` — this log records how the context was gathered.

**Date:** 2026-04-23
**Phase:** 08-observability
**Mode:** non-interactive (see below)
**Areas analyzed:** Transport construction, runId generation, `closeLogger` semantics, heartbeat placement + timeout + routing, OBS-08 alert configuration, config schema additions, test strategy, dry-run semantics

## Session Context

Workflow was invoked via `/gsd:next` → `/gsd:discuss-phase 8`, fired from Telegram chat 1859990310. The Telegram MCP plugin disconnected mid-flow, so:

- `mcp__plugin_telegram_telegram__reply` / `edit_message` / `react` unavailable — no way to reach the user on the sender channel they invoked from.
- `AskUserQuestion` TUI tool was not loaded in this tool environment either — no way to present interactive multi-choice prompts.
- Harness `auto` mode was active (continuous, autonomous execution).

Given the environment, Claude proceeded **non-interactively**: analyzed the phase from Requirements + prior phases + v1.2 kickoff decisions, wrote `08-CONTEXT.md` with all locked decisions preserved, and flagged three items explicitly as "Claude's Discretion" so the user has a clean revision checkpoint before `/gsd:plan-phase 8` runs.

This is analogous to a `--auto` run of the discuss workflow, except the auto-advance chain flag is **not** set — Claude stops after context capture. No autonomous progression to plan-phase.

## What Was Already Locked (no discussion needed)

These decisions entered Phase 8 pre-resolved; Claude captured them verbatim:

| Source | Locked Decision |
|--------|----------------|
| `.planning/REQUIREMENTS.md` OBS-01..OBS-08 | The 8 crisp requirements themselves — shape and scope of Phase 8 |
| `.planning/STATE.md` v1.2 Decisions | `@logtail/pino` chosen as transport vendor |
| `.planning/STATE.md` v1.2 Decisions | `closeLogger(cb)` named as the async-flush export |
| `.planning/STATE.md` v1.2 Decisions | 7-day Sepolia burn-in gate before Phase 9 |
| OBS-07 | 20-minute alert grace period |
| OBS-07 | Email-only alerts for v1.2 (no PagerDuty/Slack) |
| OBS-08 | 3+ consecutive empty-run streak = alert condition |

Presenting these as "questions" to the user would have been performative — they were already the answer.

## Claude's Analysis Output (synthesized into CONTEXT.md)

### Transport construction (D-09..D-13)
Multi-target pino transport, additive to existing stderr destination (stderr wins on Betterstack network failure). `@logtail/pino` target added only when token is set AND not `--dry-run`. Token + heartbeat URL both added to `redact.paths` — heartbeat URL contains opaque monitor ID that enables liveness-spoofing if leaked.

### runId (D-05..D-08)
`crypto.randomUUID()` (Node built-in, no dep). Generated as first line of `main()`, rooted into logger via `.child({ runId, chainId })`. Present in dry-run too — useful for correlating dry-run stdout with stderr log lines.

### closeLogger (D-14..D-17)
New export in `logger.ts`. Wraps async transport drain with callback semantics matching existing `flushAndExit` shape. Non-throwing — catches internal errors, last-resort `console.error`, always invokes callback. 2s fallback timeout to prevent hung exits on dead Betterstack endpoint.

### Heartbeat (D-18..D-23)
Placed between `emitSummary` and `flushAndExit` in `index.ts`. Success URL vs `/fail` variant routed on `summary.systemicFailure`. Native `fetch` with `AbortSignal.timeout(5000)`. Catches and logs-at-warn + swallows all errors. No cascade to `summary.systemicFailure` or exit code — OBS-04 is a hard guarantee. Extracted into new `bot/src/heartbeat.ts` file.

### OBS-08 silent-list alert (D-24..D-26)
Alert is a Betterstack dashboard rule, not bot code. Bot just emits accurate `itemsFetched`. Proposed rename `RunSummary.items` → `itemsFetched` for consistency with requirement wording and dashboard query readability.

## Claude's Discretion (flagged for user review before plan-phase)

| ID | Decision | Claude's pick | Alternatives |
|----|---------|---------------|-------------|
| DISC-01 | Heartbeat fetch timeout | 5000ms | 3000ms (aggressive) / 10000ms (tolerant) |
| DISC-02 | `closeLogger` fallback drain timeout | 2000ms | 1000ms (risk log drops) / 5000ms (delays timer exit) |
| DISC-03 | `RunSummary.items` → `itemsFetched` rename | Proceed with rename | Keep `.items` (less churn, requires dashboard query to adapt) |

If the user picks different values or rejects DISC-03 before `/gsd:plan-phase 8` runs, the researcher and planner pick up the change automatically from the revised CONTEXT.md.

## Deferred Ideas Captured

All captured in `<deferred>` section of `08-CONTEXT.md`. Summary: PagerDuty/Slack escalation (v1.3), synthetic burn-in automation (v1.3), multi-vendor log shipping (unlikely), per-action `actionId` correlation (v1.3 if burn-in surfaces pain), saved searches (v1.3), heartbeat health metrics (transport warn-logs suffice).

## No External Research Needed at This Stage

The planner + researcher will need to fetch live docs during `/gsd:plan-phase 8`:
- `@logtail/pino` transport options + worker-thread close semantics
- `pino.transport({ targets })` v10.3 multi-transport API shape
- Betterstack Uptime heartbeat HTTP method + `/fail` suffix confirmation

These are implementation specifics — not user-vision gray areas — so they correctly belong in the plan-phase research step, not here.

## Why no DISCUSSION-LOG with Q&A table

Standard template for this file is a question-by-question audit table. This session had no interactive questions due to the Telegram + AskUserQuestion environment issues described above. If the user wants a true interactive discussion, they can:

1. Delete `08-CONTEXT.md` + `08-DISCUSSION-LOG.md`
2. Reconnect Telegram MCP (if that was the preferred channel) or run from main session where TUI tools work
3. Re-invoke `/gsd:discuss-phase 8`
