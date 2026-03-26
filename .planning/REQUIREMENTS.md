# Requirements: Kleros Reputation Oracle

**Defined:** 2026-03-25
**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents

## v1 Requirements

### Router Contract

- [ ] **ROUT-01**: Router deployed on Sepolia as UUPS proxy with storage gaps for future upgrades
- [ ] **ROUT-02**: Router stores feedback state per agentId (`hasFeedback`, `feedbackIndex`)
- [ ] **ROUT-03**: Scenario 1 — `submitPositiveFeedback(agentId, pgtcrItemId, feedbackURI)` calls `giveFeedback(agentId, 95, 0, "verified", "kleros-agent-registry", "", feedbackURI, 0x0)` and reverts if feedback already exists
- [ ] **ROUT-04**: Scenario 2 — `submitNegativeFeedback(agentId, feedbackURI)` revokes existing positive feedback then calls `giveFeedback(agentId, -95, 0, "removed", "kleros-agent-registry", "", feedbackURI, 0x0)`
- [ ] **ROUT-05**: Scenario 3 — `revokeOnly(agentId)` revokes existing feedback without submitting new feedback
- [ ] **ROUT-06**: Bot authorization — only addresses with `authorizedBots[msg.sender] == true` can call feedback functions
- [ ] **ROUT-07**: Owner can add/remove authorized bot addresses and transfer ownership
- [ ] **ROUT-08**: Router emits events for all state changes (PositiveFeedbackSubmitted, NegativeFeedbackSubmitted, FeedbackRevoked, BotAuthorizationChanged)
- [ ] **ROUT-09**: Feedback values (±95), decimals (0), and tags ("verified"/"removed", "kleros-agent-registry") are constants in the contract
- [x] **ROUT-10**: All Router functions pass forge test suite including edge cases (double submission, revoke without feedback, re-registration after dispute)

### Bot Core

- [ ] **BOT-01**: Bot reads all PGTCR items from Goldsky subgraph using cursor-based pagination (`id_gt`, never `skip`)
- [ ] **BOT-02**: Bot reads Router state via Multicall3-batched `hasFeedback()` calls
- [x] **BOT-03**: `computeActions()` pure function computes diff between subgraph state and Router state, returning action list for all 3 scenarios
- [x] **BOT-04**: Bot resolves agentId from subgraph `metadata.key0` (Strategy A) and validates chain via `metadata.key2` (CAIP-10)
- [x] **BOT-05**: Bot validates subgraph data before acting: itemID format, metadata fields, status enum values, disputeOutcome values
- [x] **BOT-06**: Config validated at startup via zod schema: required CHAIN_ID, RPC_URL, BOT_PRIVATE_KEY (redacted in errors), SUBGRAPH_URL, ROUTER_ADDRESS
- [ ] **BOT-07**: Bot is one-shot — runs once, exits with code 0 on success, non-zero on failure
- [ ] **BOT-08**: Dry-run mode — read-only execution that displays on stdout the write operations the bot would have performed, without submitting any transactions
- [x] **BOT-09**: Items that fail validation are logged and skipped, not crash the run

### Identity & Setup

- [ ] **SETUP-01**: Foundry deploy script deploys Router as UUPS proxy on Sepolia
- [ ] **SETUP-02**: Foundry script registers Kleros as an 8004 agent on IdentityRegistry with oracle service metadata
- [ ] **SETUP-03**: Foundry script configures Router with `klerosAgentId`, `reputationRegistry`, `identityRegistry` addresses
- [ ] **SETUP-04**: Foundry script authorizes bot address on Router

### Verification

- [ ] **VER-01**: After Scenario 1, `getSummary(agentId, [router], "", "")` returns `count=1, value=95`
- [ ] **VER-02**: After Scenario 2, `getSummary(agentId, [router], "", "")` returns `count=1, value=-95`
- [ ] **VER-03**: After Scenario 3, `getSummary(agentId, [router], "", "")` returns `count=0`
- [ ] **VER-04**: Tag filtering works — `getSummary` with tag1="verified" vs "removed" returns filtered results

## v2 Requirements

### Transaction Safety

- **TXSAFE-01**: Gas estimation retryable, transaction submission NOT retryable
- **TXSAFE-02**: Handle null/dropped transaction receipts (log tx hash, next run re-diffs)
- **TXSAFE-03**: Balance preflight check — exit without sending if below threshold
- **TXSAFE-04**: Graceful shutdown on SIGTERM/SIGINT — finish current tx, skip remaining

### IPFS Evidence

- **IPFS-01**: Bot uploads evidence JSON to Pinata before feedback calls
- **IPFS-02**: Evidence follows `kleros-reputation-oracle/v1` schema from PRD §13
- **IPFS-03**: IPFS upload failure skips the item, does not block the entire run

### Production Hardening

- **PROD-01**: Structured JSON logging for all operations
- **PROD-02**: Monitoring integration (health check endpoint or exit code reporting)
- **PROD-03**: Key rotation documentation and Pausable contract upgrade

## Out of Scope

| Feature | Reason |
|---------|--------|
| Local database or persistent state | Stateless diff architecture eliminates the need |
| Eligibility engine or age thresholds | PGTCR submissionPeriod already handles this |
| Configurable feedback values | ±95, decimals 0, tags are protocol constants |
| Multi-chain routing in one process | One deployment per chain, chain = env vars |
| Daemon mode or polling loop | One-shot run, external scheduler invokes |
| Multi-list support | Single PGTCR list per Router; contract upgradeable for future |
| Curate v2 / Kleros v2 support | Using v1; architecture supports future migration |
| Re-registration revocation | History accumulates; mixed record is correct |
| Admin mapping (Strategy C) | Strategy A (key0) is primary; admin mapping adds complexity without PoC value |
| Mock-call-ordering tests | Test boundaries not wiring per PRD amendments |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ROUT-01 | Phase 1 | Pending |
| ROUT-02 | Phase 1 | Pending |
| ROUT-03 | Phase 1 | Pending |
| ROUT-04 | Phase 1 | Pending |
| ROUT-05 | Phase 1 | Pending |
| ROUT-06 | Phase 1 | Pending |
| ROUT-07 | Phase 1 | Pending |
| ROUT-08 | Phase 1 | Pending |
| ROUT-09 | Phase 1 | Pending |
| ROUT-10 | Phase 1 | Complete |
| BOT-01 | Phase 2 | Pending |
| BOT-02 | Phase 2 | Pending |
| BOT-03 | Phase 2 | Complete |
| BOT-04 | Phase 2 | Complete |
| BOT-05 | Phase 2 | Complete |
| BOT-06 | Phase 2 | Complete |
| BOT-07 | Phase 2 | Pending |
| BOT-08 | Phase 2 | Pending |
| BOT-09 | Phase 2 | Complete |
| SETUP-01 | Phase 1 | Pending |
| SETUP-02 | Phase 1 | Pending |
| SETUP-03 | Phase 1 | Pending |
| SETUP-04 | Phase 1 | Pending |
| VER-01 | Phase 3 | Pending |
| VER-02 | Phase 3 | Pending |
| VER-03 | Phase 3 | Pending |
| VER-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
