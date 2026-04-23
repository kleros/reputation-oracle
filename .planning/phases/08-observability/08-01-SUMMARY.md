---
phase: 08-observability
plan: "01"
subsystem: bot/config
tags: [config, zod, betterstack, observability]
dependency_graph:
  requires: []
  provides: [BETTERSTACK_SOURCE_TOKEN, BETTERSTACK_HEARTBEAT_URL, HEARTBEAT_TIMEOUT_MS in Config type]
  affects: [bot/src/logger.ts, bot/src/heartbeat.ts]
tech_stack:
  added: []
  patterns: [zod optional url validator, zod coerce number with positive constraint]
key_files:
  created: []
  modified:
    - bot/src/config.ts
    - bot/test/config.test.ts
decisions:
  - "BETTERSTACK_SOURCE_TOKEN optional (no default) — absent = skip Telemetry transport (D-27)"
  - "BETTERSTACK_HEARTBEAT_URL uses .url() validator — rejects malformed URLs before heartbeat.ts fetch (T-08-02)"
  - "HEARTBEAT_TIMEOUT_MS defaults to 10_000ms per DISC-01/D-22 (tolerant over aggressive)"
  - "Redaction extended to BETTERSTACK_SOURCE_TOKEN + BETTERSTACK_HEARTBEAT_URL in loadConfig error output (T-08-01)"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-23T21:37:58Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 2
---

# Phase 8 Plan 01: Config Schema Extension Summary

**One-liner:** Zod config schema extended with 3 Betterstack env vars (source token, heartbeat URL with URL validation, timeout with 10s default) plus threat-model-required redaction.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for Betterstack config fields | 063b928 | bot/test/config.test.ts |
| 1 (GREEN) | Implement 3 Betterstack fields in configSchema | 13e2dcb | bot/src/config.ts, bot/test/config.test.ts |

## Changes Made

### bot/src/config.ts

Three fields added after `PINATA_TIMEOUT_MS` in `configSchema`:

```typescript
BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
```

Redaction in `loadConfig` extended to cover both new secret-bearing fields:
- `BETTERSTACK_SOURCE_TOKEN` — token value never logged in validation errors
- `BETTERSTACK_HEARTBEAT_URL` — opaque ID URL never logged in validation errors

### bot/test/config.test.ts

New `describe("Betterstack config fields")` block with 7 tests covering all behaviors:
1. `BETTERSTACK_SOURCE_TOKEN` accepts a string value
2. `BETTERSTACK_SOURCE_TOKEN` absent → undefined (optional)
3. `BETTERSTACK_HEARTBEAT_URL` rejects non-URL strings
4. `BETTERSTACK_HEARTBEAT_URL` accepts valid HTTPS URL
5. `HEARTBEAT_TIMEOUT_MS` defaults to 10000 when absent
6. `HEARTBEAT_TIMEOUT_MS` coerces string "5000" → number 5000
7. `HEARTBEAT_TIMEOUT_MS` rejects negative values

## Deviations from Plan

### Auto-added Functionality

**[Rule 2 - Missing Critical Functionality] Threat model T-08-01 redaction applied**
- **Found during:** Task 1 implementation
- **Issue:** Plan's threat model (T-08-01) required BETTERSTACK_SOURCE_TOKEN and BETTERSTACK_HEARTBEAT_URL to be added to the `safeIssues` redaction guard in `loadConfig`, but the task action text did not explicitly call this out
- **Fix:** Extended the existing redaction condition to include both new secret-bearing fields
- **Files modified:** bot/src/config.ts
- **Commit:** 13e2dcb

## Verification

```
grep "BETTERSTACK_SOURCE_TOKEN\|BETTERSTACK_HEARTBEAT_URL\|HEARTBEAT_TIMEOUT_MS" bot/src/config.ts
→ 19: BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
→ 20: BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
→ 21: HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),

cd bot && npm run typecheck → exit 0
cd bot && npm test → 88 passed | 1 skipped (89), 0 failed
cd bot && npm run lint → Checked 24 files. No fixes applied. 0 errors.
```

## Known Stubs

None — config schema is fully wired. Downstream plans (08-02 logger.ts, 08-03 heartbeat.ts) will consume these typed fields.

## Threat Flags

None — no new network endpoints or trust boundaries introduced. Fields are parsed from `process.env` (same trust boundary as existing env vars). Redaction applied per T-08-01.

## Self-Check: PASSED

- [x] bot/src/config.ts modified — FOUND
- [x] bot/test/config.test.ts modified — FOUND
- [x] Commit 063b928 (RED) — FOUND
- [x] Commit 13e2dcb (GREEN) — FOUND
- [x] 88 tests passing — VERIFIED
- [x] Biome 0 findings — VERIFIED
- [x] TypeScript 0 errors — VERIFIED
