# Roadmap: Kleros Reputation Oracle

## Milestones

- ✅ **v1.0 Kleros Reputation Oracle** — Phases 1-3 (shipped 2026-03-27)

## Phases

<details>
<summary>✅ v1.0 Kleros Reputation Oracle (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Router Contract & On-Chain Setup (3/3 plans) — UUPS proxy, 3 scenarios, fork tests, deploy script
- [x] Phase 2: Stateless Bot (4/4 plans) — diff engine, subgraph client, Multicall3, dry-run — completed 2026-03-26
- [x] Phase 3: End-to-End Verification (2/2 plans) — Verify.s.sol, live E2E on Sepolia — completed 2026-03-27

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Router Contract & On-Chain Setup | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Stateless Bot | v1.0 | 4/4 | Complete | 2026-03-26 |
| 3. End-to-End Verification | v1.0 | 2/2 | Complete | 2026-03-27 |
| 1000. Upgrade bot deps | — | 2/2 | Complete   | 2026-03-27 |

### Phase 1000: Upgrade bot dependencies to latest majors

**Goal:** Upgrade zod v3→v4, Biome.js v1→v2, vitest v3→v4. Aligns with other Kleros projects already on these versions.
**Depends on:** v1.0 complete
**Requirements:** UPG-01 (zod v4), UPG-02 (vitest v4), UPG-03 (Biome v2)
**Plans:** 2/2 plans complete

Plans:
- [x] 1000-01-PLAN.md — Upgrade zod v4 + vitest v4 (zero code changes) — completed 2026-03-27
- [x] 1000-02-PLAN.md — Upgrade Biome v2 (config migration + lint fixes) + update CLAUDE.md

## Backlog

_(empty)_
