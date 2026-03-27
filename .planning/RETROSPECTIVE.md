# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Kleros Reputation Oracle

**Shipped:** 2026-03-27
**Phases:** 3 | **Plans:** 9 | **Timeline:** 14 days

### What Was Built
- UUPS-upgradeable Router contract encoding all 3 feedback scenarios as hardcoded constants
- Stateless TypeScript bot with pure diff engine, Multicall3-batched reads, cursor-paginated subgraph
- Idempotent deploy script (proxy + identity + agentId + bot auth in one invocation)
- Live E2E verification on Sepolia: 4 agents verified, getSummary confirmed, idempotency proven

### What Worked
- **Contract-first sequencing** — building the Router ABI first meant the bot could code directly against deployed interfaces. No interface drift.
- **Fork tests against real registries** — testing against live Sepolia ReputationRegistry caught issues that mock tests would have missed (e.g., getSummary return types).
- **Stateless architecture** — no persistence layer simplified everything. The bot is a pure function of (subgraph, chain) → actions.
- **TDD for computeActions()** — 15 test assertions before implementation kept the diff engine clean and correct.
- **Phase 3 as verification-only** — separating "build" from "prove" forced us to validate the entire pipeline end-to-end.

### What Was Inefficient
- **Phase 1 verification debt** — human-gated items in Phase 1 VERIFICATION.md were never formally resolved until Phase 3. Should have updated docs incrementally.
- **ROADMAP.md/REQUIREMENTS.md checkbox drift** — several requirements and plans were marked "Pending" despite being complete. Traceability tables went stale.
- **Bot authorization oversight** — `KRR_NotAuthorizedBot` error during E2E was a deployment config issue, not a code bug. Pre-flight check was added retroactively.

### Patterns Established
- **Data-URI evidence** — inline base64 JSON evidence avoids IPFS dependency for v1. Clean upgrade path to IPFS in v2.
- **FeedbackType enum over boolean** — richer state tracking (None/Positive/Negative) vs simple hasFeedback boolean. Enables better business logic in Router.
- **Multicall3 byte-based batching** — batch size in bytes (1024*200) not call count, per known pitfall with variable-length return data.

### Key Lessons
1. **Authorize before you run** — any system with access control needs a pre-flight verification step. Document it prominently.
2. **Verification reports should update incrementally** — don't let human-gated items accumulate across phases.
3. **Stateless beats stateful for oracle bots** — the diff-and-exit pattern eliminates entire categories of bugs (stale state, restart recovery, DB migrations).

### Cost Observations
- Model mix: ~80% Opus (execution), ~20% Sonnet (verification)
- Sessions: ~8-10 across planning, execution, and verification
- Notable: Phase 2 (4 plans, most complex) executed fastest thanks to well-defined interfaces from Phase 1

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 14 days | 3 | Initial build — contract-first, stateless bot, live E2E |

### Cumulative Quality

| Milestone | Tests | LOC | Components |
|-----------|-------|-----|------------|
| v1.0 | 59 (17 fork + 42 unit) | ~2,000 | Router, Bot, Deploy, Verify |

### Top Lessons (Verified Across Milestones)

1. Build interfaces first, consumers second — reduces integration friction
2. Stateless diff architectures are inherently idempotent — leverage this
