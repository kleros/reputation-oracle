---
date: 2026-03-13
updated: 2026-03-13
version: "2.0"
topic: "Kleros Reputation Oracle for ERC-8004 — Product Requirements Document v2"
tags: [kleros, erc-8004, reputation, pgtcr, oracle, solidity, sepolia, poc]
status: complete
supersedes: kleros-reputation-oracle-prd.md
sources: []
synthesized_into: []
---

# Kleros Reputation Oracle for ERC-8004

## Product Requirements Document (PRD) — v2

**Version:** 2.0
**Author:** Blaise (AI Agent) for JayBuidl / Kleros
**Date:** 2026-03-13
**Supersedes:** v1.0 (kleros-reputation-oracle-prd.md)
**Target:** Proof-of-Concept on **Ethereum Sepolia** (chainId 11155111)
**Audience:** Developer or coding agent building the system from scratch

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview](#2-solution-overview)
3. [Architecture](#3-architecture)
4. [ERC-8004 Technical Reference](#4-erc-8004-technical-reference)
5. [Deployed Contract Addresses](#5-deployed-contract-addresses)
6. [PGTCR to 8004 Mapping Logic](#6-pgtcr-to-8004-mapping-logic)
7. [PermanentGTCR Contract Reference](#7-permanentgtcr-contract-reference)
8. [PGTCR Subgraph Schema](#8-pgtcr-subgraph-schema)
9. [Curation Policy](#9-curation-policy)
10. [PGTCR vs Light Curate](#10-pgtcr-vs-light-curate)
11. [KlerosReputationRouter Contract Specification](#11-klerosreputationrouter-contract-specification)
12. [Off-Chain Bot Specification](#12-off-chain-bot-specification)
13. [IPFS Evidence Schema](#13-ipfs-evidence-schema)
14. [Kleros 8004 Identity Setup](#14-kleros-8004-identity-setup)
15. [DEX-8004 Integration](#15-dex-8004-integration)
16. [Testing Plan](#16-testing-plan)
17. [File Structure](#17-file-structure)
18. [Tech Stack](#18-tech-stack)
19. [Open Design Questions](#19-open-design-questions)
20. [Success Criteria](#20-success-criteria)
21. [Appendix A: getSummary Math](#appendix-a-getsummary-math)
22. [Appendix B: Reputation Arithmetic Walkthrough](#appendix-b-reputation-arithmetic-walkthrough)
23. [Appendix C: Value Encoding Rationale](#appendix-c-value-encoding-rationale)

---

## 1. Problem Statement

### 1.1 The ERC-8004 Reputation Gap

[ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004) defines an on-chain identity and reputation system for autonomous agents. It provides two core registries:

- **IdentityRegistry** — agents register themselves with metadata (name, services, endpoints).
- **ReputationRegistry** — anyone can submit reputation feedback about any agent.

The reputation system has a critical design flaw — **not a bug, but a deliberate architectural choice** that requires ecosystem participants to solve:

> **Anyone can call `giveFeedback()`.** There is no access control on who can submit reputation signals.

This means:
- **Spam:** A bot can flood any agent with fake positive or negative feedback.
- **Sybil attacks:** One entity can create many `clientAddress` identities and submit coordinated feedback.
- **No inherent quality signal:** A feedback entry from a random wallet is indistinguishable from one backed by economic stake.

### 1.2 The Trust Delegation Model

ERC-8004 addresses this intentionally through `getSummary()`:

```solidity
function getSummary(
    uint256 agentId,
    address[] calldata clientAddresses,  // <-- THE KEY PARAMETER
    string calldata tag1,
    string calldata tag2
) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
```

Consumers **must specify which `clientAddresses` they trust**. The system doesn't decide who is trustworthy — the caller does. This is analogous to choosing which certificate authorities your browser trusts.

**The problem:** There are no high-quality reputation providers yet. No `clientAddress` has earned the right to be trusted. The ecosystem needs its first credible oracle.

### 1.3 Why Kleros PGTCR

Kleros's PermanentGTCR (Permanent Generalized Token Curated Registry) provides exactly the economic security model needed:

| Property | PGTCR (Permanent) | Light Curate | Typical Oracle |
|---|---|---|---|
| Stake model | **Continuously locked** until voluntary withdrawal | Returned after optimistic period | None or one-time |
| Challenge window | **Any time** (permanent) | Fixed registration period only | N/A |
| Dispute resolution | Kleros court (human jurors, game-theoretic incentives) | Kleros court | Varies |
| Economic security | Stake slashed if challenged + lost | Stake slashed during window | Varies |

PGTCR items are **continuously collateralized**. A registered agent has WETH locked as a bond that can be challenged at any moment. This means:
- Registering on a Kleros PGTCR is a **credible commitment** (money at risk).
- Being removed via dispute is a **strong negative signal** (jurors ruled against you).
- Voluntarily withdrawing is **neutral** (you stopped committing, but weren't condemned).

These three state transitions map perfectly to ERC-8004 reputation signals.

---

## 2. Solution Overview

Build a **Kleros Reputation Oracle** that converts PGTCR curation events into ERC-8004 reputation feedback. When an agent is verified on a Kleros PGTCR, they receive positive reputation. When removed by dispute, they receive negative reputation. When they voluntarily withdraw, the positive reputation is revoked (neutral).

### Value Encoding

Feedback values use a 0–100 scale aligned with the curation policy's scoring convention:

| Event | value | valueDecimals | tag1 | tag2 | Meaning |
|---|---|---|---|---|---|
| Accepted on PGTCR | **95** | 0 | `curate-verified` | `kleros-agent-registry` | Passed full human verification |
| Challenged + removed | **-95** | 0 | `curate-removed` | `kleros-agent-registry` | Failed verification / misbehavior |
| Voluntary withdrawal | *(revoke only)* | — | — | — | No longer verified |

**Why 95?** Using 95 (not 100) because 100 implies perfection; 95 = "very high confidence, human-verified." This value is directly composable with other ERC-8004 `starred` tag feedback on the 0–100 scale. See [Appendix C](#appendix-c-value-encoding-rationale) for full rationale.

**Value proposition for the ecosystem:**
- First economically-secured reputation provider for ERC-8004
- Consumers can pass the Router's address to `getSummary()` to get Kleros-backed reputation
- Reputation backed by real economic stake (WETH bonds) and human jury rulings
- Composable — other protocols can trust Kleros reputation alongside their own signals

---

## 3. Architecture

The system has three components:

```
┌──────────────────────────────────────────────────────────────────┐
│                        ETHEREUM SEPOLIA                          │
│                                                                  │
│  ┌─────────────┐  subgraph   ┌─────────────┐                   │
│  │  Kleros     │ ──────────► │  Off-Chain   │                   │
│  │  PGTCR      │   (GraphQL) │  Bot (TS)    │                   │
│  │  Contract   │             │              │                   │
│  │  0x3162...  │             └──────┬───────┘                   │
│  └─────────────┘                    │                           │
│                                     │ tx calls                  │
│                                     ▼                           │
│                             ┌───────────────┐                   │
│                             │  Kleros       │                   │
│                             │  Reputation   │                   │
│                             │  Router.sol   │                   │
│                             │               │                   │
│                             │ (clientAddr)  │                   │
│                             └───────┬───────┘                   │
│                                     │                           │
│                         giveFeedback│/ revokeFeedback           │
│                                     ▼                           │
│  ┌─────────────┐            ┌───────────────┐                   │
│  │  8004       │            │  8004         │                   │
│  │  Identity   │            │  Reputation   │                   │
│  │  Registry   │            │  Registry     │                   │
│  │  0x8004A..  │            │  0x8004B..    │                   │
│  └─────────────┘            └───────────────┘                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

                       ┌─────────────┐
                       │   IPFS      │
                       │  (Pinata /  │
                       │  web3.stor) │
                       └─────────────┘
                        ▲
                        │ pin evidence JSON
                        │
                  ┌─────┴───────┐
                  │  Off-Chain   │
                  │  Bot (TS)    │
                  └─────────────┘
```

### 3.1 Component Summary

| Component | Type | Role |
|---|---|---|
| **KlerosReputationRouter.sol** | On-chain (Solidity) | The `clientAddress` that calls `giveFeedback()` / `revokeFeedback()` on the 8004 ReputationRegistry. Owns the mapping of PGTCR items to agent IDs and tracks feedback indices for revocation. |
| **Kleros 8004 Identity** | On-chain (one-time setup) | Kleros registered as an agent on the 8004 IdentityRegistry with metadata describing the oracle service. |
| **Bot** | Off-chain (TypeScript) | Polls PGTCR subgraph for item status changes, resolves PGTCR items to 8004 agentIds, creates IPFS evidence, and calls the Router contract. |

---

## 4. ERC-8004 Technical Reference

### 4.1 ReputationRegistry Interface (Complete)

The following is the complete interface for the ERC-8004 ReputationRegistry as deployed. The Router contract will interact with all write functions.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReputationRegistry {
    // ══════════════════════════════════════════════════════════
    // WRITE FUNCTIONS
    // ══════════════════════════════════════════════════════════

    /// @notice Submit reputation feedback for an agent.
    /// @dev Reverts if msg.sender is the agent's owner or an approved operator (no self-feedback).
    /// @param agentId The 8004 agent ID to give feedback about.
    /// @param value Signed reputation value. Positive = good, negative = bad.
    /// @param valueDecimals Decimal precision of the value (0-18).
    /// @param tag1 Free-form string tag for categorization/filtering.
    /// @param tag2 Free-form string tag for categorization/filtering.
    /// @param endpoint Service endpoint this feedback relates to (can be empty).
    /// @param feedbackURI Off-chain URI (typically IPFS) pointing to detailed evidence.
    /// @param feedbackHash Hash of the off-chain content. Use bytes32(0) when feedbackURI is IPFS (content-addressed).
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    /// @notice Revoke previously submitted feedback. Only the original submitter (msg.sender == clientAddress) can revoke.
    /// @param agentId The 8004 agent ID.
    /// @param feedbackIndex The index of the feedback entry to revoke.
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    /// @notice Append a response to existing feedback. Anyone can respond (e.g., for spam tagging or rebuttal).
    /// @param agentId The 8004 agent ID.
    /// @param clientAddress The address that originally submitted the feedback.
    /// @param feedbackIndex The index of the feedback entry to respond to.
    /// @param responseURI Off-chain URI pointing to the response content.
    /// @param responseHash Hash of the response content. Use bytes32(0) for IPFS URIs.
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external;

    // ══════════════════════════════════════════════════════════
    // READ FUNCTIONS
    // ══════════════════════════════════════════════════════════

    /// @notice Get aggregated reputation summary for an agent, filtered by trusted client addresses and tags.
    /// @dev Returns arithmetic average of non-revoked feedback, normalized to WAD (18 decimals) internally.
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (
        uint64 count,
        int128 summaryValue,
        uint8 summaryValueDecimals
    );

    /// @notice Read a specific feedback entry.
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        bool isRevoked
    );

    /// @notice Get all client addresses that have submitted feedback for an agent.
    function getClients(uint256 agentId) external view returns (address[] memory);

    /// @notice Get the last feedback index for a given agent + client pair.
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}
```

### 4.2 IdentityRegistry Interface (Relevant Subset)

```solidity
interface IIdentityRegistry {
    /// @notice Register a new agent. Returns the assigned agentId.
    function register(string calldata agentURI) external returns (uint256 agentId);

    /// @notice Get the owner of an agent.
    function ownerOf(uint256 agentId) external view returns (address);
}
```

### 4.3 Key Constraints & Behaviors

1. **No self-feedback:** `giveFeedback()` reverts if `msg.sender` is the agent's owner or an approved operator on the IdentityRegistry. This means the Router contract **must not** be the owner/operator of any agent it gives feedback about.

2. **Feedback is append-only:** Each call to `giveFeedback()` creates a new entry at the next index. You cannot overwrite existing feedback — only revoke it.

3. **Revocation is permanent:** Once revoked, feedback is excluded from `getSummary()` calculations. You cannot un-revoke.

4. **Feedback index:** For a given `(agentId, clientAddress)` pair, feedback entries are indexed starting at 0 and incrementing. Use `getLastIndex()` to find the most recent.

5. **getSummary aggregation:** See [Appendix A](#appendix-a-getsummary-math) for the full math.

---

## 5. Deployed Contract Addresses

### 5.1 Ethereum Sepolia (Testnet — POC Target)

| Contract | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| **PermanentGTCR (PGTCR)** | `0x3162df9669affa8b6b6ff2147afa052249f00447` |

**Chain ID:** 11155111
**RPC:** `https://rpc.sepolia.org` (public) or Alchemy/Infura
**Block Explorer:** `https://sepolia.etherscan.io`

> **⚠️ Chain Clarification:** The POC targets **Ethereum Sepolia** (chainId 11155111), NOT Arbitrum Sepolia (chainId 421614). While ERC-8004 registries are deployed on both chains, the PGTCR instance and DEX-8004 are deployed on Ethereum Sepolia.

### 5.2 Arbitrum One (Mainnet — Future Production)

| Contract | Address |
|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

**Chain ID:** 42161

### 5.3 Other Chains (Future Expansion)

ERC-8004 registries are deployed via singleton factory (CREATE2) at identical addresses on:
- Base, Ethereum mainnet, Optimism, Polygon, and 20+ other chains.

For the POC, **only Ethereum Sepolia is in scope**.

---

## 6. PGTCR to 8004 Mapping Logic

The core business logic: converting PGTCR curation events into ERC-8004 reputation feedback. There are exactly **three scenarios**.

### 6.1 Scenario 1: Agent Verified on PGTCR (Item Submitted/Reincluded)

**Trigger:** A PGTCR item transitions to status `Submitted` (newly added) or `Reincluded` (survived a dispute).

In the PermanentGTCR:
- `Submitted` = Item was added via `addItem()`, stake locked, now challengeable.
- `Reincluded` = Item was challenged, went to Kleros court, and the **submitter won** the dispute. The challenger's stake is added to the item's stake.

**Bot Action:**
1. Resolve the PGTCR item to an 8004 `agentId` (see [Section 6.4](#64-pgtcr-item--8004-agent-resolution)).
2. Create IPFS evidence JSON (see [Section 13](#13-ipfs-evidence-schema)).
3. Call `Router.submitPositiveFeedback(agentId, pgtcrItemId, feedbackURI)`.

**On-Chain Effect (Router → ReputationRegistry):**
```
giveFeedback(agentId, 95, 0, "curate-verified", "kleros-agent-registry", "", "ipfs://Qm...", bytes32(0))
```

**Router State Update:**
- Stores the returned feedback index: `feedbackTracking[agentId] = getLastIndex(agentId, address(this))`
- Stores the PGTCR mapping: `pgtcrToAgentId[pgtcrItemId] = agentId`

**Reputation Effect:**
- `getSummary(agentId, [routerAddress], "", "")` → `count=1, summaryValue=95, summaryValueDecimals=0`

### 6.2 Scenario 2: Agent Challenged + Loses (Item Removed by Dispute)

**Trigger:** A PGTCR item transitions to status `Absent` **as a result of a Kleros dispute ruling in favor of the Challenger** (`Challenge.disputeOutcome = Reject`).

In the PermanentGTCR, `rule()` with `ruling = Party.Challenger` causes:
- `item.status` → `Absent`
- Challenger receives `item.stake + challenge.stake` (ERC-20 tokens)
- Challenger receives `item.arbitrationDeposit` (native ETH)

**Bot Action:**
1. Resolve the PGTCR item to an 8004 `agentId`.
2. Create IPFS evidence JSON with dispute details.
3. Call `Router.submitNegativeFeedback(agentId, feedbackURI)`.

**On-Chain Effect (Router → ReputationRegistry):**
```
// Step 1: Revoke the old positive feedback
revokeFeedback(agentId, storedFeedbackIndex)

// Step 2: Submit negative feedback
giveFeedback(agentId, -95, 0, "curate-removed", "kleros-agent-registry", "", "ipfs://Qm...", bytes32(0))
```

**Router State Update:**
- Updates `feedbackTracking[agentId]` to the new (negative) feedback index.

**Reputation Effect:**
- `getSummary(agentId, [routerAddress], "", "")` → `count=1, summaryValue=-95, summaryValueDecimals=0`

### 6.3 Scenario 3: Agent Voluntarily Withdraws Stake

**Trigger:** A PGTCR item transitions to status `Absent` **via voluntary withdrawal by the submitter** (no dispute involved). This uses `startWithdrawItem()` → wait `withdrawingPeriod` → `withdrawItem()`.

In the PermanentGTCR, `_doWithdrawItem()` causes:
- `item.status` → `Absent`
- Submitter receives `item.stake` (ERC-20 tokens) + `item.arbitrationDeposit` (native ETH)

**Bot Action:**
1. Resolve the PGTCR item to an 8004 `agentId`.
2. Call `Router.revokeOnly(agentId)`.

**On-Chain Effect (Router → ReputationRegistry):**
```
revokeFeedback(agentId, storedFeedbackIndex)
```

**No new feedback is submitted.** Voluntary withdrawal is a neutral act — the agent chose to stop committing stake, but wasn't condemned.

**Router State Update:**
- Clears `feedbackTracking[agentId]`.

**Reputation Effect:**
- `getSummary(agentId, [routerAddress], "", "")` → `count=0, summaryValue=0, summaryValueDecimals=0`

### 6.4 PGTCR Item → 8004 Agent Resolution

The bot needs to map a PGTCR item to an ERC-8004 `agentId`. Three strategies (in order of preference for the POC):

| Strategy | How | Pros | Cons |
|---|---|---|---|
| **A. Direct agentId in metadata** | PGTCR item's IPFS metadata includes a column with the 8004 agentId | Simplest, no lookups | Requires PGTCR schema to include agentId field |
| **B. Address lookup** | PGTCR metadata contains agent's wallet address; bot queries IdentityRegistry to find agentId | Works with existing PGTCR schemas | Requires on-chain lookup; agent may have multiple IDs |
| **C. Admin mapping** | Bot or admin manually calls `Router.setPGTCRMapping(itemId, agentId)` | Works without any metadata changes | Manual, doesn't scale |

**POC recommendation:** Start with **Strategy C** (admin mapping) for the demo. Implement **Strategy A** as the production path — design the PGTCR schema to include an `agentId` column.

**Note:** DEX-8004 already implements PGTCR↔8004 agent mapping logic — the bot should replicate the same approach. See [Section 15](#15-dex-8004-integration).

### 6.5 Why Revoke + Negative (Not Just Add Negative)?

This is a critical design decision that warrants explicit explanation:

**Without revoking first:**
```
Feedback entries: [+95, -95]
Average = (+95 + -95) / 2 = 0  → Looks NEUTRAL
```

**With revoking first, then negative:**
```
Feedback entries: [+95 (REVOKED), -95]
Non-revoked: [-95]
Average = -95 / 1 = -95  → Looks BAD (correct!)
```

An agent removed by Kleros dispute should have an unambiguously negative reputation, not a neutral one. The revoke-then-negative pattern achieves this.

---

## 7. PermanentGTCR Contract Reference

### 7.1 Overview

The PermanentGTCR (PGTCR) is Kleros's implementation of a curated registry with **permanently locked stakes**.

- **Authors:** @greenlucid
- **Reviewers:** @fcanela, @jaybuidl, @mani99brar
- **Solidity:** ^0.8.30
- **License:** MIT
- **Deployed (Sepolia):** `0x3162df9669affa8b6b6ff2147afa052249f00447`

Unlike Light Curate (where stake is returned after an optimistic period), PGTCR items are **continuously collateralized** — the submitter's deposit backs their claim at all times until voluntary withdrawal.

### 7.2 Statuses (Enum)

```solidity
enum Status {
    Absent,      // 0: Not in registry (never submitted, withdrawn, or removed)
    Submitted,   // 1: Included, challengeable, valid after submissionPeriod
    Reincluded,  // 2: Included via dispute win, valid after reinclusionPeriod
    Disputed     // 3: Currently in a Kleros dispute
}
```

### 7.3 Parties (Enum)

```solidity
enum Party {
    None,        // 0: Default / refuse to arbitrate
    Submitter,   // 1: Party that submitted the item
    Challenger   // 2: Party that challenges the item
}
```

### 7.4 Item Struct

```solidity
struct Item {
    Status status;               // Current status
    uint128 arbitrationDeposit;  // ETH deposit for juror fees (recorded per item)
    uint120 challengeCount;      // Total challenges (persists across re-submissions)
    address payable submitter;   // Submitter address, receives stake on withdrawal
    uint48 includedAt;           // Timestamp of last submission or reinclusion
    uint48 withdrawingTimestamp; // Timestamp when withdrawal was initiated (0 = not withdrawing)
    uint256 stake;               // WETH stake, awarded to challenger or returned on withdrawal
}
```

### 7.5 Challenge Struct

```solidity
struct Challenge {
    uint80 arbitrationParamsIndex;  // Index for arbitration params
    Party ruling;                   // Dispute ruling (set after resolution)
    uint8 roundCount;               // Number of appeal rounds
    address payable challenger;     // Challenger address
    uint256 stake;                  // Challenger's ERC-20 stake
    uint256 disputeID;              // Kleros dispute ID
}
```

### 7.6 Key Functions

#### `addItem(string _item, uint256 _deposit)` — Submit an Item

```solidity
function addItem(string calldata _item, uint256 _deposit) external payable;
```

- Accepts WETH deposit (≥ `submissionMinDeposit`) + ETH for arbitration cost
- Item ID = `keccak256(abi.encodePacked(_item))`
- Sets status to `Submitted`, locks stake
- Emits `NewItem` (first time) or `ItemStatusChange` (re-submission)
- Requires item to be `Absent`
- Refunds excess ETH above arbitration cost

#### `startWithdrawItem(bytes32 _itemID)` — Initiate Withdrawal

```solidity
function startWithdrawItem(bytes32 _itemID) external payable;
```

- Only callable by the item's `submitter`
- Can be called when `Submitted`, `Reincluded`, or even `Disputed`
- Sets `withdrawingTimestamp` to `block.timestamp`
- Emits `ItemStartsWithdrawing`
- **Does NOT immediately withdraw** — starts a countdown (`withdrawingPeriod`)

#### `withdrawItem(bytes32 _itemID)` — Execute Withdrawal

```solidity
function withdrawItem(bytes32 _itemID) external payable;
```

- Callable by anyone after `withdrawingPeriod` has elapsed
- Requires status `Submitted` or `Reincluded` (not `Absent` or `Disputed`)
- Returns `item.stake` (WETH) + `item.arbitrationDeposit` (ETH) to submitter
- Sets status to `Absent`
- Emits `ItemStatusChange`

#### `challengeItem(bytes32 _itemID, string _evidence)` — Challenge an Item

```solidity
function challengeItem(bytes32 _itemID, string calldata _evidence) external payable;
```

- Requires item to be `Submitted` or `Reincluded` (and not already canonically withdrawn)
- Challenger pays ERC-20 stake = `item.stake * challengeStakeMultiplier / MULTIPLIER_DIVISOR`
- Challenger pays ETH for arbitration cost
- Creates a Kleros dispute via `arbitrator.createDispute()`
- Sets status to `Disputed`
- Emits `Dispute`, `ItemStatusChange`, and optionally `Evidence`
- Uses arbitration params based on cooldown logic (settings frozen at withdrawal initiation if applicable)

#### `rule(uint256 _disputeID, uint256 _ruling)` — Arbitrator Callback

```solidity
function rule(uint256 _disputeID, uint256 _ruling) external;
```

- Only callable by the arbitrator
- Determines final ruling (may be overridden by appeal funding)
- **Three possible outcomes:**

| Ruling | Effect | Economic Outcome |
|---|---|---|
| `Party.None` (Refuse to Arbitrate) | Item → `Absent` | Arbitration deposit split 50/50. Each party gets their stake back. |
| `Party.Submitter` (Item valid) | Item → `Reincluded` | `item.stake += challenge.stake` (challenger loses stake to item). Submitter keeps item. If withdrawing, auto-withdraws. |
| `Party.Challenger` (Item invalid) | Item → `Absent` | Challenger gets `item.stake + challenge.stake` (WETH) + `item.arbitrationDeposit` (ETH). Item removed. |

#### `fundAppeal(bytes32 _itemID, Party _side)` — Appeal Funding

```solidity
function fundAppeal(bytes32 _itemID, Party _side) external payable;
```

- Crowdfund appeal for either side during appeal period
- If both sides fully funded, creates appeal round
- Losers must fund within first half of appeal period

#### `withdrawFeesAndRewards(...)` — Claim Appeal Rewards

```solidity
function withdrawFeesAndRewards(
    address payable _beneficiary,
    bytes32 _itemID,
    uint120 _challengeID,
    uint256 _roundID
) external;
```

- Distributes appeal contributions to winning side contributors

### 7.7 Key Events

```solidity
// New item added for the first time
event NewItem(bytes32 indexed _itemID, string _data);

// Item status change (submission, reinclusion, dispute, removal, withdrawal)
event ItemStatusChange(bytes32 indexed _itemID, Status _status);

// Withdrawal process initiated
event ItemStartsWithdrawing(bytes32 indexed _itemID);

// Dispute created (from IArbitrable)
event Dispute(
    IArbitrator indexed _arbitrator,
    uint256 indexed _disputeID,
    uint256 _metaEvidenceID,
    uint256 _evidenceGroupID
);

// Dispute ruling executed (from IArbitrable)
event Ruling(IArbitrator indexed _arbitrator, uint256 indexed _disputeID, uint256 _ruling);

// Evidence submitted (from IEvidence)
event Evidence(
    IArbitrator indexed _arbitrator,
    uint256 indexed _evidenceGroupID,
    address indexed _party,
    string _evidence
);

// Appeal contribution
event Contribution(
    bytes32 indexed _itemID,
    uint256 _challengeID,
    uint256 _roundID,
    address indexed _contributor,
    uint256 _contribution,
    Party _side
);

// Appeal rewards withdrawn
event RewardWithdrawn(
    address indexed _beneficiary,
    bytes32 indexed _itemID,
    uint256 _challenge,
    uint256 _round,
    uint256 _reward
);

// Settings updated by governor
event SettingsUpdated();
```

### 7.8 Key Configuration Parameters

| Parameter | Type | Description |
|---|---|---|
| `submissionMinDeposit` | `uint256` | Minimum WETH deposit to submit an item |
| `submissionPeriod` | `uint256` | Seconds until new item is considered valid (off-chain significance) |
| `reinclusionPeriod` | `uint256` | Seconds until reincluded item is considered valid (off-chain significance) |
| `withdrawingPeriod` | `uint256` | Seconds before withdrawal can be executed |
| `arbitrationParamsCooldown` | `uint256` | Seconds until new arbitration params apply to all items (immutable by governor) |
| `challengeStakeMultiplier` | `uint256` | Ratio of item.stake required as challenger deposit (basis points, divisor = 10000) |
| `winnerStakeMultiplier` | `uint256` | Appeal fee multiplier for previous round winner (basis points) |
| `loserStakeMultiplier` | `uint256` | Appeal fee multiplier for previous round loser (basis points) |
| `sharedStakeMultiplier` | `uint256` | Appeal fee multiplier when no winner/loser (basis points) |

### 7.9 Custom Errors

```solidity
error AlreadyInitialized();
error GovernorOnly();
error SubmitterOnly();
error ArbitratorOnly();
error ItemWrongStatus();
error BelowDeposit();
error TransferFailed();
error BelowArbitrationDeposit();
error ItemWithdrawingAlready();
error ItemWithdrawingNotYet();
error AppealNotRtA();
error AppealAlreadyFunded();
error AppealNotWithinPeriod();
error AppealLoserNotWithinPeriod();
error RewardsPendingDispute();
error RulingInvalidOption();
```

---

## 8. PGTCR Subgraph Schema

The bot consumes PGTCR data via a GraphQL subgraph. The subgraph endpoint is currently behind the DEX-8004 app API — **exact URL TBD** (colleague will provide).

### 8.1 Core Entities

#### Item

```graphql
type Item @entity(immutable: false) {
  id: ID!                          # <itemID>@<tcrAddress>
  itemID: Bytes!                   # keccak256 hash of the data
  data: String!                    # Link to IPFS metadata
  status: Status!                  # Absent | Submitted | Reincluded | Disputed
  submissions: [Submission!]!      # @derivedFrom(field: "item")
  numberOfSubmissions: BigInt!
  challenges: [Challenge!]!        # @derivedFrom(field: "item")
  numberOfChallenges: BigInt!
  evidences: [Evidence!]!          # @derivedFrom(field: "item")
  numberOfEvidences: BigInt!
  registry: Registry!
  registryAddress: Bytes!
  createdAt: BigInt!               # First submission timestamp
  includedAt: BigInt!              # Last submission or reinclusion timestamp
  withdrawingTimestamp: BigInt!     # 0 = not withdrawing
  submitter: Bytes!                # Current submitter address
  stake: BigInt!                   # Current WETH stake
  arbitrationDeposit: BigInt!      # Current ETH deposit
  metadata: ItemMetadata
}
```

#### Challenge

```graphql
type Challenge @entity(immutable: false) {
  id: ID!                          # <itemID>@<tcrAddress>-<challengeId>
  item: Item!
  challengeID: BigInt!             # Sequential challenge index (starts at 0)
  disputeID: BigInt!               # Kleros dispute ID
  createdAt: BigInt!
  creationTx: Bytes!
  submission: Submission!          # Submission at time of challenge
  challenger: Bytes!               # Challenger address
  arbitrationSetting: ArbitrationSetting!
  itemStake: BigInt!               # Submitter's ERC-20 stake at risk
  challengerStake: BigInt!         # Challenger's ERC-20 stake
  disputeOutcome: Ruling           # None | Accept | Reject
  rounds: [Round!]!               # @derivedFrom(field: "challenge")
  numberOfRounds: BigInt!
  registry: Registry!
  registryAddress: Bytes!
  resolutionTime: BigInt           # When resolved (null if pending)
  resolutionTx: Bytes
}
```

**Dispute Outcome Mapping:**

| Ruling enum | Meaning | PGTCR Party Equivalent |
|---|---|---|
| `None` | Arbitrator refused or not yet ruled | `Party.None` |
| `Accept` | Ruled in favor of the requester (submitter) | `Party.Submitter` — item stays |
| `Reject` | Ruled in favor of the challenger | `Party.Challenger` — item removed |

#### Submission

```graphql
type Submission @entity(immutable: false) {
  id: ID!                          # <itemID>@<tcrAddress>-<submissionId>
  item: Item!
  submissionID: BigInt!            # Sequential index (starts at 0)
  createdAt: BigInt!
  creationTx: Bytes!
  finishedAt: BigInt               # When submission cycle ended
  withdrawingTimestamp: BigInt!
  withdrawingTx: Bytes
  submitter: Bytes!
  initialStake: BigInt!            # ERC-20 deposit at submission time
  arbitrationDeposit: BigInt!      # Native ETH deposit (fixed for this submission)
}
```

#### Registry

```graphql
type Registry @entity(immutable: false) {
  id: ID!                          # Registry contract address
  arbitrationSettings: [ArbitrationSetting!]!
  arbitrationSettingCount: BigInt!
  items: [Item!]!
  challenges: [Challenge!]!
  numberOfSubmitted: BigInt!       # Items in Submitted/Reincluded state
  numberOfAbsent: BigInt!
  numberOfDisputed: BigInt!
  createdAt: BigInt!
  arbitrator: Arbitrator!
  token: Bytes!                    # ERC-20 token address (WETH)
  submissionMinDeposit: BigInt!
  submissionPeriod: BigInt!
  reinclusionPeriod: BigInt!
  withdrawingPeriod: BigInt!
  arbitrationParamsCooldown: BigInt!
  challengeStakeMultiplier: BigInt!
  winnerStakeMultiplier: BigInt!
  loserStakeMultiplier: BigInt!
  sharedStakeMultiplier: BigInt!
}
```

#### ArbitrationSetting

```graphql
type ArbitrationSetting @entity(immutable: true) {
  id: ID!                          # tcrAddress-arbSettingId
  registry: Registry!
  timestamp: BigInt!               # When settings were activated (0 for initial)
  arbitratorExtraData: Bytes!
  metaEvidenceURI: String!
  metadata: RegistryMetadata
}
```

#### RegistryMetadata

```graphql
type RegistryMetadata @entity(immutable: true) {
  id: ID!
  title: String
  description: String
  itemName: String
  itemNamePlural: String
  policyURI: String                # IPFS URI of the curation policy
  logoURI: String
  requireRemovalEvidence: Boolean
}
```

#### ItemMetadata

```graphql
type ItemMetadata @entity(immutable: true) {
  id: ID!                          # IPFS CID - Item ID
  props: [ItemProp!]!             # Parsed item columns
  key0: String                     # First indexable value
  key1: String                     # Second indexable value
  key2: String                     # Third indexable value
  key3: String                     # Fourth indexable value
  key4: String                     # Fifth indexable value
  keywords: String                 # Combined identifiers for full-text search
}
```

#### Evidence

```graphql
type Evidence @entity(immutable: true) {
  id: ID!                          # itemID@tcrAddress-number
  arbitrator: Bytes!
  item: Item!
  party: Bytes!                    # Who submitted the evidence
  URI: String!                     # Evidence file URI
  number: BigInt!                  # Sequential evidence index
  timestamp: BigInt!
  txHash: Bytes!
  metadata: EvidenceMetadata
}
```

#### Round

```graphql
type Round @entity(immutable: false) {
  id: ID!                          # <itemID>@<tcrAddress>-<challengeId>-<roundId>
  amountPaidRequester: BigInt!
  amountPaidChallenger: BigInt!
  hasPaidRequester: Boolean!
  hasPaidChallenger: Boolean!
  lastFundedRequester: BigInt!
  lastFundedChallenger: BigInt!
  feeRewards: BigInt!
  challenge: Challenge!
  appealPeriodStart: BigInt!
  appealPeriodEnd: BigInt!
  rulingTime: BigInt!
  ruling: Ruling!
  creationTime: BigInt!
  contributions: [Contribution!]!
  numberOfContributions: BigInt!
  appealed: Boolean!
  appealedAt: BigInt
}
```

### 8.2 Full-Text Search

The subgraph supports full-text search on:

```graphql
type _Schema_
  @fulltext(
    name: "itemSearch"
    language: en
    algorithm: rank
    include: [{ entity: "ItemMetadata", fields: [{ name: "keywords" }] }]
  )
  @fulltext(
    name: "registrySearch"
    language: en
    algorithm: rank
    include: [{ entity: "RegistryMetadata", fields: [{ name: "title" }, { name: "description" }, { name: "itemName" }] }]
  )
```

### 8.3 Key Queries for the Bot

```graphql
# Poll for items with status changes
query GetItemsByStatus($registryAddress: String!, $statuses: [Status!]!) {
  items(
    where: { registryAddress: $registryAddress, status_in: $statuses }
    orderBy: includedAt
    orderDirection: desc
  ) {
    id
    itemID
    data
    status
    submitter
    stake
    arbitrationDeposit
    includedAt
    withdrawingTimestamp
    numberOfChallenges
    metadata {
      key0
      key1
      key2
      key3
      key4
      keywords
    }
    challenges(orderBy: challengeID, orderDirection: desc, first: 1) {
      challengeID
      disputeID
      challenger
      itemStake
      challengerStake
      disputeOutcome
      resolutionTime
    }
  }
}

# Get recently resolved challenges (for detecting Scenario 2)
query GetResolvedChallenges($registryAddress: String!, $since: BigInt!) {
  challenges(
    where: {
      registryAddress: $registryAddress,
      resolutionTime_gte: $since,
      disputeOutcome: Reject
    }
  ) {
    id
    item {
      itemID
      status
      data
      metadata { key0 key1 key2 key3 key4 }
    }
    disputeID
    disputeOutcome
    challenger
    resolutionTime
  }
}
```

---

## 9. Curation Policy

The PGTCR has a formal curation policy for ERC-8004 agents, stored on IPFS.

**IPFS CID:** `QmRP6M55GazrgyMpjsVNJ4HXFqZHqrrJzKXEyMJDEvBV4H`
**Status:** v1.0, subject to iteration (thresholds may be adjusted, especially the 90/100 score and 50 feedback minimums)

### 9.1 Full Policy Text

> **ERC-8004 Agents Curated Registry Policy**
> **Version 1.0**
>
> #### Purpose
>
> This document details the acceptance criteria for entries to this curated registry of ERC-8004 autonomous agents.
>
> The primary purpose is to provide the community with a reliable, high-trust directory of agents that users can safely interact with, where payment mechanisms (if present) function correctly, where the agent is free from malware or malicious behavior, and where any past misbehavior is transparently and fully documented on-chain in the ERC-8004 Reputation Registry.
>
> #### Definitions
>
> 1. **Community:** Major explorers (e.g., 8004scan.io, 8004agents.ai), wallets, dApps, agent marketplaces, media, and other relevant participants in the agent economy.
> 2. **Key words:** "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in RFC 2119.
> 3. **Major issue:** A bug, deficiency, or vulnerability that: (a) Prevents the agent from operating as intended; or (b) Poses a risk of security breach, privacy violation, financial loss, malware delivery, or harm to users.
> 4. **Majority-used:** Used by the vast majority of the community when referring to an agent.
> 5. **Misbehavior:** Any action by the agent that results in user harm, including but not limited to scams, fund drainage, unauthorized actions, malware distribution, or exploitative behavior.
>
> #### Elements Required for Submission
>
> All submissions MUST include the following fields exactly as specified:
>
> | Field | Description | Examples / Notes |
> |---|---|---|
> | **Agent Number** | Sequential or custom identifier assigned by maintainers for easy reference in the list (e.g., 001, 002). | Assigned during curation; not on-chain. |
> | **Agent URI** | The full, valid tokenURI / agentURI pointing to the agent's complete JSON metadata (MUST be reachable via HTTPS, IPFS, Arweave, etc.). | `https://ipfs.io/ipfs/Qm...` `https://arweave.net/abc123` |
> | **Owner** | The wallet address responsible for managing the agent (the current ERC-721 token owner or the agentWallet specified in metadata), along with the relevant chain(s) derived from the registrations array. The primary managing wallet and its primary chain must be listed first. | `0x123...456 (Base)` `0xabc...def (Base, Ethereum)` |
> | **Additional Info** | Curated summary including: short description, reputation score & feedback volume, payment support status, safety notes, links (explorer, services), and explicit confirmation of safety criteria. | "High-reputation trading agent. Score: 98/100 (500+ feedback). x402 payments confirmed working. No negative feedback or misbehavior on-chain. Validated zk proofs. [8004scan.io/agent/12345]" |
>
> #### Acceptance Rules
>
> **Agent Integrity and Safety:**
>
> 1. The agent MUST hold a valid ERC-721 token in the official ERC-8004 Identity Registry with complete, up-to-date metadata.
> 2. The agent contract and endpoints MUST be free of major issues.
> 3. The agent MUST demonstrate high positive reputation in the ERC-8004 Reputation Registry:
>    - Average score ≥ 90/100 (or equivalent).
>    - Meaningful feedback volume (≥ 50 submissions recommended).
>    - Zero unresolved negative feedback indicating scams, financial loss, malware, or harm.
> 4. If the agent supports payments (e.g., x402), there MUST be confirmed successful payment feedback in the Reputation Registry and no reports of failures or disputes.
> 5. There MUST be no evidence of malware, phishing, exploitative code, or unauthorized actions. Maintainers verify endpoints and may perform sample interactions.
> 6. Any past misbehavior MUST be fully documented via negative or revoked feedback in the Reputation Registry. Agents with undocumented or off-chain disputes are rejected.
> 7. Preference is given to agents with strong validation proofs (zkML, TEE attestations, etc.) in the Validation Registry.
>
> Submissions should not be rejected based solely on a single indicator but assessed comprehensively on a case-by-case basis.
>
> **Duplicate Submissions:**
>
> 8. Agents MUST be submitted only once. If multiple pending submissions exist for the same agent (same primary agent ID), the first compliant submission MUST be accepted. Subsequent duplicates MUST be rejected, even if superior.
> 9. Resubmission of a registered agent is permitted only to correct or improve fields (e.g., update Owner or Additional Info due to ownership transfer or metadata changes) while maintaining full compliance.
>
> **Agent URI:**
>
> 10. The Agent URI: (a) MUST resolve to valid, complete ERC-8004 metadata (including name, description, image, services, registrations, and agentWallet where applicable). (b) MUST be permanently accessible (IPFS/Arweave preferred). (c) MUST reflect the current, official metadata of the agent.
>
> **Owner:**
>
> 11. The Owner field: (a) MUST accurately reflect the current wallet address responsible for managing the agent, verifiable on-chain as the ERC-721 token owner or the designated agentWallet. (b) MUST include the relevant chain(s) from the registrations array in metadata. (c) MUST prioritize the primary managing wallet and its primary chain. (d) In case of discrepancy between metadata agentWallet and on-chain token ownership, the on-chain ERC-721 token owner takes precedence as the managing authority.
>
> **Additional Info:**
>
> 12. The Additional Info field: (a) MUST include a concise, accurate description of the agent's purpose and utility. (b) MUST state the current reputation score and feedback volume. (c) MUST explicitly confirm payment functionality (if applicable). (d) MUST include key safety statements (e.g., "No negative feedback", "Clean on-chain record"). (e) MUST provide direct links to explorers and services. (f) MUST be written neutrally and factually.
> 13. Throughout the submission period, the Agent URI, all linked data, and on-chain ownership MUST remain accessible, discoverable, and consistent.
>
> #### Removal Rules
>
> 14. If a registered agent no longer meets the acceptance rules, anyone may request removal.
> 15. If an agent was compliant at acceptance but later becomes non-compliant (e.g., new negative feedback, payment issues, discovered malware, contract changes introducing major issues, or ownership transfer to a wallet with poor reputation), removal is REQUIRED.
> 16. Removals will be documented in the list history with justification.
>
> *This policy prioritizes user safety above quantity. The registry is intended as a trusted resource for the ERC-8004 ecosystem. Use agents at your own risk, but inclusion signals rigorous verification of on-chain trust and safety.*

### 9.2 Policy Notes for Implementation

- **Threshold caveat:** The 90/100 score requirement and 50 feedback minimum are v1.0 values, set for initial testing. These thresholds will likely be adjusted based on real-world usage patterns and ecosystem maturity. Document any hardcoded policy references as configurable.
- **Comprehensive assessment:** Rule 7 notes that rejections should not be based on a single indicator. Jurors are expected to evaluate holistically.
- **Removal ≠ permanent ban:** An agent removed for non-compliance can re-submit after addressing the issues and re-staking.

---

## 10. PGTCR vs Light Curate

This distinction is fundamental to understanding why the reputation signal from PGTCR is strong.

### PGTCR (Permanent) — Used in this system

| Property | Detail |
|---|---|
| **Stake lifecycle** | Locked from submission until **voluntary withdrawal** |
| **Challenge window** | **Any time** — as long as item is registered, it can be challenged |
| **Economic security** | **Continuous** — the submitter's deposit backs their claim at all times |
| **Stake token** | WETH (ERC-20), variable amount (can be 0 minimum, but configurable) |
| **Withdrawal** | Two-step: `startWithdrawItem()` → wait `withdrawingPeriod` → `withdrawItem()` |
| **Post-dispute (submitter wins)** | Item `Reincluded`, `item.stake += challenge.stake` (cost of future challenges increases) |

### Light Curate — NOT used (for comparison)

| Property | Detail |
|---|---|
| **Stake lifecycle** | Locked during **optimistic registration period** only |
| **Challenge window** | Fixed registration period only — once period passes, stake is returned |
| **Economic security** | **Temporary** — after the period, agent has no skin in the game |
| **Risk** | Agent can go rogue after the optimistic period with zero economic consequence |

### Why This Matters for Reputation

PGTCR reputation is **continuously collateralized**:
- A `curate-verified` signal from PGTCR means "this agent currently has economic stake at risk backing their claim of legitimacy."
- A `curate-removed` signal means "human jurors evaluated evidence and ruled against this agent, costing the submitter real money."
- This is fundamentally different from an optimistic period that expires — PGTCR verification is **ongoing**, not a one-time event.

---

## 11. KlerosReputationRouter Contract Specification

### 11.1 State Variables

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IReputationRegistry.sol";
import "./interfaces/IIdentityRegistry.sol";

contract KlerosReputationRouter {
    // ══════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════

    /// @notice Owner address (multisig in production).
    address public owner;

    /// @notice The 8004 ReputationRegistry contract.
    IReputationRegistry public reputationRegistry;

    /// @notice The 8004 IdentityRegistry contract.
    IIdentityRegistry public identityRegistry;

    /// @notice Kleros's own agent ID in the 8004 IdentityRegistry.
    uint256 public klerosAgentId;

    /// @notice Addresses authorized to call feedback functions (bot addresses).
    mapping(address => bool) public authorizedBots;

    /// @notice Tracks the last feedback index per agentId for revocation.
    mapping(uint256 => uint64) public feedbackIndex;

    /// @notice Whether we have active (non-revoked) feedback for an agentId.
    mapping(uint256 => bool) public hasFeedback;

    /// @notice Maps PGTCR item IDs to 8004 agent IDs.
    mapping(bytes32 => uint256) public pgtcrToAgentId;

    // ══════════════════════════════════════════════════════════
    // CONSTANTS
    // ══════════════════════════════════════════════════════════

    /// @notice Positive feedback value (95 = "very high confidence, human-verified")
    int128 public constant POSITIVE_VALUE = 95;

    /// @notice Negative feedback value (-95 = "failed verification / misbehavior")
    int128 public constant NEGATIVE_VALUE = -95;

    /// @notice Tag identifying PGTCR-verified agents
    string public constant TAG_VERIFIED = "curate-verified";

    /// @notice Tag identifying PGTCR-removed agents
    string public constant TAG_REMOVED = "curate-removed";

    /// @notice Tag identifying the Kleros agent registry
    string public constant TAG_REGISTRY = "kleros-agent-registry";

    // ══════════════════════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════════════════════

    event PositiveFeedbackSubmitted(uint256 indexed agentId, bytes32 indexed pgtcrItemId, uint64 feedbackIndex);
    event NegativeFeedbackSubmitted(uint256 indexed agentId, uint64 revokedIndex, uint64 newFeedbackIndex);
    event FeedbackRevoked(uint256 indexed agentId, uint64 revokedIndex);
    event BotAuthorizationChanged(address indexed bot, bool authorized);
    event PGTCRMappingSet(bytes32 indexed pgtcrItemId, uint256 indexed agentId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ══════════════════════════════════════════════════════════
    // MODIFIERS
    // ══════════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "KRR: not owner");
        _;
    }

    modifier onlyAuthorizedBot() {
        require(authorizedBots[msg.sender], "KRR: not authorized bot");
        _;
    }
}
```

### 11.2 Constructor

```solidity
constructor(
    address _reputationRegistry,
    address _identityRegistry,
    uint256 _klerosAgentId,
    address _owner
) {
    reputationRegistry = IReputationRegistry(_reputationRegistry);
    identityRegistry = IIdentityRegistry(_identityRegistry);
    klerosAgentId = _klerosAgentId;
    owner = _owner;
}
```

### 11.3 Core Functions

#### `submitPositiveFeedback`

Called when a PGTCR item is registered (Scenario 1).

```solidity
/// @notice Submit positive feedback for an agent verified on Kleros PGTCR.
/// @param agentId The 8004 agent ID.
/// @param pgtcrItemId The PGTCR item ID (for tracking).
/// @param feedbackURI IPFS URI pointing to the evidence JSON.
function submitPositiveFeedback(
    uint256 agentId,
    bytes32 pgtcrItemId,
    string calldata feedbackURI
) external onlyAuthorizedBot {
    require(!hasFeedback[agentId], "KRR: already has active feedback");

    reputationRegistry.giveFeedback(
        agentId,
        POSITIVE_VALUE,         // value: 95
        0,                      // valueDecimals: 0
        TAG_VERIFIED,           // tag1: "curate-verified"
        TAG_REGISTRY,           // tag2: "kleros-agent-registry"
        "",                     // endpoint (not applicable)
        feedbackURI,            // IPFS evidence URI
        bytes32(0)              // feedbackHash (IPFS is content-addressed)
    );

    uint64 idx = reputationRegistry.getLastIndex(agentId, address(this));
    feedbackIndex[agentId] = idx;
    hasFeedback[agentId] = true;
    pgtcrToAgentId[pgtcrItemId] = agentId;

    emit PositiveFeedbackSubmitted(agentId, pgtcrItemId, idx);
}
```

#### `submitNegativeFeedback`

Called when a PGTCR item is removed by dispute (Scenario 2).

```solidity
/// @notice Submit negative feedback for an agent removed from Kleros PGTCR by dispute.
/// @dev Revokes existing positive feedback first, then submits negative.
/// @param agentId The 8004 agent ID.
/// @param feedbackURI IPFS URI pointing to the evidence JSON (including dispute details).
function submitNegativeFeedback(
    uint256 agentId,
    string calldata feedbackURI
) external onlyAuthorizedBot {
    if (hasFeedback[agentId]) {
        reputationRegistry.revokeFeedback(agentId, feedbackIndex[agentId]);
        uint64 revokedIdx = feedbackIndex[agentId];

        reputationRegistry.giveFeedback(
            agentId,
            NEGATIVE_VALUE,         // value: -95
            0,                      // valueDecimals: 0
            TAG_REMOVED,            // tag1: "curate-removed"
            TAG_REGISTRY,           // tag2: "kleros-agent-registry"
            "",
            feedbackURI,
            bytes32(0)
        );

        uint64 newIdx = reputationRegistry.getLastIndex(agentId, address(this));
        feedbackIndex[agentId] = newIdx;

        emit NegativeFeedbackSubmitted(agentId, revokedIdx, newIdx);
    } else {
        reputationRegistry.giveFeedback(
            agentId,
            NEGATIVE_VALUE,
            0,
            TAG_REMOVED,
            TAG_REGISTRY,
            "",
            feedbackURI,
            bytes32(0)
        );

        uint64 newIdx = reputationRegistry.getLastIndex(agentId, address(this));
        feedbackIndex[agentId] = newIdx;
        hasFeedback[agentId] = true;

        emit NegativeFeedbackSubmitted(agentId, 0, newIdx);
    }
}
```

#### `revokeOnly`

Called when an agent voluntarily withdraws from the PGTCR (Scenario 3).

```solidity
/// @notice Revoke feedback for an agent that voluntarily withdrew from PGTCR.
/// @dev Does NOT submit negative feedback — voluntary withdrawal is neutral.
/// @param agentId The 8004 agent ID.
function revokeOnly(uint256 agentId) external onlyAuthorizedBot {
    require(hasFeedback[agentId], "KRR: no feedback to revoke");

    uint64 idx = feedbackIndex[agentId];
    reputationRegistry.revokeFeedback(agentId, idx);

    delete feedbackIndex[agentId];
    hasFeedback[agentId] = false;

    emit FeedbackRevoked(agentId, idx);
}
```

### 11.4 Admin Functions

```solidity
function setAuthorizedBot(address bot, bool authorized) external onlyOwner {
    authorizedBots[bot] = authorized;
    emit BotAuthorizationChanged(bot, authorized);
}

function setPGTCRMapping(bytes32 pgtcrItemId, uint256 agentId) external {
    require(msg.sender == owner || authorizedBots[msg.sender], "KRR: not authorized");
    pgtcrToAgentId[pgtcrItemId] = agentId;
    emit PGTCRMappingSet(pgtcrItemId, agentId);
}

function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "KRR: zero address");
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
}

function setReputationRegistry(address _reputationRegistry) external onlyOwner {
    reputationRegistry = IReputationRegistry(_reputationRegistry);
}

function setIdentityRegistry(address _identityRegistry) external onlyOwner {
    identityRegistry = IIdentityRegistry(_identityRegistry);
}

function setKlerosAgentId(uint256 _klerosAgentId) external onlyOwner {
    klerosAgentId = _klerosAgentId;
}
```

### 11.5 View Functions

```solidity
function hasActiveFeedback(uint256 agentId) external view returns (bool) {
    return hasFeedback[agentId];
}

function getStoredFeedbackIndex(uint256 agentId) external view returns (uint64) {
    return feedbackIndex[agentId];
}

function resolveAgent(bytes32 pgtcrItemId) external view returns (uint256) {
    return pgtcrToAgentId[pgtcrItemId];
}
```

### 11.6 Critical Design Notes

1. **The Router IS the `clientAddress`.** When the Router calls `reputationRegistry.giveFeedback(...)`, `msg.sender` is the Router's address. Consumers who want Kleros-backed reputation call `getSummary(agentId, [routerAddress], ...)`.

2. **The Router must NOT own any agents it rates.** The ReputationRegistry reverts on self-feedback.

3. **One feedback entry per agent at a time.** The current design tracks a single `feedbackIndex` per `agentId`. See [Section 19, Question 3](#19-open-design-questions) for multi-list considerations.

4. **Gas considerations.** On Ethereum Sepolia, gas costs are negligible (testnet). On mainnet, each `giveFeedback` call writes multiple storage slots — consider batching for high-volume scenarios.

---

## 12. Off-Chain Bot Specification

### 12.1 Overview

The bot is a TypeScript process that:
1. **Polls the PGTCR subgraph** (GraphQL) for item status changes every N minutes.
2. Compares with local state (which items already have feedback submitted).
3. Resolves PGTCR items to 8004 agentIds.
4. Creates and pins IPFS evidence files.
5. Calls the appropriate Router function.

### 12.2 Technology

| Dependency | Version | Purpose |
|---|---|---|
| TypeScript | ^5.0 | Language |
| Node.js | ^20.0 | Runtime |
| viem | ^2.0 | Ethereum client (preferred over ethers.js for type safety and performance) |
| graphql-request | ^6.0 | GraphQL client for subgraph queries |
| @pinata/sdk or web3.storage | latest | IPFS pinning |
| dotenv | ^16.0 | Environment variable management |

### 12.3 Configuration

```typescript
// bot/src/config.ts

export interface Config {
  // Chain
  rpcUrl: string;                    // Ethereum Sepolia RPC endpoint
  chainId: number;                   // 11155111

  // Contracts
  routerAddress: `0x${string}`;      // KlerosReputationRouter deployment address
  pgtcrAddress: `0x${string}`;       // 0x3162df9669affa8b6b6ff2147afa052249f00447
  reputationRegistryAddress: `0x${string}`;  // 0x8004B663056A597Dffe9eCcC1965A193B7388713
  identityRegistryAddress: `0x${string}`;    // 0x8004A818BFB912233c491871b3d84c89A494BD9e

  // Subgraph
  subgraphUrl: string;               // PGTCR subgraph endpoint (TBD — behind DEX-8004 API)

  // Bot wallet
  botPrivateKey: `0x${string}`;      // Private key for tx signing (NEVER commit this)

  // IPFS
  pinataApiKey: string;
  pinataSecretKey: string;

  // Polling
  pollingIntervalMs: number;         // How often to check for new events (default: 300000 = 5 min)
}
```

Environment variables (`.env`):
```bash
RPC_URL=https://rpc.sepolia.org
CHAIN_ID=11155111
ROUTER_ADDRESS=0x...
PGTCR_ADDRESS=0x3162df9669affa8b6b6ff2147afa052249f00447
REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
SUBGRAPH_URL=https://...  # TBD — behind DEX-8004 API
BOT_PRIVATE_KEY=0x...
PINATA_API_KEY=...
PINATA_SECRET_KEY=...
POLLING_INTERVAL_MS=300000
```

### 12.4 Subgraph Polling Strategy

The bot uses a **poll-and-diff** approach instead of event listening:

```typescript
// bot/src/subgraph-poller.ts

import { GraphQLClient, gql } from 'graphql-request';
import { Config } from './config';

interface LocalState {
  // Items we've already processed and submitted feedback for
  processedItems: Map<string, {
    agentId: bigint;
    feedbackType: 'positive' | 'negative' | 'revoked';
    lastStatus: string;
    lastProcessedAt: number;
  }>;
}

export class SubgraphPoller {
  private client: GraphQLClient;
  private state: LocalState;
  private registryAddress: string;

  constructor(config: Config) {
    this.client = new GraphQLClient(config.subgraphUrl);
    this.registryAddress = config.pgtcrAddress.toLowerCase();
    this.state = { processedItems: new Map() };
  }

  async poll(): Promise<StatusChange[]> {
    const changes: StatusChange[] = [];

    // 1. Query all items from the registry
    const items = await this.queryItems();

    for (const item of items) {
      const existing = this.state.processedItems.get(item.itemID);

      // New Submitted or Reincluded item → positive feedback
      if (
        (item.status === 'Submitted' || item.status === 'Reincluded') &&
        (!existing || existing.feedbackType !== 'positive')
      ) {
        changes.push({
          type: 'positive',
          itemID: item.itemID,
          item,
        });
      }

      // Newly Absent with losing challenge → negative feedback
      if (item.status === 'Absent' && existing?.feedbackType === 'positive') {
        const lastChallenge = item.challenges?.[0];
        if (lastChallenge?.disputeOutcome === 'Reject') {
          changes.push({
            type: 'negative',
            itemID: item.itemID,
            item,
            challenge: lastChallenge,
          });
        }
        // Absent with withdrawingTimestamp > 0 and no losing challenge → revoke only
        else if (
          BigInt(item.withdrawingTimestamp) > 0n &&
          lastChallenge?.disputeOutcome !== 'Reject'
        ) {
          changes.push({
            type: 'revoke',
            itemID: item.itemID,
            item,
          });
        }
      }
    }

    return changes;
  }

  private async queryItems(): Promise<SubgraphItem[]> {
    const query = gql`
      query GetRegistryItems($registry: String!) {
        items(where: { registryAddress: $registry }, first: 1000) {
          id
          itemID
          data
          status
          submitter
          stake
          arbitrationDeposit
          includedAt
          withdrawingTimestamp
          metadata {
            key0
            key1
            key2
            key3
            key4
            keywords
          }
          challenges(orderBy: challengeID, orderDirection: desc, first: 1) {
            challengeID
            disputeID
            challenger
            itemStake
            challengerStake
            disputeOutcome
            resolutionTime
          }
        }
      }
    `;

    const data = await this.client.request(query, {
      registry: this.registryAddress,
    });
    return data.items;
  }

  updateState(itemID: string, agentId: bigint, feedbackType: string) {
    this.state.processedItems.set(itemID, {
      agentId,
      feedbackType: feedbackType as any,
      lastStatus: feedbackType,
      lastProcessedAt: Date.now(),
    });
  }
}

interface StatusChange {
  type: 'positive' | 'negative' | 'revoke';
  itemID: string;
  item: SubgraphItem;
  challenge?: SubgraphChallenge;
}
```

### 12.5 Router Caller

```typescript
// bot/src/router-caller.ts

import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Config } from './config';
import { ROUTER_ABI } from './abis/router';

export class RouterCaller {
  private client;
  private account;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.account = privateKeyToAccount(config.botPrivateKey);
    this.client = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport: http(config.rpcUrl),
    }).extend(publicActions);
  }

  async submitPositiveFeedback(
    agentId: bigint,
    pgtcrItemId: `0x${string}`,
    feedbackURI: string
  ): Promise<`0x${string}`> {
    const hash = await this.client.writeContract({
      address: this.config.routerAddress,
      abi: ROUTER_ABI,
      functionName: 'submitPositiveFeedback',
      args: [agentId, pgtcrItemId, feedbackURI],
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    console.log(`[+] Positive feedback submitted. Tx: ${hash}`);
    return hash;
  }

  async submitNegativeFeedback(
    agentId: bigint,
    feedbackURI: string
  ): Promise<`0x${string}`> {
    const hash = await this.client.writeContract({
      address: this.config.routerAddress,
      abi: ROUTER_ABI,
      functionName: 'submitNegativeFeedback',
      args: [agentId, feedbackURI],
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    console.log(`[-] Negative feedback submitted. Tx: ${hash}`);
    return hash;
  }

  async revokeOnly(agentId: bigint): Promise<`0x${string}`> {
    const hash = await this.client.writeContract({
      address: this.config.routerAddress,
      abi: ROUTER_ABI,
      functionName: 'revokeOnly',
      args: [agentId],
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    console.log(`[~] Feedback revoked (voluntary withdrawal). Tx: ${hash}`);
    return hash;
  }

  async setPGTCRMapping(
    pgtcrItemId: `0x${string}`,
    agentId: bigint
  ): Promise<`0x${string}`> {
    const hash = await this.client.writeContract({
      address: this.config.routerAddress,
      abi: ROUTER_ABI,
      functionName: 'setPGTCRMapping',
      args: [pgtcrItemId, agentId],
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    console.log(`[=] PGTCR mapping set: ${pgtcrItemId} → agentId ${agentId}. Tx: ${hash}`);
    return hash;
  }
}
```

### 12.6 IPFS Uploader

```typescript
// bot/src/ipfs-uploader.ts

import PinataClient from '@pinata/sdk';
import { Config } from './config';

export class IPFSUploader {
  private pinata: PinataClient;

  constructor(config: Config) {
    this.pinata = new PinataClient(config.pinataApiKey, config.pinataSecretKey);
  }

  async uploadEvidence(evidence: FeedbackEvidence): Promise<string> {
    const result = await this.pinata.pinJSONToIPFS(evidence, {
      pinataMetadata: {
        name: `kleros-8004-feedback-${evidence.agentId}-${Date.now()}`,
      },
    });
    return `ipfs://${result.IpfsHash}`;
  }
}

export interface FeedbackEvidence {
  agentRegistry: string;        // "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e"
  agentId: number;
  clientAddress: string;        // "eip155:11155111:<RouterAddress>"
  createdAt: string;            // ISO 8601
  value: number;                // 95 or -95
  valueDecimals: number;        // 0
  tag1: string;                 // "curate-verified" or "curate-removed"
  tag2: string;                 // "kleros-agent-registry"

  kleros: {
    pgtcrAddress: string;
    pgtcrItemId: string;
    stakeAmount: string;        // Human-readable (e.g., "0.002")
    stakeToken: string;         // "WETH"
    disputeId: number | null;
    ruling: number | null;
    submissionTxHash?: string;
    removalTxHash?: string;
    evidenceLinks?: string[];
  };
}
```

### 12.7 Main Loop

```typescript
// bot/src/index.ts

import { loadConfig } from './config';
import { SubgraphPoller } from './subgraph-poller';
import { RouterCaller } from './router-caller';
import { IPFSUploader, FeedbackEvidence } from './ipfs-uploader';

async function main() {
  const config = loadConfig();
  const poller = new SubgraphPoller(config);
  const router = new RouterCaller(config);
  const ipfs = new IPFSUploader(config);

  console.log(`[*] Kleros Reputation Oracle Bot started.`);
  console.log(`[*] Chain: Ethereum Sepolia (${config.chainId})`);
  console.log(`[*] Router: ${config.routerAddress}`);
  console.log(`[*] PGTCR: ${config.pgtcrAddress}`);
  console.log(`[*] Subgraph: ${config.subgraphUrl}`);
  console.log(`[*] Polling every ${config.pollingIntervalMs / 1000}s`);

  while (true) {
    try {
      const changes = await poller.poll();

      for (const change of changes) {
        const agentId = await resolveAgentId(config, router, change.itemID);
        if (!agentId) {
          console.log(`[?] No agent mapping for item ${change.itemID}. Skipping.`);
          continue;
        }

        switch (change.type) {
          case 'positive': {
            const evidence = buildPositiveEvidence(config, agentId, change);
            const feedbackURI = await ipfs.uploadEvidence(evidence);
            await router.submitPositiveFeedback(
              BigInt(agentId),
              change.itemID as `0x${string}`,
              feedbackURI
            );
            poller.updateState(change.itemID, BigInt(agentId), 'positive');
            break;
          }

          case 'negative': {
            const evidence = buildNegativeEvidence(config, agentId, change);
            const feedbackURI = await ipfs.uploadEvidence(evidence);
            await router.submitNegativeFeedback(BigInt(agentId), feedbackURI);
            poller.updateState(change.itemID, BigInt(agentId), 'negative');
            break;
          }

          case 'revoke': {
            await router.revokeOnly(BigInt(agentId));
            poller.updateState(change.itemID, BigInt(agentId), 'revoked');
            break;
          }
        }
      }
    } catch (error) {
      console.error(`[!] Error processing:`, error);
    }

    await sleep(config.pollingIntervalMs);
  }
}

function buildPositiveEvidence(config: Config, agentId: number, change: any): FeedbackEvidence {
  return {
    agentRegistry: `eip155:${config.chainId}:${config.identityRegistryAddress}`,
    agentId,
    clientAddress: `eip155:${config.chainId}:${config.routerAddress}`,
    createdAt: new Date().toISOString(),
    value: 95,
    valueDecimals: 0,
    tag1: "curate-verified",
    tag2: "kleros-agent-registry",
    kleros: {
      pgtcrAddress: config.pgtcrAddress,
      pgtcrItemId: change.itemID,
      stakeAmount: change.item?.stake ? (BigInt(change.item.stake) / 10n ** 18n).toString() : "0",
      stakeToken: "WETH",
      disputeId: null,
      ruling: null,
    },
  };
}

function buildNegativeEvidence(config: Config, agentId: number, change: any): FeedbackEvidence {
  return {
    agentRegistry: `eip155:${config.chainId}:${config.identityRegistryAddress}`,
    agentId,
    clientAddress: `eip155:${config.chainId}:${config.routerAddress}`,
    createdAt: new Date().toISOString(),
    value: -95,
    valueDecimals: 0,
    tag1: "curate-removed",
    tag2: "kleros-agent-registry",
    kleros: {
      pgtcrAddress: config.pgtcrAddress,
      pgtcrItemId: change.itemID,
      stakeAmount: change.item?.stake ? (BigInt(change.item.stake) / 10n ** 18n).toString() : "0",
      stakeToken: "WETH",
      disputeId: change.challenge?.disputeID ? Number(change.challenge.disputeID) : null,
      ruling: change.challenge?.disputeOutcome === 'Reject' ? 2 : null,
    },
  };
}

async function resolveAgentId(config: Config, router: RouterCaller, pgtcrItemId: string): Promise<number | null> {
  // POC: Read from Router's on-chain mapping (Strategy C)
  // Production: Read from PGTCR item IPFS metadata (Strategy A)
  // or replicate DEX-8004's mapping logic
  return null; // Placeholder
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
```

---

## 13. IPFS Evidence Schema

Every feedback submission includes an IPFS-pinned evidence file. The schema follows the ERC-8004 off-chain feedback file specification with Kleros-specific extensions.

### 13.1 Positive Feedback Evidence (Scenario 1)

```json
{
  "agentRegistry": "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  "agentId": 1436,
  "clientAddress": "eip155:11155111:0xROUTER_ADDRESS_HERE",
  "createdAt": "2026-03-13T14:00:00Z",
  "value": 95,
  "valueDecimals": 0,
  "tag1": "curate-verified",
  "tag2": "kleros-agent-registry",
  "kleros": {
    "pgtcrAddress": "0x3162df9669affa8b6b6ff2147afa052249f00447",
    "pgtcrItemId": "0xITEM_ID_BYTES32",
    "stakeAmount": "0.002",
    "stakeToken": "WETH",
    "submissionTxHash": "0xTX_HASH",
    "disputeId": null,
    "ruling": null
  }
}
```

### 13.2 Negative Feedback Evidence (Scenario 2)

```json
{
  "agentRegistry": "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  "agentId": 1436,
  "clientAddress": "eip155:11155111:0xROUTER_ADDRESS_HERE",
  "createdAt": "2026-03-13T15:30:00Z",
  "value": -95,
  "valueDecimals": 0,
  "tag1": "curate-removed",
  "tag2": "kleros-agent-registry",
  "kleros": {
    "pgtcrAddress": "0x3162df9669affa8b6b6ff2147afa052249f00447",
    "pgtcrItemId": "0xITEM_ID_BYTES32",
    "stakeAmount": "0.002",
    "stakeToken": "WETH",
    "removalTxHash": "0xTX_HASH",
    "disputeId": 1234,
    "ruling": 2,
    "evidenceLinks": [
      "ipfs://QmEVIDENCE1...",
      "ipfs://QmEVIDENCE2..."
    ]
  }
}
```

### 13.3 Field Descriptions

| Field | Type | Description |
|---|---|---|
| `agentRegistry` | string | CAIP-10 identifier for the 8004 IdentityRegistry on Ethereum Sepolia. |
| `agentId` | number | The 8004 agent ID this feedback is about. |
| `clientAddress` | string | CAIP-10 identifier for the Router contract (the `msg.sender` of `giveFeedback`). |
| `createdAt` | string | ISO 8601 timestamp of evidence creation. |
| `value` | number | +95 for positive (verified), -95 for negative (removed by dispute). |
| `valueDecimals` | number | Always 0 (integer values). |
| `tag1` | string | `"curate-verified"` or `"curate-removed"`. |
| `tag2` | string | `"kleros-agent-registry"` (identifies the specific PGTCR list). |
| `kleros.pgtcrAddress` | string | Address of the PGTCR contract. |
| `kleros.pgtcrItemId` | string | Bytes32 item ID in the PGTCR. |
| `kleros.stakeAmount` | string | Human-readable stake amount (e.g., `"0.002"`). |
| `kleros.stakeToken` | string | Token symbol (e.g., `"WETH"`). |
| `kleros.disputeId` | number \| null | Kleros dispute ID if the item was challenged. |
| `kleros.ruling` | number \| null | Court ruling (1 = submitter wins, 2 = challenger wins). |
| `kleros.submissionTxHash` | string \| undefined | Transaction hash of the original PGTCR submission. |
| `kleros.removalTxHash` | string \| undefined | Transaction hash of the removal. |
| `kleros.evidenceLinks` | string[] \| undefined | IPFS links to dispute evidence submissions. |

---

## 14. Kleros 8004 Identity Setup

These steps are performed **once, manually**, before the bot can operate.

### Step 1: Deploy KlerosReputationRouter

Deploy the Router contract to **Ethereum Sepolia** with:
- `_reputationRegistry`: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- `_identityRegistry`: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- `_klerosAgentId`: `0` (will be set after registration in Step 4)
- `_owner`: deployer address (or multisig)

### Step 2: Register Kleros as an 8004 Agent

Call `IdentityRegistry.register(agentURI)` from the Kleros admin wallet.

The `agentURI` must point to a JSON file hosted on IPFS or a public URL:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Kleros Reputation Oracle",
  "description": "Economically-secured agent reputation powered by Kleros Curate (PermanentGTCR). Agents verified by human jurors with continuous staking — challengeable at any time. Registered agents have WETH bonded in a Permanent TCR; removal requires a successful Kleros dispute.",
  "image": "https://kleros.io/logo.png",
  "services": [
    {
      "name": "web",
      "endpoint": "https://kleros.io"
    },
    {
      "name": "reputation-oracle",
      "endpoint": "https://kleros.io/reputation"
    }
  ],
  "x402Support": false,
  "active": true,
  "supportedTrust": ["reputation"]
}
```

Pin this JSON to IPFS first, then pass the IPFS URI as `agentURI`.

### Step 3: Note the Assigned agentId

The `register()` function returns the newly assigned `agentId`. Record this value.

### Step 4: Configure the Router

Call `Router.setKlerosAgentId(agentId)` with the value from Step 3.

### Step 5: Authorize the Bot

Call `Router.setAuthorizedBot(botAddress, true)` where `botAddress` is the Ethereum address corresponding to the bot's private key.

### Step 6: Fund the Bot

Send some testnet ETH to the bot address on Ethereum Sepolia so it can pay for gas.

Faucets:
- Google Cloud faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Alchemy faucet: https://sepoliafaucet.com/

---

## 15. DEX-8004 Integration

### 15.1 Overview

DEX-8004 (https://dex-8004.vercel.app/) is a custom UI for verified ERC-8004 agents, built by a colleague. It provides the visual frontend for the PGTCR-backed agent verification system.

### 15.2 Agent Pages

Example: https://dex-8004.vercel.app/agents/11155111%3A1436?network=sepolia

This shows agent "testMaldo3" (agentId 1436, Ethereum Sepolia) with:
- **History timeline:** Created → Collateral submitted (0.002 ETH) → Challenged → Disputed
- **Evidence section** with Curate links
- **Reviews section (currently empty)** — **THIS is where Kleros reputation feedback would appear** once the Oracle bot is running
- **"View on Curate" link** connecting to PGTCR frontend

### 15.3 Integration Points

| DEX-8004 Feature | Oracle Bot Equivalent |
|---|---|
| PGTCR ↔ 8004 agent mapping | Bot needs the same logic to resolve PGTCR items → agentIds |
| Agent timeline events | Bot needs to detect the same status transitions |
| Reviews section | Populated by reputation feedback submitted by the Router |
| "View on Curate" link | Evidence JSON includes PGTCR addresses for cross-referencing |

### 15.4 Data Flow

```
PGTCR Contract (0x3162...)
    │
    ├──► PGTCR Subgraph ──► DEX-8004 UI (displays agent status, history)
    │                  └──► Oracle Bot (detects status changes)
    │
    └──► Oracle Bot ──► Router.sol ──► ReputationRegistry
                                           │
                                           └──► DEX-8004 UI (displays reviews)
```

### 15.5 PGTCR Deployment Details

- **PGTCR Contract:** `0x3162df9669affa8b6b6ff2147afa052249f00447` (Ethereum Sepolia)
- **Subgraph endpoint:** TBD — currently behind the DEX-8004 app API (colleague will provide)
- **Collateral example:** 0.002 ETH observed on testMaldo3

---

## 16. Testing Plan

### 16.1 Unit Tests (Router Contract)

**Framework:** Foundry (`forge test`) preferred
**Environment:** Local fork of Ethereum Sepolia

| Test | Description | Expected |
|---|---|---|
| `test_submitPositiveFeedback` | Authorized bot submits positive feedback | `getSummary` returns count=1, value=95 |
| `test_submitPositiveFeedback_duplicateReverts` | Submit positive twice for same agent | Reverts with "already has active feedback" |
| `test_submitPositiveFeedback_unauthorizedReverts` | Non-bot address calls submitPositiveFeedback | Reverts with "not authorized bot" |
| `test_submitNegativeFeedback` | Submit negative after positive exists | Old positive revoked, `getSummary` returns count=1, value=-95 |
| `test_submitNegativeFeedback_noExistingFeedback` | Negative feedback with no prior positive | `getSummary` returns count=1, value=-95 |
| `test_revokeOnly` | Voluntary withdrawal | `getSummary` returns count=0 |
| `test_revokeOnly_noFeedbackReverts` | Revoke with no active feedback | Reverts |
| `test_setPGTCRMapping` | Owner sets mapping | Readable via `resolveAgent()` |
| `test_fullLifecycle_registerThenDispute` | Positive → Negative flow | Final state: count=1, value=-95 |
| `test_fullLifecycle_registerThenWithdraw` | Positive → Revoke flow | Final state: count=0 |
| `test_valueConstants` | Verify POSITIVE_VALUE=95, NEGATIVE_VALUE=-95 | Constants correct |

### 16.2 Integration Tests

**Environment:** Ethereum Sepolia (live testnet)

```
1. Register a test agent on 8004 IdentityRegistry
   → Note agentId (e.g., agentId = 1436)

2. Set PGTCR mapping: Router.setPGTCRMapping(testItemId, 1436)

3. SCENARIO 1 — Positive feedback:
   → Call Router.submitPositiveFeedback(1436, testItemId, "ipfs://testEvidence1")
   → Verify: getSummary(1436, [routerAddress], "", "")
     Expected: count=1, summaryValue=95, summaryValueDecimals=0
   → Verify tag filtering with "curate-verified"

4. SCENARIO 2 — Negative feedback:
   → Call Router.submitNegativeFeedback(1436, "ipfs://testEvidence2")
   → Verify: getSummary → count=1, summaryValue=-95
   → Verify old positive is revoked

5. SCENARIO 3 — Voluntary withdrawal (new agent):
   → Submit positive, then revokeOnly
   → Verify: getSummary → count=0

6. DEX-8004 VERIFICATION:
   → Check DEX-8004 UI shows reviews after feedback is submitted
   → Verify "View on Curate" links work correctly
```

### 16.3 Bot Tests

| Test | Description |
|---|---|
| Mock subgraph response → positive | Feed a mock `Submitted` item, verify bot calls `submitPositiveFeedback` |
| Mock subgraph response → negative | Feed a mock `Absent` (Reject outcome) item, verify `submitNegativeFeedback` |
| Mock subgraph response → revoke | Feed a mock `Absent` (withdrawal) item, verify `revokeOnly` |
| IPFS upload | Verify evidence JSON is correctly formatted with value=95/-95 |
| Unknown item | Feed event for unmapped item, verify bot skips |
| Idempotency | Feed duplicate status, verify bot doesn't double-submit |

---

## 17. File Structure

```
kleros-reputation-oracle/
├── contracts/
│   ├── src/
│   │   ├── KlerosReputationRouter.sol
│   │   └── interfaces/
│   │       ├── IReputationRegistry.sol
│   │       └── IIdentityRegistry.sol
│   ├── test/
│   │   └── KlerosReputationRouter.t.sol
│   ├── script/
│   │   ├── DeployRouter.s.sol
│   │   └── RegisterKlerosAgent.s.sol
│   ├── foundry.toml
│   └── remappings.txt
│
├── bot/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── subgraph-poller.ts
│   │   ├── router-caller.ts
│   │   ├── ipfs-uploader.ts
│   │   └── abis/
│   │       ├── router.ts
│   │       └── pgtcr.ts
│   ├── test/
│   │   ├── subgraph-poller.test.ts
│   │   ├── router-caller.test.ts
│   │   └── ipfs-uploader.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── scripts/
│   ├── deploy-router.ts
│   ├── register-kleros-agent.ts
│   ├── test-flow.ts
│   └── setup-mapping.ts
│
├── metadata/
│   ├── kleros-agent-registration.json
│   ├── curation-policy.pdf
│   ├── example-evidence-positive.json
│   └── example-evidence-negative.json
│
├── .gitignore
├── README.md
└── PRD.md
```

---

## 18. Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| **Smart Contracts** | Solidity | ^0.8.20 | Router contract (PGTCR is ^0.8.30) |
| **Contract Tooling** | Foundry (forge, cast, anvil) | latest | |
| **Bot Runtime** | Node.js | ^20.0 | LTS |
| **Bot Language** | TypeScript | ^5.0 | |
| **Ethereum Client** | viem | ^2.0 | |
| **GraphQL Client** | graphql-request | ^6.0 | For subgraph queries |
| **IPFS Pinning** | Pinata (@pinata/sdk) | latest | |
| **Testing** | Foundry (forge test) | — | Contracts |
| **Testing** | vitest or jest | latest | Bot unit tests |
| **Target Chain** | Ethereum Sepolia | chainId: 11155111 | POC |
| **Production Chain** | TBD (Arbitrum One likely) | — | Future |

### 18.1 Development Setup

```bash
# 1. Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 2. Clone and set up contracts
cd contracts
forge install

# 3. Set up bot
cd ../bot
npm install

# 4. Copy environment template
cp .env.example .env
# Edit .env — ensure chainId=11155111 and Sepolia RPC
```

---

## 19. Open Design Questions

### Q1: Re-registration After Dispute Removal

**Scenario:** Agent is removed by dispute (gets -95). Later, the agent re-submits to PGTCR and is accepted again.

**Current design:** The old -95 stays. A new +95 is added. `getSummary` returns `average = (-95 + 95) / 2 = 0` (neutral).

**Should we revoke the old -95?** Current decision: **NO**. History accumulates. An agent that was once condemned and then re-accepted should show a mixed record.

**Developer note:** The current Router tracks only ONE feedbackIndex per agentId. After Scenario 2, the stored index points to the -95 entry. If the agent re-submits (new positive), the Router needs to handle this — the `hasFeedback` flag may need refinement for this edge case.

### Q2: Multiple PGTCR Lists

Different PGTCR lists could verify different aspects. These could use different `tag2` values.

**POC scope:** Single list only. `tag2` is always `"kleros-agent-registry"`.

### Q3: Multi-List feedbackIndex Tracking

If Q2 is implemented:

```solidity
// Multi-list (future)
mapping(uint256 agentId => mapping(bytes32 listId => uint64)) public feedbackIndex;
mapping(uint256 agentId => mapping(bytes32 listId => bool)) public hasFeedback;
```

**POC scope:** Single list, simpler single-mapping design.

### Q4: PGTCR Item ↔ 8004 Agent Mapping

See [Section 6.4](#64-pgtcr-item--8004-agent-resolution). POC uses Strategy C (admin mapping).

### Q5: Gas Costs & Batching

On Ethereum Sepolia: negligible (testnet). For high-volume production scenarios, consider batching.

**POC scope:** No batching needed.

### Q6: Multi-Chain Reputation

ERC-8004 is deployed on 20+ chains. For production, reputation should be available on at least Arbitrum + Base.

**POC scope:** Ethereum Sepolia only.

### Q7: Curate v1 vs v2 Arbitrator ⚠️ PENDING

**Status:** JB needs to confirm with his colleague whether this PGTCR instance uses a **Kleros v1** or **Kleros v2** arbitrator.

**This affects:**
- Which arbitrator contract the disputes are sent to
- Which subgraph indexes the dispute outcomes (v1 and v2 have different subgraphs)
- Whether we can cross-reference dispute outcomes from the Kleros v2 subgraph
- The `arbitratorExtraData` format (differs between v1 and v2)

**Impact on the bot:**
- If v1: disputes are on the legacy Kleros Court, evidence/rulings indexed separately
- If v2: disputes are on Kleros Core v2, integrated with the newer dispute resolution system

**Action required:** Confirm with the colleague who deployed the PGTCR at `0x3162df9669affa8b6b6ff2147afa052249f00447`. Check the `arbitrator` field in the Registry subgraph entity or call `PermanentGTCR.arbitrator()` on-chain.

### Q8: Subgraph Endpoint

The PGTCR subgraph endpoint is currently behind the DEX-8004 app API. The exact URL is TBD — colleague will provide. The bot architecture is designed to consume any standard GraphQL endpoint matching the schema in [Section 8](#8-pgtcr-subgraph-schema).

---

## 20. Success Criteria

The POC is considered complete when all of the following are verified on **Ethereum Sepolia**:

| # | Criterion | Verification Method |
|---|---|---|
| 1 | Kleros registered as 8004 agent | `IdentityRegistry.ownerOf(klerosAgentId)` returns Kleros admin address |
| 2 | Router deployed and configured | `Router.reputationRegistry()`, `Router.klerosAgentId()` return correct values |
| 3 | Bot address authorized | `Router.authorizedBots(botAddress)` returns true |
| 4 | **Scenario 1:** Positive feedback | `getSummary(agentId, [router], "", "")` returns `count=1, value=95` |
| 5 | **Scenario 2:** Negative feedback | `getSummary(agentId, [router], "", "")` returns `count=1, value=-95` |
| 6 | **Scenario 3:** Revocation works | `getSummary(agentId, [router], "", "")` returns `count=0` |
| 7 | IPFS evidence pinned | Evidence JSON accessible at the `feedbackURI` |
| 8 | Tag filtering works | `getSummary` with tag1="curate-verified" vs "curate-removed" returns filtered results |
| 9 | Bot detects changes OR manual trigger works | Live subgraph polling or manual script execution |
| 10 | All unit tests pass | `forge test` exits with 0 |
| 11 | DEX-8004 shows reviews | Feedback visible in the Reviews section of an agent page |

### Stretch Goals (Not Required for POC)

- [ ] Bot running continuously, processing live PGTCR events from subgraph
- [ ] Multiple agents registered and tracked simultaneously
- [ ] DEX-8004 reviews section fully integrated with Router feedback
- [ ] Multi-chain deployment (Sepolia + Arbitrum Sepolia)
- [ ] Resolved Q7 (v1 vs v2 arbitrator) with cross-referenced dispute data

---

## Appendix A: getSummary Math

The `getSummary()` function in the 8004 ReputationRegistry computes a simple arithmetic average:

1. **Filter:** Select all feedback entries for the given `agentId` where:
   - `clientAddress` is in the provided `clientAddresses` array
   - `tag1` matches (if non-empty)
   - `tag2` matches (if non-empty)
   - `isRevoked` is `false`

2. **Normalize:** Each matching feedback value is normalized to 18 decimals (WAD):
   ```
   normalizedValue = value * 10^(18 - valueDecimals)
   ```

3. **Aggregate:**
   ```
   sum = Σ normalizedValue
   count = number of matching entries
   summaryValue = sum / count    (integer division in WAD)
   ```

4. **Scale:** The result is scaled to the mode (most common) `valueDecimals` among matching entries.

**Example with our use case (value=95, decimals=0):**
- Value +95 normalized: `95 * 10^18 = 95e18`
- Value -95 normalized: `-95 * 10^18 = -95e18`
- Single entry of +95: `average = 95e18 / 1 = 95e18`, scaled back to decimals=0 → `summaryValue = 95`
- After revoke+negative: `average = -95e18 / 1 = -95e18`, scaled → `summaryValue = -95`

---

## Appendix B: Reputation Arithmetic Walkthrough

Walking through the complete lifecycle of an agent's Kleros reputation:

### Agent Registers on PGTCR → Gets +95

```
Feedback entries: [(+95, curate-verified, NOT revoked)]
getSummary → count=1, value=+95
Interpretation: "Kleros verifies this agent (stake locked, challengeable) — high confidence"
```

### Agent Challenged + Loses → Gets -95

```
Feedback entries: [
  (+95, curate-verified, REVOKED),     ← old positive revoked
  (-95, curate-removed, NOT revoked)   ← new negative added
]
getSummary → count=1, value=-95
Interpretation: "Kleros condemned this agent (removed by human jurors)"
```

### Agent Voluntarily Withdraws → Neutral

```
Feedback entries: [
  (+95, curate-verified, REVOKED)      ← positive revoked, nothing added
]
getSummary → count=0, value=0
Interpretation: "No Kleros opinion (agent withdrew voluntarily, unverified)"
```

### Agent Re-registers After Dispute → Mixed Record

```
Feedback entries: [
  (+95, curate-verified, REVOKED),     ← from first registration, revoked during dispute
  (-95, curate-removed, NOT revoked),  ← from dispute loss
  (+95, curate-verified, NOT revoked)  ← from re-registration
]
getSummary → count=2, value=0
Interpretation: "Mixed record — was condemned once (-95), re-verified once (+95). Average = 0."
```

This gives consumers rich signal. A `count=2, value=0` agent is very different from a `count=0, value=0` agent (never evaluated) or a `count=1, value=+95` agent (clean record).

---

## Appendix C: Value Encoding Rationale

### Why 95 (not 1 or 100)?

**v1 design** used binary ±1. **v2** uses ±95 for the following reasons:

1. **Composability with 0–100 scale:** The curation policy defines acceptance criteria using a 0–100 scoring convention (e.g., "Average score ≥ 90/100"). Using 95 aligns the Kleros signal with this scale so `getSummary()` results are directly interpretable.

2. **Not 100:** 100 implies absolute perfection. Kleros human verification is strong but not infallible — 95 represents "very high confidence, human-verified" while leaving headroom.

3. **Composability with other feedback:** Other ERC-8004 feedback providers may use the `starred` tag system on the same 0–100 scale. A Kleros +95 composes naturally with, say, a user review of +80 or a protocol attestation of +90, producing meaningful weighted averages.

4. **Symmetric negative:** -95 for removal by dispute is equally strong in the negative direction. A single Kleros condemnation dominates the reputation summary.

5. **Integer simplicity:** `valueDecimals = 0` means no fractional math. 95 and -95 are clean integers that work directly in the WAD-based `getSummary()` aggregation.

---

*End of PRD v2. This document contains everything needed to build the Kleros Reputation Oracle from scratch. It supersedes v1.0 with updated chain targets (Ethereum Sepolia), value encoding (±95), full PermanentGTCR contract reference, subgraph schema, curation policy, and DEX-8004 integration context. Questions that arise during implementation should be resolvable from the information above — if not, escalate to JB (@JayBuidl).*
