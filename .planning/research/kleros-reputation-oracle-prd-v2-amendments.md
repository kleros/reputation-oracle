---
date: 2026-03-24
updated: 2026-03-24
version: "2.1.1"
topic: "Kleros Reputation Oracle — PRD v2 Amendments from PoC Review"
tags: [kleros, erc-8004, reputation, pgtcr, oracle, bot, amendments, poc]
status: complete
supersedes: []
sources: [kleros-reputation-oracle-prd-v2.md]
synthesized_into: []
---

# PRD Amendments — Lessons from PoC Experiment

Date: 2026-03-24
Applies to: `.planning/research/kleros-reputation-oracle-prd-v2.md`

These amendments are derived from reviewing a vibe-coded PoC against the PRD. They address gaps that led to architectural misalignment, over-engineering, and safety issues.

---

## Amendment 1: Add §12.1.1 — Bot Design Principles

Insert after §12.1 Overview.

> ### 12.1.1 Design Principles
>
> **The bot is a stateless diff engine.** It has no local database, no persistent state, no checkpoint files. Each run:
> 1. Reads current PGTCR state from the subgraph (source of truth for curation)
> 2. Reads current feedback state from the Router contract (source of truth for reputation)
> 3. Computes the diff between the two
> 4. Executes the minimum set of Router calls to reconcile them
> 5. Exits
>
> If a run fails halfway, the next run re-diffs and picks up naturally. Idempotency comes from the architecture, not from tracking what was already done.
>
> **The bot does not decide feedback parameters.** Values (±95), decimals (0), and tags (`curate-verified`, `curate-removed`, `kleros-agent-registry`) are constants hardcoded in the Router contract. The bot's only decisions are: which agents need action, and which Router function to call.
>
> **The bot calls the Router, never the ReputationRegistry directly.** The Router is the `clientAddress` that consumers trust. If the bot calls `ReputationRegistry.giveFeedback()` directly, the bot's EOA becomes the `clientAddress` — orphaning all reputation if the wallet changes, and requiring consumers to trust a random address instead of a verifiable contract.

## Amendment 2: Add §12.1.2 — Anti-Requirements

Insert after the new §12.1.1.

> ### 12.1.2 What the Bot Does NOT Do
>
> These are explicit non-requirements. Do not implement them.
>
> - **No local database or persistence.** No SQLite, no files, no checkpoints. State lives on-chain (Router) and off-chain (subgraph). If you feel the need for local state, the architecture is wrong.
> - **No eligibility engine or age thresholds.** Item is Submitted/Reincluded on the PGTCR → positive feedback. Item is Absent → negative or revoke. There is no minimum age, no waiting period, no cooldown. **Why:** The PermanentGTCR contract already enforces a `submissionPeriod` — a built-in window during which an item can be challenged before it's considered accepted. If the subgraph reports an item as `Submitted` or `Reincluded`, the PGTCR has already validated durability. Adding a second delay in the bot (e.g. `MIN_AGE_HOURS`) duplicates a guarantee the protocol already provides and delays reputation signals unnecessarily.
> - **No configurable feedback values or template rendering.** Feedback parameters are protocol constants defined in the Router contract. The bot does not need env vars for `FEEDBACK_VALUE`, `FEEDBACK_TAG1`, etc.
> - **No multi-chain routing within a single process.** One deployment unit per chain. Chain selection is a deployment concern (env vars: `RPC_URL`, `CHAIN_ID`), not application logic. Do not build per-chain config overlays or suffix-based env var resolution.
> - **No daemon mode or long-running polling loop.** The bot runs once and exits. Scheduling is handled by the external environment (systemd timer, cron, launchd, Kubernetes CronJob).

## Amendment 3: Revise §12.7 — Main Loop → One-Shot Run

Replace the `while(true)` loop in §12.7 with:

> ### 12.7 Main Entry Point
>
> The bot is a one-shot worker. External schedulers (systemd timer, cron, launchd) invoke it at the desired frequency (recommended: hourly).
>
> ```typescript
> async function main() {
>   const config = loadConfig();
>   const poller = new SubgraphPoller(config);
>   const router = new RouterCaller(config);
>   const ipfs = new IPFSUploader(config);
>
>   // 1. Preflight
>   const balance = await router.getWalletBalance();
>   if (balance < MIN_BALANCE_WEI) {
>     console.error(`Wallet balance too low: ${balance}. Exiting.`);
>     process.exit(1);
>   }
>
>   // 2. Read current state from both sources
>   const pgtcrItems = await poller.fetchAllItems();
>   const routerState = await router.fetchFeedbackState(pgtcrItems);
>
>   // 3. Compute diff → actions
>   const actions = computeActions(pgtcrItems, routerState);
>
>   // 4. Execute actions
>   for (const action of actions) {
>     await executeAction(action, router, ipfs, config);
>   }
>
>   console.log(`Run complete. ${actions.length} actions executed.`);
> }
>
> main().catch((err) => {
>   console.error('Fatal error:', err);
>   process.exit(1);
> });
> ```
>
> **No `while(true)`. No `sleep()`.** The process exits after one pass.

## Amendment 4: Add §12.8 — Transaction Safety

Insert new section after §12.7.

> ### 12.8 Transaction Safety
>
> On-chain transactions have real cost (gas) and are irreversible. The bot must handle failure modes that don't exist in typical web services.
>
> **Never retry a transaction that may have been broadcast.**
> Gas estimation is retryable (it's a read). Transaction submission is not — if the RPC accepted the signed tx, it may be in the mempool even if the response was lost. Retrying submits a duplicate with a new nonce. Separate gas estimation (with retry) from tx submission (no retry, or retry only after confirming the tx was not broadcast).
>
> **Handle dropped and replaced transactions.**
> In ethers v6, `tx.wait()` returns `null` if the transaction was dropped or replaced. In viem, `waitForTransactionReceipt` throws `TransactionNotFoundError`. Do not assume the receipt exists. If the tx was dropped, log the tx hash for operator investigation. The next run will re-diff and detect whether the action landed.
>
> **Check wallet balance before sending.**
> Before the send loop, query the bot wallet's ETH balance. If below a configurable threshold (default: 0.01 ETH), log an error and exit without attempting transactions. Failing fast saves time and produces a clear signal for operators.
>
> **Graceful shutdown on signals.**
> Handle `SIGTERM` and `SIGINT`. Set a shutdown flag. Between batch items, check the flag and stop processing. Let the current transaction complete (or time out) before exiting. The stateless model means the next run picks up any remaining work.
>
> **The Router contract is the last line of defense.**
> `submitPositiveFeedback` reverts if `hasFeedback[agentId]` is already true. This prevents duplicate positive feedback even if the bot has a bug. But duplicate revocations or negative submissions are not guarded — the bot must handle these correctly.

## Amendment 5: Revise §12.4 — Subgraph Polling Strategy

Add pagination guidance and expand query scope.

> **Pagination:** Use cursor-based pagination with `id_gt` (query items where `id > lastSeenId`, ordered by `id asc`). Do NOT use `skip`-based pagination — The Graph Protocol degrades above 5000 skip and may silently truncate results above 10000.
>
> **Query scope:** Fetch ALL items from the registry, not just active ones. The bot needs Absent items to detect dispute removals (Scenario 2) and voluntary withdrawals (Scenario 3). Include challenge data for dispute detection:
>
> ```graphql
> query GetRegistryItems($registry: String!, $lastId: ID!) {
>   items(
>     where: { registryAddress: $registry, id_gt: $lastId }
>     orderBy: id
>     orderDirection: asc
>     first: 1000
>   ) {
>     id
>     itemID
>     status
>     data
>     metadata { key0 key1 key2 key3 key4 keywords }
>     submitter
>     includedAt
>     withdrawingTimestamp
>     challenges(orderBy: challengeID, orderDirection: desc, first: 1) {
>       challengeID
>       disputeID
>       disputeOutcome
>     }
>   }
> }
> ```

## Amendment 6: Revise §12.4 — Diff Logic

Replace the `LocalState`-based polling with stateless diff.

> **Diff computation:** Each run computes actions by comparing subgraph state against Router state. No local state needed.
>
> ```typescript
> function computeActions(
>   pgtcrItems: SubgraphItem[],
>   routerState: Map<bigint, { hasFeedback: boolean }>
> ): Action[] {
>   const actions: Action[] = [];
>
>   for (const item of pgtcrItems) {
>     const agentId = resolveAgentId(item);
>     if (!agentId) continue;
>
>     const has = routerState.get(agentId)?.hasFeedback ?? false;
>
>     if (
>       (item.status === 'Submitted' || item.status === 'Reincluded') &&
>       !has
>     ) {
>       // Scenario 1: active on PGTCR, no feedback yet
>       actions.push({ type: 'positive', agentId, item });
>     } else if (item.status === 'Absent' && has) {
>       const lastChallenge = item.challenges?.[0];
>       if (lastChallenge?.disputeOutcome === 'Reject') {
>         // Scenario 2: removed by dispute
>         actions.push({ type: 'negative', agentId, item, challenge: lastChallenge });
>       } else {
>         // Scenario 3: voluntary withdrawal
>         actions.push({ type: 'revoke', agentId, item });
>       }
>     }
>   }
>
>   return actions;
> }
> ```
>
> Note: `routerState` is populated by batched `Router.hasFeedback()` calls via Multicall3 for efficiency at scale.

## Amendment 7: Add §12.9 — Subgraph Data Validation

Insert after §12.8.

> ### 12.9 Subgraph Data Validation
>
> The subgraph is an external dependency. Its responses must be validated before the bot acts on them.
>
> **Required validations:**
> - `itemID` is a valid bytes32 hex string
> - `metadata.key0` (or the field used for agent resolution) passes the expected format for the resolution strategy in use
> - `metadata.key2` (if CAIP-10) matches the expected chain ID (`eip155:<CHAIN_ID>:...`)
> - `status` is one of the known enum values (`Submitted`, `Reincluded`, `Absent`, `Disputed`)
> - `challenges[0].disputeOutcome` is a known value when present
>
> Items that fail validation should be logged and skipped, not crash the run.

## Amendment 8: Add §12.3.1 — Config Constraints

Insert after §12.3 Configuration.

> ### 12.3.1 Configuration Constraints
>
> - `CHAIN_ID` is **required**, no default. A missing chain ID must fail at startup, not silently default to a testnet.
> - `RPC_URL` is the env var name for the RPC endpoint. Do not name it after a specific network (e.g., `SEPOLIA_RPC`).
> - Validate `BOT_PRIVATE_KEY` format separately from other config, and **redact it from any error output.** If Zod (or similar) validation fails, the error message must not contain the key value.
> - Config validation should happen at startup before any network calls. Fail fast on misconfiguration.

## Amendment 9: Revise §12.2 — Scale Consideration

Add to §12.2 Technology table or as a note.

> **Multicall3 batching:** For reading Router state across many agents, use Multicall3 (deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on all major chains) to batch `hasFeedback()` and `resolveAgent()` view calls. This reduces thousands of individual `eth_call`s to ~50-100 batched calls, making the stateless model viable at 10k+ agents.

## Amendment 10: Add §16.1 — Testing Strategy Guidance

The PoC's test suite reveals patterns the PRD should guide against. Insert as §16.1 in the Testing Plan.

### What the PoC tests look like

- **414 test cases** across 13 files, split into unit/integration/e2e.
- The most-tested module is `GoldskyItemsMapper` (154 match lines) — the subgraph validation layer. This is the right thing to test heavily.
- The **orchestrator unit test** mocks every dependency (store, goldsky, eligibility, feedback, wallet, metrics — 64 mock setup lines for 3 test cases). It tests that mocks are called in the right order. It does not test any real behavior.
- The **feedback unit test** mocks ethers.Contract entirely — `giveFeedback` returns a pre-built object with a `wait()` that returns a pre-built receipt. The critical bugs (retry wrapping tx submission, null receipt) are invisible because the mock never exhibits those behaviors.
- The **e2e test** runs the full orchestrator in DRY_RUN mode with mocked Goldsky responses and a real SQLite DB. It verifies DB state after a run. It never exercises a real contract call — not even against a local hardhat node.
- **No test verifies the ABI matches the actual deployed contract.** The feedback sender constructs an ethers.Contract with a hardcoded ABI array. If the ABI is wrong, every unit test still passes because the contract is mocked.

### The core problem

The tests mock at the wrong layer. They mock the thing they should be testing (contract interactions, transaction lifecycle) and test the thing that doesn't need testing (mock call ordering). This is a common pattern in AI-generated test suites — they achieve high test counts and pass rates while providing minimal safety.

### What the PRD should specify

> ### 16.1 Testing Strategy
>
> **Principle: Test the boundaries, not the wiring.**
>
> The bot has two external boundaries that can break in production:
> 1. **Subgraph responses** — shape may change, pagination may break, data may be invalid
> 2. **Contract interactions** — ABI mismatch, transaction failures, gas estimation, receipt handling
>
> Tests should exercise these boundaries against real (or realistically simulated) implementations, not mocks.
>
> **Required test categories:**
>
> | Category | What to test | How |
> |---|---|---|
> | **Subgraph validation** | Malformed responses, missing fields, wrong chain ID, invalid CAIP-10, bytes32 overflow | Unit tests with crafted payloads. Mock the HTTP layer, not the validation logic. |
> | **Contract ABI verification** | ABI matches deployed contract | Integration test: instantiate the contract against a fork or local node, call a view function. If it doesn't revert, the ABI is correct. |
> | **Diff logic** | Given subgraph state X and Router state Y, correct actions are computed | Pure function unit tests. No mocks needed — `computeActions()` takes data in, returns actions out. |
> | **Transaction lifecycle** | Dropped tx, null receipt, gas estimation failure, revert | Integration test against a local hardhat/anvil node. Simulate failure modes. |
> | **Config validation** | Missing required fields, invalid formats, secret redaction | Unit tests on the Zod schema. |
>
> **What NOT to test:**
> - Mock call ordering ("store.upsert was called before feedback.send"). This tests implementation details, not behavior. If the orchestration changes, every test breaks even if the system still works.
> - DRY_RUN mode as a substitute for real transaction testing. DRY_RUN skips the exact code path that has bugs.
>
> **Forked integration tests (recommended for PoC):**
> Use `hardhat` or `anvil --fork-url <RPC_URL>` to fork Sepolia. Deploy the Router contract locally. Run the bot against the fork with real subgraph data. Verify on-chain state after the run. This catches ABI mismatches, gas issues, and transaction lifecycle bugs that unit tests with mocks cannot.
>
> **Test the diff, not the plumbing.** The stateless diff model (`computeActions`) is a pure function: subgraph items + Router state → action list. This is trivially testable without mocks and is where the business logic lives. Most test effort should go here.

---

## Summary of Changes

| # | Section | Change |
|---|---|---|
| A1 | §12.1.1 (new) | Bot design principles: stateless, no direct ReputationRegistry calls |
| A2 | §12.1.2 (new) | Anti-requirements: no DB, no eligibility engine, no templates, no daemon |
| A3 | §12.7 | Replace polling loop with one-shot entry point |
| A4 | §12.8 (new) | Transaction safety: retry rules, null receipts, balance check, shutdown |
| A5 | §12.4 | Cursor-based pagination, expanded query scope (all items + challenges) |
| A6 | §12.4 | Stateless diff logic replacing LocalState |
| A7 | §12.9 (new) | Subgraph data validation requirements |
| A8 | §12.3.1 (new) | Config constraints: required CHAIN_ID, RPC_URL naming, key redaction |
| A9 | §12.2 | Multicall3 for batched on-chain reads at scale |
| A10 | §16.1 (new) | Testing strategy: test boundaries not wiring, forked integration tests, no mock-ordering tests |
