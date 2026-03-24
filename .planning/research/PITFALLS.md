# Domain Pitfalls

**Domain:** Subgraph-to-chain oracle / PGTCR-to-ERC-8004 reputation bridge
**Researched:** 2026-03-24
**Overall confidence:** MEDIUM-HIGH (based on training data for oracle/bridge patterns, verified against PRD specifics)

> **Scope note:** The PRD amendments already document pitfalls from the PoC review: daemon mode, local DB, mock-heavy tests, unsafe tx retry, eligibility engines. This document covers pitfalls **beyond** those known issues.

---

## Critical Pitfalls

Mistakes that cause rewrites, stuck state, or incorrect reputation data.

### Pitfall 1: Subgraph Indexing Lag Creates False Negatives

**What goes wrong:** The bot reads subgraph state that is behind chain state. An item was just challenged and removed on-chain, but the subgraph still shows it as `Submitted`. The bot sees "Submitted + no feedback" and submits positive feedback for an agent that should be getting negative feedback. The next run corrects it (revoke + negative), but for the interval between runs, the agent has incorrect positive reputation.

**Why it happens:** Goldsky subgraphs have variable indexing latency (seconds to minutes, occasionally longer during reorgs or heavy load). The bot treats subgraph data as ground truth without validating freshness.

**Consequences:** Temporarily incorrect reputation. If the scheduling interval is long (e.g., hourly), an agent that was removed by dispute carries positive reputation for up to an hour. For a reputation oracle backed by economic security, this undermines the trust signal.

**Prevention:**
- Query the subgraph's `_meta { block { number } }` field and compare to the chain's latest block. If the lag exceeds a threshold (e.g., 50 blocks on mainnet, 200 on L2s), log a warning and optionally skip the run.
- For Scenario 2 (dispute removal), cross-validate the item's on-chain status via a direct `PermanentGTCR.items(itemID)` call before issuing negative feedback. The subgraph is the discovery layer; the chain is the confirmation layer.
- Accept that positive feedback (Scenario 1) is lower-risk for lag because the PGTCR `submissionPeriod` already enforces a waiting window.

**Detection:** Monitor the gap between subgraph block height and chain block height over time. Alert if it exceeds the threshold for more than 2 consecutive runs.

**Phase:** Phase 1 (Bot core). The `_meta` check should be in the initial polling implementation.

---

### Pitfall 2: Nonce Collision on Partial Run Failure

**What goes wrong:** The bot processes a batch of actions sequentially. Action 3 of 10 sends a transaction. The RPC accepts it but the response times out (network glitch). The bot catches the error and moves to action 4. Now actions 3 and 4 may use the same nonce (depending on how viem's nonce management works), or the bot may skip action 3's confirmation entirely. On the next run, the stateless diff re-computes, but if action 3 landed on-chain between runs, the diff is now stale.

**Why it happens:** viem's default nonce management queries `eth_getTransactionCount` with `pending`, but "pending" behavior varies by RPC provider. Some RPCs drop pending transactions from the pool after a timeout. Others keep them indefinitely. The bot has no way to know if a timed-out transaction will land or not.

**Consequences:** Duplicate transactions (wasting gas), stuck nonces (all subsequent transactions queue behind a dropped one), or skipped actions that never get retried because the next run's diff looks clean (the timed-out tx landed silently).

**Prevention:**
- Use explicit nonce management: fetch the nonce once at the start of the action loop, increment locally per transaction. This avoids nonce conflicts within a single run.
- After each transaction submission, wait for the receipt (with a bounded timeout). If receipt times out, stop processing further actions and exit. The next run re-diffs and handles anything that was missed.
- Never fire-and-forget: each transaction must either confirm or be the last one attempted in that run.
- The PRD's "tx submission NOT retryable" rule (Amendment 4) is correct but incomplete. It should extend to "stop the run after any tx ambiguity."

**Detection:** Log every nonce used. Alert on nonce reuse or gaps between runs.

**Phase:** Phase 1 (Bot core, transaction execution loop).

---

### Pitfall 3: Revoke-Then-Negative Is Not Atomic

**What goes wrong:** Scenario 2 requires two Router calls: `revokeFeedback()` then `submitNegativeFeedback()`. These are separate transactions. If the first succeeds but the second fails (gas spike, bot crashes, SIGTERM between them), the agent ends up with no reputation at all (revoked positive, no negative submitted). On the next run, the diff sees "Absent + disputeOutcome=Reject + hasFeedback=false" and... the current `computeActions` logic has no branch for this state. The agent was supposed to get -95 but gets nothing.

**Why it happens:** The `computeActions` diff logic checks `hasFeedback` to decide whether to revoke. If the revoke already happened but the negative wasn't submitted, `hasFeedback` is false. The `else if (item.status === 'Absent' && has)` branch doesn't match because `has` is false. The item falls through with no action.

**Consequences:** An agent that was removed by dispute has zero reputation instead of -95. The oracle's core promise (dispute removal = negative reputation) is silently broken.

**Prevention:**
- **Contract-level fix (preferred):** Make `submitNegativeFeedback` handle both cases: (1) revoke existing + submit negative, (2) submit negative without prior revoke. The current Router code already does this in the `else` branch of `submitNegativeFeedback` (no existing feedback). This branch should be reachable after a failed prior revoke.
- **Bot-level fix:** In `computeActions`, add a fourth case: "Absent + disputeOutcome=Reject + hasFeedback=false + we know the agent had previous positive feedback." The tricky part is "we know" - without local state, this requires checking the ReputationRegistry's feedback history for this agent/client pair, or checking the Router's events.
- **Simplest fix:** The `submitNegativeFeedback` function on the Router already handles `hasFeedback == false` in its else branch (lines 1281-1298 of the PRD). So the bot just needs to call `submitNegativeFeedback` regardless, and the Router handles both paths. The diff logic should be: "Absent + disputeOutcome=Reject" triggers negative feedback, period. The Router decides whether to revoke first.

**Detection:** Monitor for agents with `Absent + Reject` status in the subgraph but `hasFeedback=false` on the Router. These are the stuck cases.

**Phase:** Phase 1 (Router contract design and bot diff logic). This is a design-time decision, not a runtime fix.

---

### Pitfall 4: feedbackIndex Desync Between Router and ReputationRegistry

**What goes wrong:** The Router stores `feedbackIndex[agentId]` after calling `reputationRegistry.giveFeedback()`. But the index it stores comes from `getLastIndex(agentId, address(this))` called _after_ the feedback is given. If another contract (or a future second Router) gives feedback for the same agent from the same client address between the `giveFeedback` and `getLastIndex` calls in the same block, the stored index could point to the wrong entry.

**Why it happens:** `getLastIndex` is not transactional with `giveFeedback`. In the current single-Router design, this can't happen because only one Router calls from `address(this)`. But it becomes a real risk if:
- A second bot process sends a competing transaction in the same block.
- The Router contract is upgraded to support multi-list feedback, and two feedback calls for different lists but the same agent happen in one transaction.

**Consequences:** `revokeOnly` or `submitNegativeFeedback` revokes the wrong feedback entry. On ERC-8004, revoking the wrong index could revoke someone else's feedback or revert if the index doesn't belong to this client.

**Prevention:**
- **Immediate:** The Router should compute and return the index from the `giveFeedback` call's return value, not from a separate `getLastIndex` call. Check if `ReputationRegistry.giveFeedback` returns the index. If it does, use the return value. If not, the current approach is the best available.
- **For multi-list/multi-bot:** Add a mutex or ensure only one bot can call the Router at a time (the `onlyAuthorizedBot` modifier already ensures this per-address, but two authorized bots could race).
- **Single bot per Router deployment** is the simplest operational guarantee.

**Detection:** After each `giveFeedback`, verify the stored index by reading the feedback entry at that index and confirming the parameters match.

**Phase:** Phase 1 (Router contract). Verify `giveFeedback` return value in the ERC-8004 spec before finalizing the Router code.

---

### Pitfall 5: Subgraph "Disputed" Status Is an Unstable Intermediate

**What goes wrong:** The bot encounters an item with `status = Disputed`. The current diff logic only handles `Submitted`, `Reincluded`, and `Absent`. A `Disputed` item is silently skipped. If the dispute resolves to `Absent` with `disputeOutcome = Reject` between runs, the next run handles it correctly. But if the dispute resolves to `Reincluded` (submitter wins), the item comes back as active and the bot processes it. The problem: during the `Disputed` phase, if the bot had already submitted positive feedback (from a prior `Submitted` state), the feedback remains active while the item is under active dispute. The agent carries +95 reputation during a period when their legitimacy is being contested.

**Why it happens:** `Disputed` is a transitional state. The bot's stateless diff model correctly ignores it (no action needed). But consumers of the 8004 reputation data don't know an active dispute exists. The +95 feedback is presented as "verified" when it's actually "verification contested."

**Consequences:** Reputation consumers make decisions based on +95 "verified" reputation for an agent whose verification is actively under dispute. This is misleading, even if the reputation eventually corrects.

**Prevention:**
- **Accept it for PoC:** The PGTCR dispute process already has economic guarantees (challenger posts stake). A disputed item may or may not be removed. Revoking during dispute would be premature.
- **Production enhancement:** Consider a "pause" or "disputed" tag. But ERC-8004 doesn't support status flags on individual feedback entries. The cleanest approach is to document this as a known limitation: reputation reflects the last settled state, not the current contested state.
- **Monitoring:** Expose a metric or log entry when the subgraph shows items in `Disputed` status that have active feedback. Operators can manually investigate if needed.

**Detection:** Log items that transition from `Submitted/Reincluded` to `Disputed` while having active feedback.

**Phase:** Phase 2 (Production hardening). Not critical for PoC, but should be documented as a known limitation.

---

## Moderate Pitfalls

### Pitfall 6: IPFS Upload Failure Blocks the Entire Run

**What goes wrong:** For Scenarios 1 and 2, the bot uploads IPFS evidence JSON before calling the Router. If the IPFS pinning service (Pinata, etc.) is down or rate-limited, the bot can't produce a `feedbackURI`. The entire action is blocked, and since the bot processes actions sequentially, all subsequent actions are also blocked.

**Prevention:**
- Upload all IPFS evidence _before_ starting the transaction execution phase. Separate the "prepare" phase (subgraph read, diff compute, IPFS uploads) from the "execute" phase (on-chain transactions).
- If IPFS upload fails for a specific action, skip that action and continue with others. The next run re-diffs and retries the failed ones.
- Use a fallback IPFS gateway (e.g., Pinata primary, The Graph IPFS node as fallback).
- For Scenario 3 (revoke-only), no IPFS is needed. These actions should not be blocked by IPFS failures.

**Phase:** Phase 1 (Bot core). Structure the main loop as: compute actions -> prepare all IPFS -> execute transactions.

---

### Pitfall 7: Multicall3 Batch Size Exceeds Gas Limit or RPC Payload

**What goes wrong:** The bot batches all `hasFeedback()` calls into Multicall3. With 10k+ agents, this becomes a single `eth_call` with tens of thousands of sub-calls. Some RPC providers limit `eth_call` gas or payload size. The call silently fails, returns partial data, or times out.

**Prevention:**
- Chunk Multicall3 batches to a reasonable size (100-200 calls per batch). Process chunks sequentially.
- Handle Multicall3 partial failures: if `tryAggregate` is used (with `requireSuccess = false`), check each result's success flag individually.
- Test with the target RPC provider's limits during development. Public RPCs (Alchemy, Infura free tier) have stricter limits than paid ones.

**Phase:** Phase 1 (Bot core). Use viem's built-in `multicall` which handles chunking automatically via the `batchSize` option, but verify the default is sensible.

---

### Pitfall 8: Agent Re-registration Creates Inconsistent Router State

**What goes wrong:** Open question Q1 from the PRD. Agent gets +95 (Scenario 1). Agent removed by dispute: revoke + submit -95 (Scenario 2). Now `hasFeedback=true, feedbackIndex -> -95 entry`. Agent re-registers on PGTCR, goes to `Submitted`. The diff sees: "Submitted + hasFeedback=true" -- this matches neither Scenario 1 (needs `!has`) nor Scenarios 2/3 (needs `Absent`). The agent is silently skipped. They never get new positive feedback.

**Why it happens:** The Router tracks a single boolean `hasFeedback` per agent. After Scenario 2, `hasFeedback=true` (pointing to the -95). The diff's Scenario 1 branch requires `!hasFeedback`. The re-registered agent never enters any branch.

**Consequences:** An agent that was once removed by dispute and then legitimately re-verified never regains positive reputation through the oracle. The system silently fails for the re-registration case.

**Prevention:**
- **Router fix:** Track feedback _type_ (positive/negative/revoked), not just presence. The diff logic becomes: "Submitted + (no feedback OR negative feedback) -> submit positive" and "Absent + positive feedback -> revoke/negative."
- **Minimal fix:** Add a `feedbackType` enum to the Router: `None`, `Positive`, `Negative`. The diff logic checks type instead of boolean.
- **PRD already flags this** in Q1 (§19) but doesn't provide a solution. This should be resolved before implementation, not deferred.

**Detection:** Query for items with `Submitted` status that have been in the subgraph for longer than `submissionPeriod` but still have no positive feedback.

**Phase:** Phase 1 (Router contract design). This must be resolved before deployment, not after.

---

### Pitfall 9: Subgraph Pagination Cursor Breaks on Reindexing

**What goes wrong:** The bot uses `id_gt` cursor-based pagination. During a subgraph reindexing event (Goldsky reindex, migration, version upgrade), item IDs may change format or ordering. The bot's cursor points to an ID that no longer exists in the new index. The query returns an empty result, and the bot concludes there are zero items. No actions are computed. If there were pending revocations or negative feedbacks, they're silently skipped.

**Why it happens:** Subgraph entity IDs are constructed by the subgraph mapping code (e.g., `<itemID>@<tcrAddress>`). A subgraph version upgrade could change this format. The bot has no way to detect that the subgraph was reindexed.

**Consequences:** Silent data loss. The bot reports "0 actions" and exits cleanly, even though there are items needing processing.

**Prevention:**
- After pagination completes, sanity-check the total item count against the subgraph's `Registry.numberOfSubmitted + Registry.numberOfAbsent + Registry.numberOfDisputed`. If the bot fetched significantly fewer items than the registry reports, log an error and do not execute any actions.
- Monitor item counts between runs. A sudden drop from 500 to 0 items is a signal, not legitimate.
- Pin to a specific subgraph version in the endpoint URL (Goldsky supports versioned endpoints). Don't auto-upgrade.

**Detection:** Compare fetched item count against registry-level counters.

**Phase:** Phase 1 (Bot core, subgraph polling).

---

### Pitfall 10: Proxy Upgrade Storage Collision in Router

**What goes wrong:** The Router is specified as upgradeable (proxy pattern). On upgrade, new state variables are added. If the developer inserts new variables between existing ones (instead of appending), storage slots shift, corrupting `hasFeedback`, `feedbackIndex`, and `pgtcrToAgentId` mappings.

**Why it happens:** Solidity storage layout is positional. Proxy patterns (UUPS, transparent proxy) require appending new state variables to the end of the storage layout. Developers unfamiliar with proxy patterns insert variables where they "logically belong."

**Consequences:** All feedback state is corrupted. `hasFeedback` returns wrong values. Revocations target wrong indices. Recovery requires manual storage repair or redeployment.

**Prevention:**
- Use OpenZeppelin's UUPS or TransparentProxy with `@openzeppelin/contracts-upgradeable`. These include storage gap patterns.
- Add `uint256[50] private __gap;` at the end of the contract. This reserves storage slots for future variables.
- Use Foundry's storage layout verification: `forge inspect KlerosReputationRouter storage-layout` before and after upgrades.
- Write an upgrade test that deploys V1, populates state, upgrades to V2, and verifies all V1 state is preserved.

**Detection:** Always diff storage layouts before deploying an upgrade. Automate this in CI.

**Phase:** Phase 1 (Router contract). The storage gap and proxy pattern must be in the initial deployment because retrofitting is difficult.

---

### Pitfall 11: ERC-8004 Interface Changes Break the Router

**What goes wrong:** ERC-8004 is a relatively new standard. The `ReputationRegistry` and `IdentityRegistry` interfaces may evolve. If `giveFeedback` adds a parameter, changes return types, or renames functions, the Router's hardcoded interface calls revert. Since the Router is the single bridge between Kleros and the reputation system, all feedback operations stop.

**Why it happens:** Building on a young standard. Interface stability is not guaranteed.

**Consequences:** Complete operational failure. No new feedback, no revocations, no negative feedback. The oracle goes silent.

**Prevention:**
- Pin to a specific ERC-8004 deployment address and interface version. The Router already stores the `reputationRegistry` address as mutable (owner can change it).
- Use `try/catch` in Solidity for external calls to the ReputationRegistry. On failure, emit an error event instead of reverting. This way the Router transaction succeeds and can be debugged, rather than silently failing.
- Keep the Router's interface abstraction thin: one `IReputationRegistry` interface file, clearly version-tagged.
- Monitor the 8004 ecosystem for breaking changes. Subscribe to the EIP discussion thread and contract repo.

**Detection:** Monitor Router transactions for reverts. Any revert on `giveFeedback` or `revokeFeedback` is a potential interface breakage.

**Phase:** Phase 1 (Router contract). The interface file should be locked to a specific version at deployment time.

---

## Minor Pitfalls

### Pitfall 12: CAIP-10 Chain Validation Rejects Valid Items

**What goes wrong:** The bot validates `metadata.key2` against the expected chain ID using CAIP-10 format (`eip155:<CHAIN_ID>:<address>`). But the PGTCR list may use a slightly different format (lowercase/uppercase address, with or without `eip155:` prefix, chain ID as decimal vs hex). Valid items are rejected by overly strict validation.

**Prevention:**
- Normalize both the expected format and the input before comparing: lowercase hex, strip leading zeros, ensure `eip155:` prefix.
- Log rejected items with the raw value so operators can investigate format mismatches.
- Test with real subgraph data from Sepolia before hardcoding the validation regex.

**Phase:** Phase 1 (Bot core, validation layer).

---

### Pitfall 13: Missing `Reincluded` Handling After Appeal

**What goes wrong:** An item goes from `Submitted` -> `Disputed` -> `Reincluded` (submitter wins appeal). The bot already gave positive feedback during `Submitted`. When the item becomes `Reincluded`, the diff sees "Reincluded + has feedback = true" which falls through with no action. This is correct. But if for some reason the positive feedback was revoked during the dispute (e.g., manual admin intervention, or a bug in a prior run), the diff would see "Reincluded + has feedback = false" and correctly re-issue positive feedback via Scenario 1. **This works.** But the edge case to watch: if `Reincluded` items have a different challenge history (the latest challenge has `disputeOutcome = Accept`), and future logic changes check the latest challenge outcome, the wrong branch might fire.

**Prevention:**
- Keep the diff logic simple: check `status` and `hasFeedback`. Don't add challenge-history checks to Scenario 1. The challenge history is only relevant for Scenario 2 (determining dispute vs. voluntary removal).
- Test the `Submitted -> Disputed -> Reincluded` lifecycle explicitly.

**Phase:** Phase 1 (Bot core, diff logic testing).

---

### Pitfall 14: Bot Wallet Key Compromise Has No Circuit Breaker

**What goes wrong:** The bot wallet's private key is leaked. An attacker calls Router functions via the authorized bot address, submitting arbitrary positive or negative feedback. Since the Router trusts any authorized bot, there's no rate limiting, no anomaly detection, and no way to pause operations without the owner (multisig) executing `setAuthorizedBot(compromisedAddress, false)`.

**Prevention:**
- **Operational:** Use a dedicated hot wallet with minimal ETH. Monitor the wallet's transaction history for unexpected calls.
- **Contract-level:** Consider adding a `pause()` function (OpenZeppelin Pausable) that any authorized bot can trigger. This gives the bot operator a self-destruct button.
- **Detection:** Set up an alert on the bot wallet address for any transaction not initiated by the expected bot process (wrong gas price, unexpected timing, unknown function selector).
- **Key rotation:** The Router's `setAuthorizedBot` supports adding a new bot and removing the old one. Document the key rotation procedure.

**Phase:** Phase 2 (Production hardening). Not critical for Sepolia PoC.

---

### Pitfall 15: Goldsky Endpoint Rate Limiting or Deprecation

**What goes wrong:** The Goldsky public endpoint is rate-limited or deprecated. The bot fails to fetch subgraph data and exits with an error. If the error handling is too aggressive (e.g., `process.exit(1)` on any fetch failure), the scheduler retries immediately, hitting the rate limit harder.

**Prevention:**
- Use exponential backoff on subgraph fetch retries (max 3 retries, then exit).
- Support configurable subgraph endpoint URLs (already in the design). Document how to switch to a self-hosted subgraph if Goldsky becomes unavailable.
- Use the private Goldsky endpoint (with API token) for higher rate limits.
- Log the specific error (rate limit vs. timeout vs. server error) to differentiate between transient and permanent failures.

**Phase:** Phase 1 (Bot core, subgraph polling).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Router contract design | Pitfall 3 (non-atomic revoke+negative), Pitfall 4 (feedbackIndex desync), Pitfall 8 (re-registration), Pitfall 10 (storage collision) | Resolve re-registration edge case in Router design before coding. Add storage gaps. Make `submitNegativeFeedback` handle both has/no-has cases. |
| Bot diff logic | Pitfall 1 (subgraph lag), Pitfall 5 (Disputed state), Pitfall 8 (re-registration skip) | Add `_meta` block height check. Handle the case where agent has negative feedback but item is Submitted. |
| Bot transaction execution | Pitfall 2 (nonce collision), Pitfall 6 (IPFS blocking) | Explicit nonce management. Separate prepare phase from execute phase. Stop run on tx ambiguity. |
| Subgraph integration | Pitfall 9 (pagination cursor), Pitfall 15 (rate limiting) | Sanity-check item counts. Use versioned endpoints. Exponential backoff. |
| Proxy upgrades | Pitfall 10 (storage collision), Pitfall 11 (ERC-8004 changes) | Storage gaps, layout diffing in CI, interface version pinning. |
| Production deployment | Pitfall 14 (key compromise) | Pausable contract, monitoring, key rotation docs. |

---

## Sources

- PRD v2: `.planning/research/kleros-reputation-oracle-prd-v2.md` (sections 6, 7, 8, 11, 12, 19)
- PRD Amendments: `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md`
- PGTCR Skill: `.claude/skills/pgtcr-stake-curate-skill.md`
- CLAUDE.md project instructions
- Training data knowledge of: Ethereum nonce management, subgraph indexing behavior, UUPS/TransparentProxy patterns, IPFS pinning reliability, Multicall3 usage patterns

**Confidence note:** Pitfalls 1-4, 6-7, 9-10 are HIGH confidence (well-known patterns in oracle/subgraph/proxy domains). Pitfalls 5, 8, 11 are MEDIUM confidence (specific to this project's edge cases, derived from PRD analysis). Pitfalls 12-15 are MEDIUM confidence (operational concerns, context-dependent severity).
