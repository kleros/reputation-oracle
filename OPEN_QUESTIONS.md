Tracked-but-deferred (already in STATE.md Deferred Items, not ad-hoc — listed for completeness):
- IN-02 parseInt(disputeId) precision → v1.3
- PROD-03 key rotation + Pausable → v1.3
- EVD-01 human-readable text field on IPFS feedback → v1.3
- SEC-02 LoadCredential= systemd credential migration → v1.3

-----

IPFS Uploads
Test these services, tied to Coinbase AWAL (different from Coinbase agentkit)
https://agentic.market/?chart=payment-volume&service=402-pinata-cloud
https://agentic.market/?chart=payment-volume&service=x402-gateway-production-up-railway-app

---

## Reject+resubmit race (deferred, ref 260513-x0m)

**Scenario:** Bot is down when Kleros court issues a Reject ruling AND again when the
agent re-registers (Submitted) on PGTCR. When the bot next wakes up, it sees:
- One Absent item with `disputeOutcome="Reject"` (should trigger -95)
- One Submitted item from the re-registration (should trigger +95)
- Router still at Positive (from the original +95 never revoked / or from a prior run)

Current behaviour after fix (260513-x0m): "live item wins" — bot emits
`submitPositiveFeedback` for the Submitted item and logs a race-detector warning.
The -95 for the Reject is silently skipped. Router ends up Positive.

This is acceptable as a default because the re-registration itself is evidence the agent
considers their identity valid; the human-jury Reject predates that decision.

**Paths considered:**
- **(b1) Persistence** — store per-agentId history in a local DB. REJECTED: violates
  "No local DB/persistence" hard constraint in CLAUDE.md.
- **(b2) Read 8004 history** — query ReputationRegistry for prior feedback entries to
  detect whether a -95 was ever posted. Viable but adds RPC complexity and a new read
  path. Deferred.
- **(b3) Contract change** — Router accumulates agentId-level history on-chain. Viable
  but scope-expands the contract. Deferred to v1.3+.

**Why deferred:** Race requires the bot to miss two distinct on-chain events during
separate time windows. Extremely rare in practice. Race-detector warn log (added in
260513-x0m) will surface any production occurrence in Betterstack.

**Trigger to revisit:** Any production `"reject+resubmit race detected"` warning in
Betterstack logs.
