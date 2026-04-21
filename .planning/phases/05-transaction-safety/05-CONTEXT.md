# Phase 5: Transaction Safety - Context

**Gathered:** 2026-04-17 (checkpoint) + 2026-04-21 (auto-resume)
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden `bot/src/chain.ts` `executeActions()` so the bot handles transaction failures, wallet depletion, and process signals without leaving ambiguous state. Scope: gas estimation retry with classification (TXSAFE-01), null/timed-out receipt handling (TXSAFE-02), balance preflight (TXSAFE-03), SIGTERM/SIGINT graceful shutdown (TXSAFE-04). Out of scope: IPFS integration (Phase 6), multi-instance coordination, contract-level idempotency.

</domain>

<decisions>
## Implementation Decisions

### Error Handling Policy (revises Phase 2 D-10)
- **D-01:** Differentiated failure policy by class, replacing Phase 2's blanket stop-on-first-failure (D-10):
  - **Skip-and-continue** (item-specific / pre-flight): gas estimation exhausted retries on transient errors, simulation revert (gas estimation reverts), post-submission revert on a single action (`receipt.status === "reverted"`). Log the skip at `warn` level, increment `skipped` counter, continue to next action.
  - **Stop-and-exit-non-zero** (systemic / post-submission): null or timed-out `waitForTransactionReceipt`, RPC connection loss, balance check fails mid-batch, unrecoverable wallet client error. Log at `error`, emit RunSummary, `process.exit(1)`.
  - **Stop-and-exit-zero** (graceful shutdown): `SIGTERM` or `SIGINT` — finish in-flight tx if any, skip remaining, emit RunSummary, `process.exit(0)`.
- **D-02:** A single revert is a skip, not a systemic stop. Rationale: D-10's blanket stop creates a DoS risk in the stateless architecture — one poison item (already-revoked index, unexpected contract state, race with manual admin call) would block every downstream item on every subsequent run. Differentiation preserves D-10's safety intent (don't burn gas on doomed txs from systemic causes) while unblocking the batch when only one item is problematic. Matches SC-1 (gas est → retries then skip) and SC-2 (receipt timeout → exit non-zero).

### Shutdown Semantics
- **D-03:** Register signal handlers for BOTH `SIGTERM` and `SIGINT` on the same graceful path. On signal: set module-scoped `shuttingDown = true`, log at `warn` with the signal name. Main loop checks the flag before starting the next action; an in-flight `writeContract` + `waitForTransactionReceipt` is allowed to complete (or time out on the normal receipt-timeout path). After the loop exits, flush the logger (`logger.flush()` per Pitfall 14) and `process.exit(0)`.
- **D-04:** Do NOT call `process.exit()` inside the signal handler while async work is in flight. Set the flag and let the main loop exit naturally. Rationale: Pitfall 3 + 14 — interrupting mid-`waitForTransactionReceipt` creates nonce limbo; `process.exit` inside the handler drops buffered pino output.
- **D-05:** Signal handlers are registered in `index.ts` `main()` before `executeActions()` is called. The `shuttingDown` flag is passed by reference (via a small `AbortSignal`-like object, or a simple mutable holder `{shutdown: false}` that `executeActions` reads each iteration). Implementation detail left to planner; no `AbortController` needed for v1.1 (sequential single-process bot).

### Balance Preflight
- **D-06:** Single startup balance check against a configurable minimum threshold. New env var `MIN_BALANCE_WEI` (optional, zod-validated as bigint string), default `5_000_000_000_000_000` wei (0.005 ETH). Before any action executes, call `publicClient.getBalance({address: account.address})`; if below threshold, log at `error` with actual and required balances, emit RunSummary with `errors: 1`, `process.exit(1)` with no actions attempted.
- **D-07:** No per-tx balance re-check and no cumulative batch-total gas estimate. Rationale: typical batch is 0-2 actions per CLAUDE.md steady state; per-tx check is overkill. Mid-batch depletion is a systemic failure — the next `estimateGas` or `writeContract` will fail with "insufficient funds", which routes through D-01's stop-and-exit-non-zero class. The threshold provides a buffer above a single worst-case action's gas cost.

### Gas Estimation Retry Mechanics (TXSAFE-01)
- **D-08:** Gas estimation via `publicClient.estimateContractGas({address, abi, functionName, args, account})` as a separate step before `walletClient.writeContract`. Retry with exponential backoff: **max 3 attempts, base delay 1000ms, multiplier 2** → actual delays 1s, 2s (between attempts 1→2 and 2→3). Worst-case latency per failed action: ~3s wait + 3 estimate calls.
- **D-09:** Classify estimation errors before retrying: **revert errors do NOT retry**. If `error.name === "ContractFunctionRevertedError"` (or viem equivalent) or the error message matches revert patterns, skip the action immediately (routes to D-01's item-specific skip class). Only transient errors (`HttpRequestError`, `TimeoutError`, connection resets) are retried.
- **D-10:** After retries exhausted on a transient error, skip the action (item-specific). Log at `warn` with `{action, agentId, attempts: 3, reason: "gas_estimation_exhausted", lastError: safeMsg}`.
- **D-11:** Transaction submission (`writeContract`) is NEVER retried, per TXSAFE-01 and Anti-Pattern "Retry on Transaction Submission" from ARCHITECTURE.md. A submission that failed ambiguously leaves a pending tx in the mempool — retrying creates a second tx with a different nonce, risking duplicate feedback and wallet drain. If `writeContract` throws, classify by error type: revert → skip; anything else (network, nonce rejection) → systemic stop-and-exit-non-zero.

### Receipt Timeout Handling (TXSAFE-02)
- **D-12:** New env var `TX_RECEIPT_TIMEOUT_MS` (optional, zod-validated integer, default `120_000`). Documented guidance: L1 default 120000ms, L2 deployments should set 30000ms. Applied to `publicClient.waitForTransactionReceipt({hash, timeout: TX_RECEIPT_TIMEOUT_MS})`. Replaces the current hardcoded `60_000` at `bot/src/chain.ts:181`.
- **D-13:** On timeout OR null receipt: log at `error` with `{txHash, action, agentId, timeoutMs}` and message "receipt timeout or null — tx may still be pending". Emit RunSummary with `errors: 1`. `process.exit(1)` (systemic failure per D-01). The next run's stateless diff observes the post-confirmation on-chain state and self-heals.
- **D-14:** Do NOT probe `eth_getTransactionByHash` to distinguish "still pending" from "dropped". Rationale: adds two-state logic without changing the outcome — either state means "exit non-zero, let the next run re-diff" per TXSAFE-02. Keeps chain.ts simple.
- **D-15:** Receipt with `status === "reverted"` is a skip (item-specific per D-01), not a systemic stop. This is a change from the current chain.ts:185 `throw` that halts the batch. Log at `warn`, increment `skipped`, continue.

### Exit Code Semantics
- **D-16:** Binary exit codes only:
  - **Exit 0** — no systemic failure occurred. Covers: all actions completed, all actions skipped (item-specific), graceful SIGTERM/SIGINT, no-actions-needed, dry-run, partial batch where some succeeded and some were skipped.
  - **Exit 1** — systemic failure occurred. Covers: config validation failure, balance below threshold at startup, receipt timeout/null, RPC connection loss, nonce rejection, unhandled error.
- **D-17:** Item-specific skips do NOT promote to exit 1 even when every action in the batch was skipped. Rationale: next-run diff re-evaluates each item; skips are self-healing. The RunSummary `skipped` counter (D-20) gives operators a monitoring signal for chronic skipping without blocking the scheduler on a single bad run. Exit codes drive scheduler alerting — reserve exit 1 for "investigate now" conditions.

### Logging Detail for Skipped Actions
- **D-18:** Per-skipped-action log at `warn` level with structured fields: `{action: action.type, agentId: agentId.toString(), reason, attempts?, lastError?}`. Reason is one of: `"gas_estimation_exhausted"`, `"gas_estimation_reverted"`, `"submission_reverted"`, `"receipt_reverted"`. `lastError` is a sanitized error message (logger's existing `sanitizeObject` handles redaction).
- **D-19:** Systemic-failure exit additionally logs at `error` level with `{reason, ...context}` where reason is one of: `"receipt_timeout"`, `"receipt_null"`, `"balance_below_threshold"`, `"rpc_connection_lost"`, `"submission_failed_non_revert"`, `"nonce_rejected"`.
- **D-20:** Extend `RunSummary` (from Phase 4 D-05) with two new fields:
  - `skipped: number` — count of item-specific skips during this run
  - `systemicFailure?: string` — when set, the reason code for the systemic failure (matches D-19's reason taxonomy). Absent (or `undefined`) on successful runs.
  - Keep existing fields: `items, valid, actions, txSent, errors, durationMs`. `errors` continues to count 1 per systemic failure (there can only be one since systemic → exit). `txSent` counts only confirmed (non-reverted) receipts — this is a semantic change from Phase 4 where `txSent = actions.length` on the success path.

### Claude's Discretion
- Exact backoff timer implementation (setTimeout vs p-timers pattern) — pure function style preferred, no new deps
- Whether to extract the retry helper into `bot/src/tx.ts` (per ARCHITECTURE.md) or keep it inlined in `chain.ts` — up to planner based on test strategy
- Exact error classification predicates for viem errors — depends on which viem error types are stable (v2.47 instanceof checks vs name string matching)
- Whether `shuttingDown` is a module-scoped `let` in `chain.ts`, a passed-in `{shutdown: boolean}` holder, or an `AbortSignal`. Preference: simplest that tests can assert on. No extra dep required.
- How to wire `logger.flush()` on exit paths without regressing stdout/stderr separation from Phase 4

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — TXSAFE-01, TXSAFE-02, TXSAFE-03, TXSAFE-04 and their success criteria
- `.planning/ROADMAP.md` — Phase 5 Goal and 4 Success Criteria (SC-1 through SC-4)

### Bot Source (hardening targets)
- `bot/src/chain.ts` — `executeActions()` at lines 102-192 is the primary target; current 60s receipt timeout at line 181; `throw` on revert at line 185; nonce management at line 117. `createViemPublicClient` / `createViemWalletClient` factories stay as-is.
- `bot/src/index.ts` — `main()` entry at line 14; `process.exit(0)` at line 89; `process.exit(1)` at line 92; `emitSummary()` at line 9 (extend for new fields); no signal handlers currently registered.
- `bot/src/config.ts` — Zod schema; add `MIN_BALANCE_WEI` and `TX_RECEIPT_TIMEOUT_MS` env vars.
- `bot/src/logger.ts` — `createChildLogger`, `sanitizeObject` (already handles redaction for error objects in `warn`/`error` logs). `logger.flush()` pattern per Pitfall 14.
- `bot/src/types.ts` — Extend `RunSummary` interface per D-20.

### Research
- `.planning/research/PITFALLS.md` §Pitfall 3 (SIGTERM nonce limbo), §Pitfall 4 (gas est succeeds but tx reverts; `simulateContract` guidance), §Pitfall 8 (receipt timeout != tx failure), §Pitfall 9 (balance preflight staleness), §Pitfall 10 (retry logic turns one-shot into long-running), §Pitfall 14 (pino flush on shutdown)
- `.planning/research/ARCHITECTURE.md` — "Feature 2: Transaction Safety Hardening" section; separated retry policies pattern (READ retryable, WRITE non-retryable, WAIT timeout + log); Anti-pattern "Retry on Transaction Submission"
- `.planning/research/STACK.md` — viem ^2.47 error types (`ContractFunctionRevertedError`, `HttpRequestError`, `TimeoutError`)

### Prior Phase Decisions (carried forward)
- `.planning/phases/02-stateless-bot/02-CONTEXT.md` — D-09 (explicit nonce, fetch once, increment locally), D-10 (stop-on-first-failure — **revised by this phase's D-01/D-02**), D-11 (dry-run mode)
- `.planning/phases/04-structured-logging/04-CONTEXT.md` — D-05 RunSummary shape (**extended by this phase's D-20**), D-07 logger module design, D-08 init-before-config pattern

### Router Contract (unchanged surface)
- `contracts/src/KlerosReputationRouter.sol` — function signatures called by `executeActions`: `submitPositiveFeedback`, `submitNegativeFeedback`, `revokeOnly`. No contract changes in this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bot/src/chain.ts` — `executeActions()` already has sequential nonce management (D-09) that persists across the differentiated-failure redesign. `writeContract` calls are uniform across the 3 action types — a single `submitTx` helper could dispatch by `action.type`.
- `bot/src/logger.ts` — `sanitizeObject` + `err` serializer already redact private keys and bearer tokens in error objects; Phase 5 warn/error logs reuse this without changes. `logger.flush()` is a pino method available on the default instance.
- `bot/src/config.ts` — Zod schema pattern with `z.coerce` handles string env vars cleanly; `MIN_BALANCE_WEI` needs `z.coerce.bigint()` (zod v4) or a custom `.transform()` (string → bigint). `TX_RECEIPT_TIMEOUT_MS` is a plain `z.coerce.number().int().positive().optional().default(120000)`.
- `bot/src/index.ts` — `emitSummary()` centralizes summary emission; extending `RunSummary` fields flows through automatically to both success and failure paths.

### Established Patterns
- Pure-function testability: `computeActions()` is pure; `tx.ts` helpers (if extracted) should follow the same pattern where possible — accept dependencies as params, return promises, no module-scoped state except signal flag.
- viem v2 error classification uses `instanceof` against exported error classes (`ContractFunctionRevertedError`, `HttpRequestError`, `TimeoutError`, `BaseError`). Name-string matching is a fallback; prefer instanceof.
- Testing pattern: vitest with ephemeral anvil fork for chain-level assertions (see `bot/test/` existing tests); unit tests for pure retry/classification logic mock viem clients.
- `process.exit()` is called from `index.ts` only, not from inside modules — Phase 5 continues this: `executeActions` throws or returns, `main()` decides exit code.

### Integration Points
- `index.ts main()` — add signal handler registration at start; pass shutdown holder into `executeActions`; after loop, check `systemicFailure` on summary and choose exit code; add `logger.flush()` before every `process.exit` site.
- `chain.ts executeActions()` — transform from "throw on any failure, halt batch" to "classify failure, skip or stop per D-01". Likely signature change: returns `{skipped: number, txSent: number, systemicFailure?: string}` instead of `void`, so `main()` can propagate to RunSummary without re-throwing through error handling.
- `config.ts` — two new optional env vars with sensible defaults; backward compatible (existing `.env` files continue to work).
- `types.ts` — `RunSummary` extended; no breaking change since new fields are optional (`systemicFailure?`) or additive (`skipped` starts at 0).

</code_context>

<specifics>
## Specific Ideas

- The 60s → `TX_RECEIPT_TIMEOUT_MS` (default 120s) change at `chain.ts:181` is the minimum viable TXSAFE-02 fix; document L2 guidance (30s) in `.env.example` as a comment.
- Prefer viem's typed errors over regex-matching error messages: `error instanceof ContractFunctionRevertedError` is stable across viem patch versions; `error.message.includes("revert")` is not.
- For the shutdown holder, a plain object `{shutdown: false}` passed into `executeActions` is simpler than `AbortSignal` and avoids any new viem-abort-signal wiring. The signal handler in `index.ts` closes over this object.
- Anvil fork tests should exercise: (a) balance below threshold → exit 1, (b) receipt timeout simulated by low gas + congestion → exit 1 + tx hash logged, (c) one reverting action followed by one valid action → second action still executes, first logged as skipped. These map 1:1 to SC-1 through SC-4 and belong in Phase 5's plan.
- Resist the urge to add an execution-time budget (Pitfall 10) in this phase — at 0-2 actions/run steady state, a 120s receipt timeout per tx is well under any scheduler interval. Keep the code change footprint small.

</specifics>

<deferred>
## Deferred Ideas

- **Contract-level idempotency** for `submitPositiveFeedback` / `revokeOnly` (Pitfall 4 suggestion) — would eliminate revert races entirely but requires a Router upgrade; schedule for a post-v1.1 contract hardening phase.
- **Execution-time budget** (Pitfall 10 global timer) — not needed at current scale; revisit if batch sizes grow or if multi-instance runs become possible.
- **`eth_getTransactionByHash` probe** after receipt timeout — explicitly rejected by D-14 for v1.1; can be added if operations needs finer-grained distinction between "pending" and "dropped" for alerting.
- **Circuit breaker for RPC** after N consecutive failures — deferred; v1.1 relies on the scheduler to rerun after a systemic exit.
- **Multi-instance coordination / mutex** (Pitfall 10 last bullet) — single-instance invariant documented in CLAUDE.md; no code-level enforcement in this phase.
- **Retry-after-scaled-gas** for timeout recovery — intentionally avoided since it re-introduces write retry; stateless diff is the recovery path.

</deferred>

---

*Phase: 05-transaction-safety*
*Context gathered: 2026-04-17 (initial, 2 areas) + 2026-04-21 (auto-resume, 5 areas)*
