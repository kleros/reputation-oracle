# Phase 4: Structured Logging - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace all console.log/error/warn calls in the bot with pino structured JSON logging. All logs to stderr (preserving stdout for dry-run output). Add secret redaction, log-level configuration, and a run summary emitted at exit. 24 console calls across 5 files (index.ts, chain.ts, subgraph.ts, validation.ts, config.ts).

</domain>

<decisions>
## Implementation Decisions

### Log Output Format
- **D-01:** NDJSON always via pino. Production reads raw JSON; development uses `pino-pretty` (dev dependency) piped at runtime for colorized human output.
- **D-02:** All pino logs write to stderr. Dry-run JSON output stays on stdout via `process.stdout.write()` or `console.log()`. This preserves existing dry-run script compatibility.
- **D-03:** LOG_LEVEL env var (optional, default: "info") controls verbosity. Added to zod config schema as optional string.

### Secret Redaction
- **D-04:** Claude's discretion on redaction depth. Balance security and complexity — at minimum, redact BOT_PRIVATE_KEY and PINATA_JWT in log output. Consider pino redact paths + custom error serializer for nested cause chains. The right approach depends on what pino's built-in redaction handles vs what needs custom serialization.

### Run Summary
- **D-05:** Single summary JSON line at exit with counts only: `{items, valid, actions, txSent, errors, durationMs}`. No per-action detail in the summary — individual action logs cover that.
- **D-06:** Summary emitted at info level as the last log line before exit. Both success and failure paths emit it.

### Logger Module Design
- **D-07:** `bot/src/logger.ts` exports a single configured pino instance. Modules import it and use `logger.child({module: 'chain'})` for per-module context.
- **D-08:** Logger must be initialized before config validation (config.ts errors need structured logging too). Use a default logger that gets reconfigured after config loads if LOG_LEVEL differs from default.

### Console Migration
- **D-09:** All 24 console.log/error/warn calls replaced with appropriate pino levels: console.log → logger.info, console.error → logger.error, console.warn → logger.warn. validation.ts skip messages use logger.warn with structured data ({itemId, reason}).

### Claude's Discretion
- Exact pino configuration options (serializers, formatters, base fields)
- Whether to include timestamp format customization
- Error serializer implementation depth for nested cause chains
- How to handle the pino instance lifecycle (create early, reconfigure after config)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bot Source (migration targets)
- `bot/src/index.ts` — Main orchestrator, 14 console calls, dry-run JSON output to stdout
- `bot/src/chain.ts` — Tx execution, 3 console calls (router states, tx confirmation, no-actions)
- `bot/src/subgraph.ts` — Subgraph client, 1 console call (items fetched)
- `bot/src/validation.ts` — Item validation, 7 console.warn calls (skip reasons)
- `bot/src/config.ts` — Config validation, 1 console.error call

### Bot Config
- `bot/src/config.ts` — Zod schema, add LOG_LEVEL optional field
- `bot/package.json` — Add pino + pino-pretty deps

### Research
- `.planning/research/STACK.md` — pino ^10.3 rationale, pino-pretty ^14.0
- `.planning/research/ARCHITECTURE.md` — Logger module design, stderr routing
- `.planning/research/PITFALLS.md` — Pitfall 2 (JWT leakage), Pitfall 6 (stdout/stderr), Pitfall 11 (nested redaction), Pitfall 14 (pino flush on shutdown)

### Requirements
- `.planning/REQUIREMENTS.md` — LOG-01 through LOG-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bot/src/config.ts` already has secret redaction for BOT_PRIVATE_KEY in zod validation errors — same pattern extends to PINATA_JWT
- Zod schema pattern in config.ts can add LOG_LEVEL as `z.string().optional().default("info")`

### Established Patterns
- All bot modules are pure ESM with named exports — logger.ts follows same pattern
- `bot/src/types.ts` defines shared types — RunSummary type goes here
- Config loaded in index.ts `main()` before any other operations — logger init must precede config

### Integration Points
- `bot/src/index.ts` main() — add logger init at top, run summary at exit, replace all console calls
- `bot/src/chain.ts` executeActions() — replace console.log with logger.info including tx hash, agentId, action type as structured fields
- `bot/src/validation.ts` validateAndTransformItem() — replace console.warn with logger.warn including itemId, reason, raw field values
- `bot/package.json` — add pino, pino-pretty (dev), add `start:dev` script with pino-pretty pipe

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Research recommends pino stderr destination, which aligns with user's decision to keep stdout clean.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-structured-logging*
*Context gathered: 2026-03-30*
