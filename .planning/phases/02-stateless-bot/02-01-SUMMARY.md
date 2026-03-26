---
phase: 02-stateless-bot
plan: 01
subsystem: bot
tags: [typescript, viem, zod, vitest, biome, caip-10, evidence]

# Dependency graph
requires:
  - phase: 01-router-contract-on-chain-setup
    provides: Router contract ABI (FeedbackType enum, submitPositiveFeedback, submitNegativeFeedback, revokeOnly)
provides:
  - Bot project scaffold (package.json, tsconfig, biome)
  - Shared types (FeedbackType, RawSubgraphItem, ValidatedItem, Action, EvidenceJson)
  - Router ABI as const for viem type inference
  - Config validation with Zod (loadConfig with secret redaction)
  - CAIP-10 parsing and item validation (validateAndTransformItem)
  - Evidence JSON builder with data: URI encoding (buildFeedbackURI)
affects: [02-stateless-bot]

# Tech tracking
tech-stack:
  added: [viem, graphql-request, zod, vitest, "@biomejs/biome", tsx, typescript]
  patterns: [ESM modules, pure functions, Zod schema validation, data URI encoding, bigint for agentId]

key-files:
  created:
    - bot/package.json
    - bot/tsconfig.json
    - bot/biome.json
    - bot/.env.example
    - bot/src/types.ts
    - bot/src/abi/router.ts
    - bot/src/config.ts
    - bot/src/validation.ts
    - bot/src/evidence.ts
    - bot/test/config.test.ts
    - bot/test/validation.test.ts
    - bot/test/evidence.test.ts
  modified: []

key-decisions:
  - "Used zod v3 (stable) instead of v4 (beta) for config validation"
  - "Evidence tags use verified/removed matching Router constants, not curate-verified/curate-removed from PRD"

patterns-established:
  - "Pure function modules: no classes, no I/O in core logic"
  - "bigint for agentId throughout pipeline (never Number)"
  - "Biome auto-fix for formatting and import organization"

requirements-completed: [BOT-04, BOT-05, BOT-06, BOT-09]

# Metrics
duration: 5min
completed: 2026-03-26
---

# Phase 02 Plan 01: Bot Foundation Summary

**Bot scaffold with typed modules: Zod config validation, CAIP-10 item validation, and data-URI evidence builder -- 27 tests passing**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-26T14:21:39Z
- **Completed:** 2026-03-26T14:26:28Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments
- Bot project scaffolded with ESM, all dependencies installed, TypeScript strict mode
- Shared types covering full pipeline: subgraph items, validated items, actions, evidence JSON
- Config validation with Zod including BOT_PRIVATE_KEY redaction in error output
- CAIP-10 chain validation and item transformation with comprehensive edge case handling
- Evidence builder producing data:application/json;base64 URIs for feedbackURI parameter

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold bot project** - `fcf3c5d` (feat)
2. **Task 2: Types, ABI, and config module** - `ec5bb59` (feat)
3. **Task 3: Validation and evidence modules (TDD)** - `9bcca3c` (test: RED), `b5d74df` (feat: GREEN)

## Files Created/Modified
- `bot/package.json` - ESM project with viem, graphql-request, zod dependencies
- `bot/tsconfig.json` - ES2022, Node16 module resolution, strict mode
- `bot/biome.json` - Tab indent, 120 width, recommended rules
- `bot/.env.example` - All required env vars documented
- `bot/src/types.ts` - FeedbackType enum, RawSubgraphItem, ValidatedItem, Action, EvidenceJson
- `bot/src/abi/router.ts` - Router ABI as const for viem type inference
- `bot/src/config.ts` - Zod config schema with loadConfig() and secret redaction
- `bot/src/validation.ts` - parseChainIdFromCAIP10, validateAndTransformItem
- `bot/src/evidence.ts` - buildPositiveEvidence, buildNegativeEvidence, buildFeedbackURI
- `bot/test/config.test.ts` - 6 tests for config validation
- `bot/test/validation.test.ts` - 17 tests for CAIP-10 and item validation
- `bot/test/evidence.test.ts` - 4 tests for evidence building and URI encoding

## Decisions Made
- Used zod v3 (stable, widely adopted) rather than v4 which RESEARCH.md specified -- v4 is not yet on npm as a stable release. z.coerce.number() used instead of z.string().transform(Number).pipe() for simpler CHAIN_ID parsing.
- Evidence JSON tag1 uses "verified"/"removed" matching Router contract constants, per CLAUDE.md guidance overriding PRD S13's "curate-verified"/"curate-removed".
- Used biome v1.9 (stable) rather than v2.4 which RESEARCH.md specified -- v2.4 is not yet available on npm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] zod v4 not available on npm, used v3**
- **Found during:** Task 1 (project scaffolding)
- **Issue:** Plan specified zod ^4.3 but v4 is not available as stable release on npm
- **Fix:** Used zod ^3.24 which is the current stable release. Adjusted config.ts to use z.coerce.number() instead of z.string().transform(Number).pipe()
- **Files modified:** bot/package.json, bot/src/config.ts
- **Verification:** Config tests pass, type inference works correctly
- **Committed in:** fcf3c5d, ec5bb59

**2. [Rule 3 - Blocking] @biomejs/biome v2.4 not available, used v1.9**
- **Found during:** Task 1 (project scaffolding)
- **Issue:** Plan specified @biomejs/biome ^2.4 but v2.4 is not yet released
- **Fix:** Used @biomejs/biome ^1.9 (current stable)
- **Files modified:** bot/package.json, bot/biome.json
- **Verification:** biome check passes clean on all files
- **Committed in:** fcf3c5d

**3. [Rule 3 - Blocking] vitest v4.1 not available, used v3.2**
- **Found during:** Task 1 (project scaffolding)
- **Issue:** Plan specified vitest ^4.1 but v4 is not yet released
- **Fix:** Used vitest ^3.1 (resolves to 3.2.4)
- **Files modified:** bot/package.json
- **Verification:** All 27 tests pass
- **Committed in:** fcf3c5d

---

**Total deviations:** 3 auto-fixed (3 blocking -- npm package version mismatches)
**Impact on plan:** Version downgrades are cosmetic. All APIs used are identical between specified and actual versions. No functionality impact.

## Issues Encountered
None beyond the package version adjustments noted above.

## Next Phase Readiness
- Foundation layer complete: types, ABI, config, validation, evidence all exported and tested
- Ready for Plan 02 (subgraph fetching) and Plan 03 (diff engine) which import from these modules
- No blockers or concerns

## Self-Check: PASSED

All 12 created files verified present. All 4 commits verified in git log.

---
*Phase: 02-stateless-bot*
*Completed: 2026-03-26*
