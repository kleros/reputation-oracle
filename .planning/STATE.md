---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Deploy-to-Mainnet
status: executing
stopped_at: Phase 08 context gathered non-interactively (Telegram MCP disconnect); 3 DISC items flagged for user review before plan-phase
last_updated: "2026-04-23T22:55:00.000Z"
last_activity: 2026-04-23 -- Quick task 260423-wzl — Phase 7 deploy issue fixes
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23 after v1.2 milestone kickoff)

**Core value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents
**Current focus:** Phase 08 — observability

## Current Position

Milestone: v1.2 — Deploy-to-Mainnet
Phase: 08 (observability) — EXECUTING
Plan: 1 of 6
Status: Executing Phase 08
Last activity: 2026-04-23

Progress: [████████████████████] 100% (code) · deferred (live-VPS UAT)

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
| Phase 07-packaging P01 | 4m | 2 tasks | 2 files |
| Phase 07-packaging P02 | 87s | 3 tasks | 3 files |
| Phase 07-packaging P03 | 2min | 1 tasks | 1 files |
| Phase 07-packaging P04 | 48s | 2 tasks | 2 files |
| Phase 07-packaging P05 | 2min | 2 tasks | 2 files |
| Phase 07-packaging P06 | 2min | 1 tasks | 1 files |

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
- [Phase 07-packaging]: tsx promoted to dependencies (not devDependencies) — npm ci --omit=dev would silently drop it otherwise (P1-02, D-04)
- [Phase 07-packaging]: Type=oneshot with no Restart= — timer is retry mechanism; Restart=on-failure would thrash on 429s (D-14, P1-03)
- [Phase 07-packaging]: Exactly 4 hardening directives per D-15: ProtectSystem=strict, PrivateTmp=true, NoNewPrivileges=true, TimeoutStartSec=300 — no speculative extras
- [Phase 07-packaging]: sepolia.env stub created via install -m 0600 (not echo) — prevents bash history capture of secrets (D-16)
- [Phase 07-packaging]: bootstrap step order load-bearing: step 3 useradd must precede steps 5/6/7 that reference oracle user (D-23)
- [Phase 07-packaging]: bootstrap does not enable/start timer — operator enables after dry-run validation (D-24)
- [Phase 07-packaging]: Four-step update order stop→pull→ci→start is load-bearing (P1-09 prevention) — no extra git steps added
- [Phase 07-packaging]: start-timer.sh uses instance-arg form (not Sepolia-hardcoded) — Phase 9 Mainnet reuse with zero changes
- [Phase 07-packaging]: Single RUNBOOK.md file (not split per D-39) — one document operator can bookmark during incidents
- [Phase 07-packaging]: Dry-run command inline in RUNBOOK.md (no separate verify.sh wrapper) — D-29 pattern, simpler for operators
- [Phase 07-packaging]: Acceptance checklist maps 1:1 to PKG-01..PKG-08 with exact shell commands and expected output patterns — not vague prose
- [Phase 07-packaging]: Dry-run command in PKG-08 uses --preserve-env=HOME + grep filters matching RUNBOOK.md §3 exactly
- [Phase 07→08 revision 2026-04-23]: Timer cadence 15→5min (Phase 7 D-13). Fresher reputation signals (~3min avg lag vs ~8min). Triggers Phase 8 D-04 grace 20→10min, D-24 streak 3→5 consecutive empty runs. Mainnet cadence TBD in Phase 9 — may diverge via per-instance systemd drop-in if RPC cost dictates.

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
| uat | Phase 07 live-VPS acceptance (5 items: bootstrap E2E, systemd timer firing, secrets-not-exposed via `systemctl show`, PKG-08 dry-run on live VPS, journald retention active) | Deferred 2026-04-23 — operator executes `deploy/ACCEPTANCE.md` at VPS provisioning time; tracking file `.planning/phases/07-packaging/07-HUMAN-UAT.md` (status: deferred) |

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
| 260423-nw1 | Add Stop hook for end-of-turn linting across bot and contracts | 2026-04-23 | ac1e746 | Complete | [260423-nw1-add-stop-hook-for-end-of-turn-linting-ac](./quick/260423-nw1-add-stop-hook-for-end-of-turn-linting-ac/) |
| 260423-o3o | Auto-fix pre-existing lint drift surfaced by Stop hook (biome safe fixes + forge fmt) | 2026-04-23 | f863bc9 | Complete | [260423-o3o-auto-fix-pre-existing-lint-drift-surface](./quick/260423-o3o-auto-fix-pre-existing-lint-drift-surface/) |
| 260423-o9o | Clear trivial Biome warnings — dead import, biome-ignore comments with rationale, template literals | 2026-04-23 | 0ad4584 | Complete | [260423-o9o-clear-trivial-biome-warnings-dead-import](./quick/260423-o9o-clear-trivial-biome-warnings-dead-import/) |
| 260423-odh | Type viem TransactionReceipt mocks in chain.test.ts via makeReceipt() helper — biome fully clean | 2026-04-23 | 2cfe62b | Verified | [260423-odh-type-viem-transactionreceipt-mocks-in-ch](./quick/260423-odh-type-viem-transactionreceipt-mocks-in-ch/) |
| 260423-wzl | Fix 4 Phase 7 deploy issues — bootstrap.sh nodejs purge + drop --no-create-home; RUNBOOK.md dry-run cwd fix + sudo prefixes | 2026-04-23 | 0ed9f2a | Complete | [260423-wzl-fix-4-deploy-issues-surfaced-during-phas](./quick/260423-wzl-fix-4-deploy-issues-surfaced-during-phas/) |

## Session Continuity

Last session: 2026-04-23T18:45:11.395Z
Stopped at: Phase 08 context gathered non-interactively (Telegram MCP disconnect); 3 DISC items flagged for user review before plan-phase
Resume hint: run `deploy/ACCEPTANCE.md` on the Sepolia VPS, then `/gsd:verify-work 7` to close the 5 UAT items and mark Phase 7 complete
