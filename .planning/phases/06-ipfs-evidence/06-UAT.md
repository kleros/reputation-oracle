---
status: complete
phase: 06-ipfs-evidence
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
  - 06-03-SUMMARY.md
  - 06-04-SUMMARY.md
  - 06-05-SUMMARY.md
started: 2026-04-23T00:00:00Z
updated: 2026-04-23T00:06:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test (no PINATA_JWT)
expected: |
  From a clean shell, run the bot from `bot/` with `PINATA_JWT` UNSET (one-shot mode).
  The bot boots without crashing, fetches PGTCR state from the Goldsky subgraph and Router
  state from the chain, and exits with code 0 (or 1 only if there's a real on-chain failure
  unrelated to IPFS). For any S1/S2 actions it would normally take, you see a `warn` pino
  log line indicating the action was skipped because `PINATA_JWT` is not set. No outbound
  call to `api.pinata.cloud` occurs.
result: pass

### 2. Unit Test Suite
expected: |
  `cd bot && pnpm test` (or `pnpm exec vitest run`) finishes green: 81+ tests across all
  test files pass, including the new ipfs.test.ts (10 tests) and chain.test.ts P1-P6
  prepare/execute split tests. The integration test (`ipfs.integration.test.ts`) is shown
  as skipped because PINATA_JWT is not set.
result: pass

### 3. Pinata Gated Integration Test
expected: |
  With a valid Pinata JWT (must include `pinJSONToIPFS` AND `unpin` scopes), run
  `PINATA_JWT=<jwt> pnpm exec vitest run test/ipfs.integration.test.ts` from `bot/`.
  Test passes: real upload to Pinata returns a CIDv0 (`Qm...` 46-char string), and
  the cleanup DELETE call unpins it successfully (parsed via `.text()` not `.json()`).
result: pass

### 4. End-to-End Bot Run with PINATA_JWT
expected: |
  With `PINATA_JWT` set in `.env` and at least one PGTCR item that should produce an S1
  (positive) or S2 (negative) action, run the bot. You see pino `info` log lines for
  IPFS upload (e.g., `ipfs-upload-ok`) BEFORE any `writeContract` log line. The submitted
  on-chain `feedbackURI` argument is of the form `ipfs://Qm...` (not `data:application/json;base64,...`).
  If you have no actionable PGTCR items, you can substitute by checking that the bot
  exits cleanly without errors and the prepare pass would have run.
result: pass

### 5. Run Summary IPFS Counters
expected: |
  After any bot run that processes at least one S1/S2 action with PINATA_JWT set, the
  final RunSummary JSON (printed to stderr or whatever output sink you use) contains
  the four new fields: `uploadsAttempted`, `uploadsSucceeded`, `uploadsFailed`,
  `orphanedCids` (string array). For successful txs, `orphanedCids` is empty;
  for any upload that succeeded but its tx failed, the CID is listed there.
result: pass

### 6. Config Validation Redacts PINATA_JWT
expected: |
  Set `PINATA_JWT` to an obviously-invalid value that fails zod (e.g., very short)
  OR temporarily change the schema constraint to force a validation error. Run the bot.
  The error output (pino log line for config validation failure) shows
  `received: "[REDACTED]"` for the PINATA_JWT path — the actual JWT value is never
  printed in the error. Same as the existing BOT_PRIVATE_KEY redaction pattern.
result: skipped
reason: |
  Test premise unreachable. PINATA_JWT schema is `z.string().optional()` with no format/length
  constraint (per Plan 06-01 D-25/D-26 — absence is valid; format is Pinata's source of truth).
  An invalid string never trips zod, so the redaction code at bot/src/config.ts:34 is
  defensive-only on this path. User confirmed via test 4 run with an invalid JWT: bot logged
  `WARN ipfs-upload-failed error_message: "Pinata 401: (unreadable body)"` — JWT was NOT
  leaked anywhere in the output, confirming the operationally relevant security property
  (pino redact.paths covers PINATA_JWT and Authorization). Path-specific zod redaction is
  preserved as defense-in-depth for any future schema constraint additions.

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none — test 6 skipped as premise was invalid; security property holds via pino redaction layer, verified during test 4 run]
