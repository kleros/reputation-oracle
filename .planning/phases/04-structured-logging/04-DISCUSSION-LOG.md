# Phase 4: Structured Logging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 04-structured-logging
**Areas discussed:** Log output format, Secret redaction scope, Run summary shape, Logger module design

---

## Log Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| NDJSON always + pino-pretty dev dep | Production: raw NDJSON to stderr. Dev: pipe through pino-pretty for colorized human output. | ✓ |
| NDJSON always, no pretty | Always NDJSON. Developers read raw JSON or use external tools. | |
| You decide | Claude picks the best approach | |

**User's choice:** NDJSON always + pino-pretty dev dep
**Notes:** None

### Follow-up: stdout/stderr separation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, stderr for logs (Recommended) | All pino logs to stderr. Dry-run JSON stays on stdout. | ✓ |
| You decide | Claude picks based on codebase constraints | |

**User's choice:** Yes, stderr for logs
**Notes:** Preserves existing dry-run script compatibility

---

## Secret Redaction Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Pino redaction paths + error serializer | Built-in redact option + custom error serializer for nested cause chains | |
| Pino redaction paths only | Only redact known top-level fields, simpler | |
| You decide | Claude implements the safest approach | ✓ |

**User's choice:** "You decide the right balance between security and complexity"
**Notes:** Claude's discretion — balance security vs complexity

---

## Run Summary Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Counts only | {items, valid, actions, txSent, errors, durationMs} — one line, machine-parseable | ✓ |
| Counts + per-action detail | Counts plus array of per-action entries | |
| You decide | Claude picks appropriate detail | |

**User's choice:** Counts only
**Notes:** None

---

## Logger Module Design

| Option | Description | Selected |
|--------|-------------|----------|
| Single exported instance | logger.ts exports configured pino instance, modules use logger.child() | ✓ |
| Factory function | createLogger(module) per module, more explicit | |
| You decide | Claude picks simplest approach | |

**User's choice:** Single exported instance
**Notes:** None

---

## Claude's Discretion

- Secret redaction implementation depth (pino redact paths vs custom serializer)
- Exact pino configuration options
- Error serializer for nested cause chains
- Logger lifecycle (init before config)

## Deferred Ideas

None
