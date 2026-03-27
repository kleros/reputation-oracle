# Milestones

## v1.0 Kleros Reputation Oracle (Shipped: 2026-03-27)

**Phases completed:** 3 phases, 9 plans, 18 tasks

**Key accomplishments:**

- UUPS-upgradeable KlerosReputationRouter with FeedbackType enum state model, three feedback scenarios, and bot authorization against pinned ERC-8004 interfaces
- 17 Foundry fork tests proving all 3 Router scenarios (positive/negative/revoke) plus re-registration, auth guards, and state edge cases against real Sepolia ReputationRegistry
- Idempotent Foundry deploy script deploying Router UUPS proxy, registering Kleros 8004 identity, configuring agentId, and authorizing bot in a single invocation
- Bot scaffold with typed modules: Zod config validation, CAIP-10 item validation, and data-URI evidence builder -- 27 tests passing
- Pure computeActions() function implementing all 3 business scenarios via TDD with 15 test assertions
- Subgraph cursor-paginated client and Multicall3-batched chain reader with sequential tx executor
- One-shot bot entry point wiring config, subgraph, validation, Multicall3, diff, and execution with --dry-run flag and process exit codes
- Forge verification script asserting getSummary values (count, value, tag filtering) for bot-touched Scenario 1 agents
- Live Sepolia E2E: bot submitted 4 positive feedback txs, Verify.s.sol confirmed getSummary(count=1, value=95) for all agents, second dry-run proved idempotency (0 actions)

---
