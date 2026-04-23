---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Deploy-to-Mainnet
status: Ready to plan
stopped_at: Roadmap written — Phase 7 is next
last_updated: "2026-04-23T02:00:00.000Z"
last_activity: 2026-04-23 -- v1.2 roadmap created; 3 phases defined (7-Packaging, 8-Observability, 9-Mainnet)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23 after v1.2 milestone kickoff)

**Core value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents
**Current focus:** Milestone v1.2 Deploy-to-Mainnet — Phase 7 Packaging is next

## Current Position

Milestone: v1.2 — Deploy-to-Mainnet
Phase: 7 — Packaging (not started)
Plan: —
Status: Ready to plan
Last activity: 2026-04-23 — v1.2 roadmap written; 25 requirements mapped across 3 phases

Progress: [░░░░░░░░░░░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 11 (v1.1) + 2 (Phase 1000 orphan) = 13
- v1.1 timeline: 2026-03-30 → 2026-04-22 (24 days)
- Phase 6 execution: ~3 hours wall-clock (parallel worktree waves)

**By Phase (v1.1):**

| Phase | Plans | Completed |
|-------|-------|-----------|
| 04-structured-logging | 2 | 2026-03-30 |
| 05-transaction-safety | 4 | 2026-04-21 |
| 06-ipfs-evidence | 5 | 2026-04-22 |

## Accumulated Context

### Decisions

All v1.1 decisions logged in PROJECT.md Key Decisions table. Archive in `.planning/milestones/v1.1-ROADMAP.md`.

**v1.2 decisions:**
- Phase order: Packaging → Observability → Mainnet (systemd runtime required before Betterstack tokens; observability required before spending real ETH)
- tsx moved to `dependencies` (not devDependencies) — packaging blocker; `npm ci --omit=dev` silently breaks without it
- NodeSource apt for Node 22 (not nvm) — system-wide `/usr/bin/node` visible to systemd
- `EnvironmentFile` at 0600 (not inline `Environment=`) — prevents key exfiltration via `systemctl show`
- `@logtail/pino` for Betterstack transport; `closeLogger(cb)` exported from `logger.ts` to drain worker threads before exit
- viem `fallbackTransport` for Mainnet RPC resilience (primary Alchemy + fallback publicnode.com)
- Mainnet signer = fresh keypair, never reused from Sepolia
- 7-day Sepolia burn-in gate: Betterstack Uptime must show 7+ clean heartbeats before Mainnet timer enabled

### Deferred Items

Items acknowledged and deferred at v1.1 milestone close on 2026-04-22:

| Category | Item | Status |
|----------|------|--------|
| security | 06-SECURITY.md threat-mitigation audit | ✓ Resolved 2026-04-23 — 20/20 threats closed (commit ce3b85b) |
| uat | 06-UAT user acceptance testing | ✓ Resolved 2026-04-23 — 5 passed, 0 issues, 1 skipped (commit 32504bc) |
| audit | v1.1-MILESTONE-AUDIT.md | Not run before close |
| code-review | IN-01 dead `?? 30_000` fallback in chain.ts | ✓ Fixed 2026-04-23 (commit 3e8b106) |
| code-review | IN-02 `parseInt(disputeId)` precision loss above 2^53 | Theoretical — Kleros dispute counts far below this; deferred to v1.3 |
| requirement | PROD-02 monitoring integration | Addressed in v1.2 Phase 8 (OBS-01..OBS-08) |
| requirement | PROD-03 key rotation + Pausable contract upgrade | Deferred to v1.3 |

### Pending Todos

None.

### Blockers/Concerns

- ERC-8004 Mainnet registry addresses are MEDIUM confidence (from erc-8004-contracts repo) — must verify on Etherscan before Phase 9 deploy
- Mainnet PGTCR list deployment is an external dependency — Phase 9 cannot fully activate until list exists (coordinated externally)
- Goldsky Mainnet subgraph v0.0.1 field set needs manual pre-flight validation against `subgraph.ts` query before first live run

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260329-mxh | Fix agent registration — move IdentityRegistry.register into Router so Router owns klerosAgentId | 2026-03-29 | 5fba9c0 | Verified | [260329-mxh-fix-agent-registration-move-identityregi](./quick/260329-mxh-fix-agent-registration-move-identityregi/) |
| 260423-2ev | fix IN-01 — remove dead `?? 30_000` fallback on PINATA_TIMEOUT_MS at bot/src/chain.ts:228 | 2026-04-23 | 3e8b106 | Complete | [260423-2ev-fix-in-01](./quick/260423-2ev-fix-in-01/) |

## Session Continuity

Last session: 2026-04-23 — v1.2 roadmap written
Stopped at: Phase 7 Packaging ready to plan
Resume hint: `/gsd:plan-phase 7` to start packaging plans
