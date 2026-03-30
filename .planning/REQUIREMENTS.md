# Requirements: Kleros Reputation Oracle

**Defined:** 2026-03-30
**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents

## v1.1 Requirements

Requirements for production hardening milestone. Each maps to roadmap phases.

### Structured Logging

- [x] **LOG-01**: Bot uses pino for structured JSON logging to stderr, preserving stdout for dry-run output
- [ ] **LOG-02**: Private keys and Pinata JWT are automatically redacted in all log output including nested error objects
- [ ] **LOG-03**: Bot emits a single run summary JSON at exit: items found, actions computed, txs sent, errors, duration
- [x] **LOG-04**: Log level is configurable via LOG_LEVEL env var (default: info)
- [ ] **LOG-05**: All existing console.log/error calls replaced with structured logger calls

### Transaction Safety

- [ ] **TXSAFE-01**: Gas estimation retries with exponential backoff (3 attempts); transaction submission is never retried
- [ ] **TXSAFE-02**: Null or timed-out transaction receipts are logged with tx hash and treated as errors; next run re-diffs
- [ ] **TXSAFE-03**: Bot checks wallet balance before sending; exits early with clear error if below threshold
- [ ] **TXSAFE-04**: SIGTERM/SIGINT finishes the current transaction, skips remaining actions, and exits cleanly

### IPFS Evidence

- [ ] **IPFS-01**: Bot uploads evidence JSON to Pinata via REST API (native fetch, no SDK), returns ipfs:// CID
- [ ] **IPFS-02**: Evidence follows existing kleros-reputation-oracle/v1 schema
- [ ] **IPFS-03**: IPFS upload failure skips the item (no fallback to data: URI); next run retries
- [ ] **IPFS-04**: All evidence is uploaded (prepare phase) before any transactions are submitted (execute phase)
- [ ] **IPFS-05**: PINATA_JWT added to config as optional; when absent, IPFS features are disabled and items requiring evidence are skipped

## Future Requirements

### Production Hardening (deferred from v1.1)

- **PROD-02**: Monitoring integration (health check endpoint or exit code reporting)
- **PROD-03**: Key rotation documentation and Pausable contract upgrade

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pinata SDK (`pinata` npm package) | 230+ transitive deps for one HTTP call; native fetch suffices |
| data: URI fallback on IPFS failure | User preference: skip item, retry next run. Simpler model. |
| Retry on tx submission | TXSAFE-01 explicitly forbids write retries — duplicate tx risk |
| Pausable contract upgrade | Contract scope, not bot — defer to future milestone |
| CID verification after upload | Propagation delay is inherent; not a v1.1 blocker |
| Correlation IDs per action | Nice-to-have, no breaking change to add later |
| p-retry or retry libraries | Exponential backoff is ~15 lines; no dependency needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOG-01 | Phase 4 | Complete |
| LOG-02 | Phase 4 | Pending |
| LOG-03 | Phase 4 | Pending |
| LOG-04 | Phase 4 | Complete |
| LOG-05 | Phase 4 | Pending |
| TXSAFE-01 | Phase 5 | Pending |
| TXSAFE-02 | Phase 5 | Pending |
| TXSAFE-03 | Phase 5 | Pending |
| TXSAFE-04 | Phase 5 | Pending |
| IPFS-01 | Phase 6 | Pending |
| IPFS-02 | Phase 6 | Pending |
| IPFS-03 | Phase 6 | Pending |
| IPFS-04 | Phase 6 | Pending |
| IPFS-05 | Phase 6 | Pending |

**Coverage:**
- v1.1 requirements: 14 total
- Mapped to phases: 14/14
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after roadmap creation*
