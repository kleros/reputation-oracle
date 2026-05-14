# Kleros Reputation Oracle

Work style: telegraph; noun-phrases ok; drop filler/grammar; min tokens

## Git

Commits require GPG passphrase (interactive — will hang). Always use `-c commit.gpgsign=false` and append `Co-Authored-By: Claude <noreply@anthropic.com>` to commit messages.

## Lint enforcement (Stop hook)

`.claude/hooks/lint-check.sh` runs at end-of-turn. Blocks Stop + feeds stderr back if either fails:
- `cd bot && npm run lint` — `biome check .` (must be 0 errors; warnings don't block)
- `cd contracts && forge fmt --check` — any diff blocks

Silent on success. Loop-guards via `stop_hook_active` (exits 0 on retry so you can always end the turn).

**Fix order when it fires:**
1. `cd bot && npm run lint:fix` — safe Biome auto-fixes (organize imports, reflow, remove safe-unsafe dead imports)
2. `cd contracts && forge fmt` — Solidity formatting
3. Remaining findings need manual judgment:
   - **Never** `biome check --write --unsafe` blindly — some "unsafe" fixes change runtime semantics (e.g. `!` → `?.` in `walletClient.account!.address` would break the hot path).
   - For correct `!` assertions: `// biome-ignore lint/style/noNonNullAssertion: <specific reason>` (rationale required by Biome).
   - For viem mock typing: use `makeReceipt()`/`makeAction()`/`makeIpfsResult()` factory pattern in `bot/test/chain.test.ts` — centralize one `as Type` cast inside the helper, never `as any` at call sites.

**Project baseline (as of 2026-04-23):** Biome reports **zero findings** across `bot/`. Any new warning means you introduced it — fix before committing, don't defer.

## Project

Converts Kleros PGTCR (Stake Curate) curation events → ERC-8004 on-chain reputation feedback.
Three components: **Router contract** (Solidity), **Bot** (TypeScript), **Kleros 8004 Identity** (one-time setup).
Target: Ethereum Sepolia (chainId 11155111). Tooling: Foundry, viem, Biome.js, vitest.

## Architecture

```
PGTCR subgraph (GraphQL) → Bot (TS) → Router.sol → 8004 ReputationRegistry
```

Bot reads PGTCR state from Goldsky subgraph + Router state from chain, diffs, calls Router.
Router is the `clientAddress` for 8004 ReputationRegistry. Bot NEVER calls ReputationRegistry directly.

## Three scenarios (entire business logic)

| # | Trigger | Router calls |
|---|---------|--------------|
| 1 | Item Submitted/Reincluded, no feedback yet | `giveFeedback(agentId, 95, 0, "verified", "kleros-agent-registry", "", ipfsCID, 0x0)` |
| 2 | Item Absent + disputeOutcome=Reject, has feedback | `revokeFeedback(oldIndex)` then `giveFeedback(agentId, -95, 0, "removed", ...)` |
| 3 | Item Absent + voluntary withdrawal, has feedback | `revokeFeedback(oldIndex)` — no new feedback |

Revoke-then-negative (Scenario 2) ensures `getSummary` = -95, not average of (+95,-95) = 0.

**Per-agentId invariant (load-bearing — see [`MULTIPLE_ITEMS_SAME_AGENT_1436_BUG.md`](./MULTIPLE_ITEMS_SAME_AGENT_1436_BUG.md)):** `computeActions()` MUST emit at most ONE action per agentId per run. Group items by `agentId` first, then decide. Do NOT iterate items independently — the same agentId can have multiple PGTCR items (one Absent from a failed first attempt + one Submitted from a re-registration), and the Router has no per-itemId memory (`feedbackType[agentId]` is the only key). Per-item iteration over the same agentId caused the agent-1436 incident: ~400 oscillating revoke/positive txs over 17 hours. Live items (Submitted/Reincluded) win; Absent items in the same group are historical and ignored. The `reject+resubmit race detected` warn log fires when an Absent/Reject co-exists with a live item — that signal triggers revisit of the deferred handling path (see `OPEN_QUESTIONS.md`).

## Don't do

- **No local DB/persistence.** No SQLite, no files, no checkpoints. Stateless diff engine.
- **No eligibility engine/age thresholds.** PGTCR `submissionPeriod` already handles this.
- **No configurable feedback values.** ±95, decimals 0, tags — all constants in Router contract.
- **No multi-chain routing in one process.** One deployment per chain, chain = env vars.
- **No daemon mode.** One-shot run, external scheduler invokes. No `while(true)`.
- **No mock-call-ordering tests.** Test boundaries (subgraph, contracts), not wiring.
- **No `as any` anywhere.** Biome's `noExplicitAny` is enforced; the Stop hook blocks on errors. Use typed factories for mocks (`makeReceipt`, `makeAction` in `bot/test/chain.test.ts`) or `as unknown as T` in a single helper (see `makeMockPublicClient`) — never `as any` at call sites.

## Key design decisions

- Stateless diff: read subgraph + Router → `computeActions()` pure function → execute → exit.
- Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) for batched `hasFeedback()` reads.
- Subgraph pagination: `id_gt` cursor, NOT `skip` (degrades >5000). Fetch ALL items incl. Absent.
- Agent resolution: Strategy A — `metadata.key0` = numeric agentId, `metadata.key2` = CAIP-10 chain validation.
- Tags: `tag1` = semantic signal (`verified`/`removed`), `tag2` = source identifier (`kleros-agent-registry`).
- Evidence JSON (off-chain, IPFS): minimal — `schema/agentRegistry/agentId/clientAddress/createdAt/value/valueDecimals/tag1/tag2/text/kleros{}`. **No `title`, no `endpoint`** — non-standard, no 8004 consumer reads them. PRD §13 lists them; PRD predates v1.0, GSD wins. Schema string stays `kleros-reputation-oracle/v1` for additive changes.
- Router upgradeable via UUPS proxy (OpenZeppelin) with storage gaps for future multi-list/multi-product.
- Kleros v1 arbitrator on Ethereum. PGTCR list supports CAIP-10 multi-chain item registrations.
- Re-registration after dispute: history accumulates, no revoke of old negative.

## Bot hardening patterns (Phase 5 baseline — apply to any bot change)

- **viem v2 error classification:** use `err.walk(e => e instanceof X)` — NEVER direct `instanceof`. Top-level throws from `estimateContractGas`/`writeContract` are wrapped in `ContractFunctionExecutionError`; the inner typed error is nested. Helpers in `bot/src/tx.ts`: `isRevertError`, `isTransientError`.
- **pino v10 flush is async:** use callback form `logger.flush(cb)` before `process.exit`. Bare `flush()` + `exit()` drops buffered lines. `pino.final()` was removed in v10. See `flushAndExit()` helper in `bot/src/index.ts`.
- **zod v4 bigint:** `z.coerce.bigint()` with bigint-literal default: `.default(5_000_000_000_000_000n)` — `n` suffix required.
- **Nonce after revert:** a reverted on-chain tx STILL consumes a nonce. Always `nonce++` after every mined tx regardless of `receipt.status`. (CR-01 in 05-REVIEW.md — skipping this nonce increment cascades to nonce-too-low errors.)
- **Build evidence once per action:** `new Date().toISOString()` drifts between gas estimation and submission. Construct `feedbackURI` once before the gas-estimate block in `chain.ts`, reuse for `writeContract`.
- **BigInt stays BigInt in serialization:** `agentId`, `stake`, and any uint256 values must serialize as decimal strings (`.toString()`), never `Number()`. ERC-8004 agent IDs can exceed 2^53.
- **Differentiated failure policy:** `executeActions` returns `ExecuteActionsResult` (never throws for classified errors). Item-specific failures (gas revert, submission revert, receipt revert, gas exhausted) → skip + continue. Systemic failures (receipt timeout/null, non-revert submission error, balance below threshold) → return `systemicFailure` reason, `index.ts` exits 1. See `bot/src/chain.ts` and `.planning/phases/05-transaction-safety/05-CONTEXT.md` D-01..D-20 for the full taxonomy.
- **`writeContract` is NEVER retried.** Retries on submission create duplicate txs with different nonces. Gas estimation retries are capped at 3 attempts and only for transient (not revert) errors.
- **Signal handlers set a flag, never call `process.exit`:** SIGTERM/SIGINT set `shutdownHolder.shutdown = true`. Main loop checks between actions. `process.exit` only inside `flushAndExit`'s pino callback.
- **Fetch error-body parsing: text first, JSON.parse second.** Never `response.json()` with `response.text()` as fallback — `json()` consumes the stream and the catch's `text()` finds it locked, yielding silent `(unreadable body)` logs. Pattern: `const raw = await response.text().catch(() => "")` → check empty → `try { JSON.parse(raw) } catch { errorBody = raw }`. Also: when parsing structured error shapes like Pinata's `{error:{reason,details}}`, type-check before stringifying (`typeof e === "object"` → join fields explicitly) — otherwise `error ?? JSON.stringify(json)` coerces an object to `[object Object]`. The Pinata parser at `bot/src/ipfs.ts` is the canonical implementation. Incident: weeks of `Pinata 403: (unreadable body)` logs hid the real `Account blocked due to plan usage limit` message — quick task `260514-1j6` fixed both bugs.

## Subgraph endpoints

- Sepolia: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn`
- Mainnet: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-mainnet/v0.0.1/gn`
- PGTCR contract (Sepolia): `0x3162df9669affa8b6b6ff2147afa052249f00447`

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Status:** v1.0 shipped (2026-03-27). Live on Sepolia. v1.1 Production Hardening in progress — Phases 4 (Structured Logging) + 5 (Transaction Safety) complete; Phase 6 (IPFS Evidence) remaining.

**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents — the first reputation oracle where feedback is backed by real economic stake (WETH bonds) and human jury rulings.

See `.planning/PROJECT.md` for full project context, requirements, constraints, and key decisions.
See [`contracts/README.md`](./contracts/README.md) for deployed addresses and deployment guide.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Solidity | ^0.8.20 | Router contract |
| Foundry | latest | Contract dev, test, deploy (`forge test --fork-url` for integration) |
| TypeScript | ^5.7 | Bot language (viem requires strict TS) |
| Node.js | 22 LTS | Runtime (native `--env-file`, stable fetch) |
| viem | ^2.47 | Ethereum client (type-safe, native Multicall3) |
| pino | ^10.3 | Structured JSON logging to stderr, secret redaction, child loggers |
| zod | ^4.3 | Config validation with secret redaction |
| graphql-request | ^7.4 | Subgraph queries |
| tsx | ^4.21 | TypeScript execution |
| @openzeppelin/contracts | ^5.6 | UUPS proxy for upgradeable Router |
| Biome.js | ^2.4 | Linting + formatting (replaces ESLint + Prettier) |
| vitest | ^4.1 | Bot unit/integration tests |

**Do NOT use:** ethers.js v5 (deprecated), dotenv (Node 22 has `--env-file`), hardhat (use Foundry), axios (use native fetch), any local DB (stateless architecture), transparent proxy (use UUPS), console.log/warn/error (use pino logger from `bot/src/logger.ts`).

See `.planning/research/STACK.md` for full rationale, alternatives, and version compatibility.
<!-- GSD:stack-end -->

## Skills (when to use which)

| Skill | Use for |
|-------|---------|
| `.claude/skills/pgtcr-stake-curate-skill.md` | PGTCR operations: GraphQL queries, ABI fragments, subgraph endpoints, item status logic, tx patterns |
| `8004scan-skill:8004` | ERC-8004 protocol deep-dive: feedback struct, trust labels, value scales, revocation, SDK recipes |
| `8004scan-skill:8004scan` | 8004scan API: search agents, query feedback, lookup by owner, platform stats |
| `ethskills:standards` | Broader Ethereum standards context: x402 payment protocol, EIP-3009, EIP-7702, how ERC-8004 fits the ecosystem |
| `ethskills:indexing` | Subgraph fundamentals, Multicall3 with viem, event design, pagination, alternative indexing solutions |

## Document hierarchy

**Authoritative (current):**
- `CLAUDE.md` (this file) — architecture, conventions, constraints
- `.planning/PROJECT.md` — project context, validated requirements, key decisions
- `deploy/RUNBOOK.md` — VPS ops: bootstrap, secret fill, dry-run, timer enable, update/rollback, Betterstack alerts (§9), burn-in gate (§10)

**v1.0 planning artifacts (archived, read-only):**
- `.planning/milestones/v1.0-REQUIREMENTS.md` — v1 requirements with final status
- `.planning/milestones/v1.0-ROADMAP.md` — v1 phase details and plans
- `.planning/phases/*/XX-CONTEXT.md` — locked implementation decisions per phase

**Historical reference (read-only):** The PRD predates the GSD project setup. It contains useful background and rationale but is **not authoritative** — several details (tag values, state tracking model, atomicity decisions) were revised during GSD context gathering. When the PRD contradicts GSD artifacts, GSD artifacts win.
- `.planning/research/kleros-reputation-oracle-prd-v2.md` (2000+ lines, read by section)
- `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md`

### PRD section index (for background reading)

| §  | Topic |
|----|-------|
| 2  | Solution overview, value encoding |
| 3  | Architecture, component summary |
| 5  | Deployed addresses |
| 6  | Mapping logic, 3 scenarios, resolution strategies |
| 7  | PermanentGTCR contract reference |
| 8  | PGTCR subgraph schema (GraphQL) |
| 11 | Router contract full spec |
| 12 | Bot spec (config, polling, diff) |
| 13 | IPFS evidence schema |
| 14 | Kleros 8004 identity setup |
| 16 | Testing plan |
| 17 | File structure |
| 19 | Open design questions (many resolved in GSD CONTEXT.md files) |
| 20 | Success criteria |

<!-- GSD:conventions-start source:CONVENTIONS.md -->
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Generated by GSD from session_analysis. Run `/gsd:profile-user --refresh` to update.

| Dimension | Rating | Confidence |
|-----------|--------|------------|
| Communication | conversational | HIGH |
| Decisions | fast-intuitive | MEDIUM |
| Explanations | concise | HIGH |
| Debugging | diagnostic | MEDIUM |
| UX Philosophy | full-stack | MEDIUM |
| Vendor Choices | opinionated | MEDIUM |
| Frustrations | instruction-adherence | MEDIUM |
| Learning | guided | MEDIUM |

**Directives:**
- **Communication:** Conversational tone. Address all parts of multi-part messages. No excessive formality.
- **Decisions:** Concise options, expect quick decisions. Confirm or challenge leanings directly.
- **Explanations:** Telegraphic style. Key decisions + brief rationale. No preambles.
- **Debugging:** Root cause alongside fix. Share diagnostics and reasoning.
- **UX Philosophy:** Full-stack perspective. Proactively suggest UI/UX improvements when relevant.
- **Vendor Choices:** Respect stated tool preferences. Use what project docs specify. Don't substitute without asking.
- **Frustrations:** Follow instructions precisely. Read project docs before acting. Ask, don't guess.
- **Learning:** Explain new concepts through dialogue. Anchor in existing project patterns.
<!-- GSD:profile-end -->
