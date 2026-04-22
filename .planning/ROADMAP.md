# Roadmap: Kleros Reputation Oracle

## Milestones

- ✅ **v1.0 Kleros Reputation Oracle** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v1.1 Production Hardening** — Phases 4-6 (shipped 2026-04-22)
- 📋 **v1.2 — TBD** (next)

## Phases

<details>
<summary>✅ v1.0 Kleros Reputation Oracle (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Router Contract & On-Chain Setup (3/3 plans) — UUPS proxy, 3 scenarios, fork tests, deploy script
- [x] Phase 2: Stateless Bot (4/4 plans) — diff engine, subgraph client, Multicall3, dry-run — completed 2026-03-26
- [x] Phase 3: End-to-End Verification (2/2 plans) — Verify.s.sol, live E2E on Sepolia — completed 2026-03-27

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Production Hardening (Phases 4-6) — SHIPPED 2026-04-22</summary>

- [x] Phase 4: Structured Logging (2/2 plans) — pino logger, secret redaction, run summary — completed 2026-03-30
- [x] Phase 5: Transaction Safety (4/4 plans) — gas retry, balance preflight, receipt handling, graceful shutdown — completed 2026-04-21
- [x] Phase 6: IPFS Evidence (5/5 plans) — Pinata upload, prepare/execute split, failure isolation — completed 2026-04-22

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>Orphan: Phase 1000 — Upgrade bot dependencies to latest majors (SHIPPED 2026-03-27)</summary>

- [x] 1000-01-PLAN.md — Upgrade zod v4 + vitest v4 (zero code changes) — completed 2026-03-27
- [x] 1000-02-PLAN.md — Upgrade Biome v2 (config migration + lint fixes) + update CLAUDE.md

Standalone dependency-maintenance phase, not tied to a milestone. Completed between v1.0 close and v1.1 start to align with other Kleros projects.

</details>

### 📋 v1.2 — TBD (Planned)

Next milestone scope not yet defined. Run `/gsd:new-milestone` to start questioning → research → requirements → roadmap.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Router Contract & On-Chain Setup | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Stateless Bot | v1.0 | 4/4 | Complete | 2026-03-26 |
| 3. End-to-End Verification | v1.0 | 2/2 | Complete | 2026-03-27 |
| 1000. Upgrade bot deps | — | 2/2 | Complete | 2026-03-27 |
| 4. Structured Logging | v1.1 | 2/2 | Complete | 2026-03-30 |
| 5. Transaction Safety | v1.1 | 4/4 | Complete | 2026-04-21 |
| 6. IPFS Evidence | v1.1 | 5/5 | Complete | 2026-04-22 |

## Backlog

_(empty)_
