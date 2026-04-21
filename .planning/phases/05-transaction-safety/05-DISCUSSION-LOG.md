# Phase 5: Transaction Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17 (initial session) + 2026-04-21 (auto-resume)
**Phase:** 05-transaction-safety
**Mode:** discuss (interactive for first 2 areas, `--auto` resume for remaining 5 areas)
**Areas discussed:** Failure Classification Policy, Signal Handling Scope, Balance Preflight Strategy, Gas Estimation Retry Mechanics, Receipt Timeout Handling, Exit Code Semantics, Logging Detail for Skipped Actions

---

## Failure Classification Policy (revises Phase 2 D-10)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep stop-on-first-failure (D-10 unchanged) | Preserve current behavior: any failure halts the batch, next run re-diffs | |
| Switch to skip-and-continue for all failures | Every failure, including systemic ones, skips to next action | |
| Differentiated policy by failure class | Skip on item-specific (gas-est exhausted, simulation/receipt revert); stop-and-exit-1 on systemic (receipt timeout, RPC loss, balance drop); stop-and-exit-0 on SIGTERM/SIGINT | ✓ |

**User's choice:** Differentiated policy by failure class.
**Notes:** D-10's blanket stop creates a DoS risk in a stateless architecture — one poison item blocks every downstream item on every subsequent run. Differentiation preserves D-10's safety intent for systemic failures while unblocking the batch on single bad items. Maps 1:1 to SC-1 (gas est item-specific) vs SC-2 (receipt timeout systemic) vs SC-3 (empty wallet systemic) vs SC-4 (SIGTERM graceful).

---

## Signal Handling Scope

| Option | Description | Selected |
|--------|-------------|----------|
| SIGTERM only (strict success-criteria read) | Register handler for SIGTERM per TXSAFE-04; Ctrl+C (SIGINT) kills immediately | |
| SIGTERM + SIGINT, same handler | Both signals share the graceful shutdown path; identical semantics | ✓ |
| SIGTERM + SIGINT with different semantics | SIGTERM graceful, SIGINT hard-exit, or vice-versa | |

**User's choice:** SIGTERM + SIGINT on the same handler.
**Notes:** SIGINT is the common developer interrupt during local runs; ignoring it leaves dev Ctrl+C killing the process mid-tx uncleanly. Zero extra cost to register both on the same handler. REQUIREMENTS.md TXSAFE-04 already explicitly includes "SIGTERM/SIGINT".

---

## Balance Preflight Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single startup check against fixed threshold | One `eth_getBalance` before executing; exit if below minimum | ✓ |
| Per-transaction balance check | Re-read balance before each action | |
| Batch-total gas estimate + balance comparison | Sum `estimateContractGas` for all actions; compare to balance | |

**User's choice (auto):** Single startup check with configurable `MIN_BALANCE_WEI` (default 0.005 ETH / 5_000_000_000_000_000 wei).
**Notes:** Typical batch is 0-2 actions per CLAUDE.md steady state; per-tx check is overkill. Mid-batch depletion is a systemic failure — the next `estimateGas`/`writeContract` surfaces "insufficient funds", routed through the stop-and-exit-non-zero class. The threshold provides a buffer above worst-case single-action gas cost. Rejects Pitfall 9's per-tx recommendation on cost/benefit grounds at current scale; batch-total estimate adds estimation noise without catching realistic scenarios.

---

## Gas Estimation Retry Mechanics (TXSAFE-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Linear backoff (1s, 1s, 1s), max 3 | Uniform delays | |
| Exponential backoff (1s, 2s, 4s), max 3 | Standard pattern; separate revert vs transient classification | ✓ |
| No backoff, just max 3 immediate retries | Retry-storm risk on upstream RPC issues | |
| Retry everything including reverts | Ignores semantic distinction | |

**User's choice (auto):** Exponential backoff, base 1000ms, multiplier 2, max 3 attempts. Revert errors skip immediately (no retry); only transient errors (network/timeout) retry.
**Notes:** SC-1 fixes max attempts at 3. Exponential is the accepted standard for RPC retry. Critical: retries are for READ operations only — submission is NEVER retried (Anti-Pattern "Retry on Transaction Submission" from ARCHITECTURE.md). Reverts are deterministic given current state; retrying them burns RPC calls without changing outcome. Instanceof checks on viem's `ContractFunctionRevertedError` preferred over regex on error messages.

---

## Receipt Timeout Handling (TXSAFE-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep hardcoded 60s | Current code; too short for L1 congestion | |
| Configurable `TX_RECEIPT_TIMEOUT_MS`, default 120000 (L1), document 30000 for L2 | Env-tunable per chain; sensible L1 default | ✓ |
| Timeout + `getTransactionByHash` probe | Distinguish "still pending" from "dropped" before exit | |
| No timeout (wait indefinitely) | Violates one-shot bot architecture | |

**User's choice (auto):** Configurable env var `TX_RECEIPT_TIMEOUT_MS` with default 120000ms; L2 deployments documented to use 30000ms. On timeout or null: log hash at error level, emit RunSummary, exit 1 (systemic). No `getTransactionByHash` probe.
**Notes:** Pitfall 8: current 60s too short for mainnet congestion. TXSAFE-02 explicitly says "next run re-diffs and picks up the action" — the stateless diff makes the probe redundant because either state (pending/dropped) yields the same operator action (investigate tx hash + let next run reconcile).

---

## Exit Code Semantics for Partial Batch

| Option | Description | Selected |
|--------|-------------|----------|
| Binary: 0 = no systemic failure, 1 = systemic failure | Skips don't promote to exit 1; RunSummary tracks skipped count | ✓ |
| Tri-state: 0 = full success, 1 = systemic, 2 = partial (some skips) | Scheduler sees distinct codes per severity | |
| Graded by severity | Multiple codes per failure taxonomy | |
| Always 0 unless crash | Loses systemic-failure signal to scheduler | |

**User's choice (auto):** Binary. Exit 0 when no systemic failure (even with skips or all-skipped batch). Exit 1 on systemic failure.
**Notes:** Item-specific skips are self-healing via next-run diff — chronic skipping is monitored via RunSummary's `skipped` counter (structured log queries), not via exit code. Reserve exit 1 for "investigate now" conditions so scheduler alerts fire only when they should. Keeps scheduler integration (systemd, GH Actions, K8s CronJob) simple.

---

## Logging Detail for Skipped Actions

| Option | Description | Selected |
|--------|-------------|----------|
| info level, minimal fields | Standard flow logs; skips lose prominence | |
| warn level, structured fields (action, agentId, reason, attempts?, lastError?) + extend RunSummary with `skipped` | Per Pitfall 12 (retries/skips = warn); queryable in aggregators | ✓ |
| error level per skip | Over-alerts; reserves error for systemic | |
| Aggregate at end only, no per-action log | Loses debugging info for individual items | |

**User's choice (auto):** Per-skipped-action `warn` log with structured `{action, agentId, reason, attempts?, lastError?}`. Reason codes: `gas_estimation_exhausted`, `gas_estimation_reverted`, `submission_reverted`, `receipt_reverted`. Extend RunSummary with `skipped: number` (additive, backward-compatible). Systemic failures additionally log at `error` with reason taxonomy.
**Notes:** Pitfall 12: operational signals (retries, skips) belong at warn, not debug — otherwise incident-time debugging requires log-level reconfiguration. Existing `sanitizeObject` in `bot/src/logger.ts` handles `lastError` redaction without new code. The `systemicFailure?: string` summary field is optional so success-path summaries stay clean.

---

## Auto-Resolved

Auto mode was used to resolve the 5 remaining areas in a single pass after the session was resumed from the checkpoint:
- `Balance Preflight Strategy` → Startup check with configurable `MIN_BALANCE_WEI` (default 0.005 ETH)
- `Gas Estimation Retry Mechanics` → Exponential backoff 1s/2s/4s, max 3 attempts, revert errors skip immediately
- `Receipt Timeout Handling` → Configurable `TX_RECEIPT_TIMEOUT_MS` (default 120000, L2 guidance 30000); no getTransactionByHash probe
- `Exit Code Semantics` → Binary (0 = no systemic failure, 1 = systemic failure)
- `Logging Detail for Skipped Actions` → warn-level structured per-action logs + extend RunSummary with `skipped` and optional `systemicFailure` reason

All five auto-selections chose the recommended option first-listed in the gray area analysis, grounded in PITFALLS.md §3/4/8/9/10/12/14, ARCHITECTURE.md "Feature 2: Transaction Safety Hardening", and the TXSAFE-01..04 success criteria.

## Claude's Discretion

The following were left to planner/executor discretion:
- Exact backoff timer implementation (setTimeout-based vs other) — no new deps
- Whether to extract retry/submit helpers into `bot/src/tx.ts` (per ARCHITECTURE.md) or keep inlined in `chain.ts` — decide per test strategy
- Exact error classification predicates for viem v2.47 (instanceof vs name matching)
- Shutdown holder shape (module-scoped flag vs passed-in `{shutdown: boolean}` vs `AbortSignal`)
- `logger.flush()` wiring order on exit paths without regressing stdout/stderr separation (Phase 4 D-02)

## Deferred Ideas

Ideas raised during discussion that belong in future phases:
- Contract-level idempotency for Router functions (Pitfall 4)
- Execution-time budget (Pitfall 10)
- `eth_getTransactionByHash` probe after timeout
- RPC circuit breaker after consecutive failures
- Multi-instance coordination / mutex
- Retry-after-scaled-gas timeout recovery
