# Phase 6: IPFS Evidence - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the inline `data:application/json;base64,...` feedbackURI used in v1 with `ipfs://<CID>` by uploading evidence JSON to Pinata before transaction submission. The evidence schema is unchanged — only the URI transport differs. Scenario 3 (voluntary withdrawal, revoke-only) bypasses IPFS since `revokeFeedback(oldIndex)` takes no URI argument.

**In scope:**
- New `bot/src/ipfs.ts` module: native-fetch-based Pinata JSON pinning via `pinJSONToIPFS` REST endpoint
- Split `executeActions()` in `bot/src/chain.ts` into a prepare pass (all IPFS uploads) and an execute pass (all on-chain txs)
- Classification of Pinata failures into the Phase 5 `ExecuteActionsResult` failure taxonomy
- Optional `PINATA_JWT` in config schema with redaction; graceful skip when absent for scenarios that need evidence
- Structured logging of uploads (CID, size, duration, Kleros CDN URL) per Phase 4 conventions

**Out of scope:**
- Pinata SDK (`pinata` / `@pinata/sdk` / `pinata-web3`) — forbidden by REQUIREMENTS.md
- `data:` URI fallback on IPFS failure — REQUIREMENTS.md explicitly rejects this
- Retries on transaction submission — Phase 5 `writeContract` is NEVER retried
- CID verification / gateway read-back from the bot
- Changes to the evidence schema — it was frozen in Phase 2 D-13
- Pinata groups, file uploads, `pinFileToIPFS` — JSON pinning only

</domain>

<decisions>
## Implementation Decisions

### URI transport (locked by roadmap success criteria + prior discussion)
- **D-01:** `feedbackURI` written to chain is `ipfs://<CID>` — roadmap SC-1. Not `https://cdn.kleros.link/ipfs/<CID>`. The Kleros CDN URL is used only in log output and operator tooling.
- **D-02:** Evidence JSON schema is `kleros-reputation-oracle/v1` (unchanged from Phase 2 D-13). No schema modifications. IPFS-02 is satisfied by reusing `buildPositiveEvidence()` / `buildNegativeEvidence()` from `bot/src/evidence.ts`.
- **D-03:** `buildFeedbackURI(evidence)` in `bot/src/evidence.ts` changes signature from `(evidence) => data:...` to `(cid: string) => \`ipfs://${cid}\``. The old base64 encoding is removed.
- **D-04:** Scenario 3 (voluntary withdrawal, revoke-only) skips IPFS upload entirely. `revokeFeedback(oldIndex)` takes no URI argument, so there is nothing to upload.

### Pinata upload implementation (no SDK)
- **D-05:** New module `bot/src/ipfs.ts` exporting `uploadEvidenceToIPFS(evidence, metadata, jwt, timeoutMs)`.
- **D-06:** Transport is native `fetch` against `POST https://api.pinata.cloud/pinning/pinJSONToIPFS`. No `pinata` npm package, no `node-fetch`, no axios. Node 22 `fetch` is stable and used as-is.
- **D-07:** Request body shape: `{ pinataContent: <evidence JSON>, pinataMetadata: { name, keyvalues } }`. Authorization header: `Bearer ${PINATA_JWT}`. Content-Type: `application/json`.
- **D-08:** Response parsing: `{ IpfsHash, PinSize, Timestamp }` → construct `ipfs://${IpfsHash}` as the feedbackURI. Kleros CDN URL for logs: `https://cdn.kleros.link/ipfs/${IpfsHash}`.
- **D-09:** Upload is serial (one item at a time, no `Promise.allSettled`). Low action counts per run (typical 0–2) don't justify concurrency risk/complexity.
- **D-10:** CID version: Pinata default (CIDv0, `Qm...` prefix). Not opting into `cidVersion: 1` at this stage — decision revisitable if gateway/consumer compat becomes an issue.

### Prepare/execute split in chain.ts
- **D-11:** `executeActions()` is restructured into two sequential passes:
  1. **Prepare pass:** iterate actions needing evidence (Scenario 1, Scenario 2). Build evidence object once (`createdAt` captured at this point — WR-01 invariant preserved from Phase 5). Call `uploadEvidenceToIPFS`. On success, attach `{feedbackURI, cid}` to the action. On per-item failure, log and mark the action as skipped with classified reason. Scenario 3 actions pass through unchanged.
  2. **Execute pass:** iterate prepared actions (those not skipped) and run existing gas-estimate → writeContract → waitForReceipt flow with the already-built `feedbackURI`.
- **D-12:** Evidence `createdAt` is captured during the prepare pass and re-used identically in both the uploaded JSON and the on-chain calldata. A fresh `new Date().toISOString()` is NOT called during the execute pass. This preserves the Phase 5 WR-01 invariant (gas estimate calldata === submission calldata).
- **D-13:** Already-built evidence object is the source of truth for both IPFS content and on-chain URI — not re-built from params in execute.

### Failure policy — per-item
- **D-14:** Pinata upload timeout: 30 seconds via `AbortController`. Configurable via env `PINATA_TIMEOUT_MS` (optional, default 30000) in the same pattern as `TX_RECEIPT_TIMEOUT_MS`.
- **D-15:** Retry policy within a single upload: **one retry on 5xx only**. 4xx responses (auth 401/403, bad request 400) → immediate skip, no retry (retrying won't help — these are deterministic). 429 rate-limit → treated as 5xx class for retry purposes (one retry). Network errors (TypeError from fetch, AbortError from timeout) → no retry (align with Phase 5's "transient/revert" dichotomy — network issues are ambiguous, next run re-diffs anyway).
- **D-16:** Per-item upload failure behavior: log the error at warn level with `error_class + agentId + pgtcrItemId + scenario + actionIndex`, mark the action as skipped with a new failure reason `"ipfs-upload-failed"`, continue the prepare pass. Execute pass proceeds with the remaining successfully prepared actions.

### Failure policy — systemic escalation
- **D-17:** After **3 consecutive upload failures** within a single run, the bot escalates to systemic failure with reason `"pinata-unavailable"`. Remaining prepare items are skipped, execute pass is NOT entered, bot exits with code 1. This matches Phase 5's differentiated failure philosophy (`systemicFailure` → exit 1 → scheduler re-runs).
- **D-18:** Consecutive counter resets on a successful upload (prepare pass is resilient to transient blips as long as recovery happens within 3 attempts).
- **D-19:** Auth errors (401/403) are deterministic and affect all subsequent uploads equally. An auth error on the very first attempt should still count toward the consecutive threshold — no special-case short-circuit. This keeps the state machine simple; the 3-upload cost is acceptable for clear operator signal.

### Error classification (4 classes)
- **D-20:** Pinata errors are classified into four classes aligned with Phase 5's `isRevertError` / `isTransientError` split:
  - `auth` — HTTP 401, 403
  - `rate-limit` — HTTP 429
  - `server` — HTTP 5xx
  - `network` — fetch `TypeError`, `AbortError` (timeout), any other non-HTTP failure
- **D-21:** Each failure log includes the `error_class` field as a top-level key (not nested in the error object) so pino structured-search can filter by class. Redacted Pinata response body on 4xx for operator debug context (keep small — truncate to 500 chars).

### Shutdown behavior
- **D-22:** SIGTERM/SIGINT during the **prepare pass**: check `shutdownHolder.shutdown` between uploads. On signal: abort any in-flight upload via its `AbortController`, skip remaining uploads, **skip execute pass entirely**, exit 0. Already-uploaded CIDs are orphaned on Pinata — acceptable because IPFS is content-addressed (re-upload yields same CID, idempotent) and Pinata pin cost is negligible.
- **D-23:** SIGTERM/SIGINT during the **execute pass**: Phase 5 behavior unchanged (check `shutdown` between actions, clean break, exit 0). Prepared-but-unsent items are re-diffed next run — since the on-chain state hasn't advanced, the next run will re-upload (same CID) and re-submit.
- **D-24:** Orphaned CIDs (uploaded but not submitted due to shutdown or systemic failure) are listed in the run-summary JSON at exit under `orphaned_cids: [cid1, cid2, ...]`.

### Config + secret handling
- **D-25:** New config field `PINATA_JWT: z.string().optional()` in `bot/src/config.ts` (zod v4 pattern, matches existing `hexAddress`/`hexPrivateKey` style).
- **D-26:** When `PINATA_JWT` is undefined: Scenario 1 and Scenario 2 actions are skipped with a warn-level log at the **start of the prepare pass** (one per action, with `reason: "PINATA_JWT not configured"`). Scenario 3 actions proceed normally (no IPFS needed). This satisfies IPFS-05.
- **D-27:** Pino redaction extends to cover `PINATA_JWT` via `redact.paths` — same mechanism Phase 4 D-04 used for `BOT_PRIVATE_KEY`. Config validation error path (zod issue formatter in `loadConfig`) redacts `PINATA_JWT` when it appears in `issue.path` (matching the existing `BOT_PRIVATE_KEY` `[REDACTED]` pattern in `config.ts:32`).
- **D-28:** Kleros CDN base is a hardcoded constant: `const KLEROS_GATEWAY = "https://cdn.kleros.link/ipfs/"` in `bot/src/ipfs.ts`. Not an env var — changing the gateway would be a code change, not a runtime config.

### Pinata metadata
- **D-29:** Upload metadata shape:
  ```
  pinataMetadata: {
    name: "kro-v1/{chainId}/{agentId}/{pgtcrItemId}",
    keyvalues: {
      agentId: "<bigint as string>",
      chainId: "<number as string>",
      pgtcrItemId: "0x<hex>",
      scenario: "verified" | "removed"
    }
  }
  ```
- **D-30:** `keyvalues` enables operator search/filter in the Pinata dashboard ("all pins for agent X", "all 'removed' pins on chain Y"). Small cost, significant audit value.

### Observability
- **D-31:** Per-upload success log line: `{ cid, size, duration_ms, gateway_url, agentId, pgtcrItemId, scenario }` at info level. `gateway_url` is the Kleros CDN URL (clickable for operator verification).
- **D-32:** Per-upload failure log line: `{ error_class, error_message, agentId, pgtcrItemId, scenario, actionIndex, retried }` at warn level (retried = bool, true when the failure is final after one 5xx retry).
- **D-33:** Run summary (LOG-03 JSON at exit) adds these fields to the existing Phase 4 summary shape: `uploads_attempted`, `uploads_succeeded`, `uploads_failed`, `orphaned_cids[]`.

### Testing strategy
- **D-34:** Unit tests for `bot/src/ipfs.ts` in new file `bot/test/ipfs.test.ts` using vitest `vi.mock()` on `globalThis.fetch`. Cover all four error classes plus the retry-on-5xx branch (success after retry, retry-exhausted), plus the `AbortError` timeout path.
- **D-35:** Gated real-Pinata integration test: `test.skipIf(!process.env.PINATA_JWT)` in a separate file (e.g., `bot/test/ipfs.integration.test.ts`). Uploads a throwaway JSON, asserts CID format + content-hash correspondence, then unpins via Pinata `DELETE /pinning/unpin/:cid` endpoint (also native fetch). Runs locally on demand; skipped in CI without secret.
- **D-36:** Extend existing `bot/test/chain.test.ts` to cover the prepare/execute split. Mock `bot/src/ipfs.ts` at module level. Tests: S1 happy path, S2 happy path, S3 bypass (no IPFS call), upload failure → item skip + continue, 3 consecutive failures → systemic exit, `PINATA_JWT` absent → S1/S2 skip but S3 proceeds, SIGTERM during prepare → exit 0 without execute.
- **D-37:** Post-implementation UAT: run Phase 3-style Sepolia E2E with a real `PINATA_JWT` set, verify the tx's `feedbackURI` returned by `getFeedback()` starts with `ipfs://` and the CID resolves to the correct evidence JSON via `https://cdn.kleros.link/ipfs/<CID>`.

### Claude's Discretion
- Exact control-flow structure of the prepare/execute split (single function with two loops, or two extracted helpers — planner's call based on readability vs test surface).
- The `classifyPinataHttpError` / `classifyFetchError` implementation details (enum vs string literals, error subclass vs discriminated union).
- The precise retry backoff delay for the single 5xx retry (probably 1s — planner decides, not architecturally significant).
- Env var name for the timeout (`PINATA_TIMEOUT_MS` preferred for consistency with `TX_RECEIPT_TIMEOUT_MS`).
- Whether to use a separate `prepareActions()` helper or inline the prepare loop in `executeActions()`.
- Whether `ipfs.ts` exports its own `classify*` helpers publicly or keeps them module-private.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Evidence schema (frozen in Phase 2)
- `.planning/research/kleros-reputation-oracle-prd-v2.md` §13 — IPFS evidence schema (kleros-reputation-oracle/v1) reference definition.
- `bot/src/evidence.ts` — Active implementation of the evidence schema; `buildPositiveEvidence()` / `buildNegativeEvidence()` are the authoritative constructors.
- `bot/src/types.ts` — `EvidenceJson` type definition.

### Requirements
- `.planning/REQUIREMENTS.md` §"IPFS Evidence" (IPFS-01 through IPFS-05) — acceptance criteria and out-of-scope list (explicitly bans Pinata SDK, bans data-URI fallback, bans CID verification).
- `.planning/ROADMAP.md` §"Phase 6: IPFS Evidence" — five success criteria (URI prefix, schema match, per-item skip, prepare/execute split, JWT-absent graceful skip).
- `.planning/research/FEATURES.md` §"IPFS Evidence (Medium complexity)" — feature summary, interface sketch, `PINATA_JWT` guidance.

### Prior phase context (constraints we must not break)
- `.planning/phases/02-stateless-bot/02-CONTEXT.md` §"Evidence / feedbackURI" (D-12, D-13) — v1 used data URI; v2 replaces transport only, schema stays frozen.
- `.planning/phases/04-structured-logging/04-CONTEXT.md` §"Claude's Discretion" (D-04) — pino redaction pattern extends to `PINATA_JWT`.
- `.planning/phases/05-transaction-safety/05-CONTEXT.md` — `ExecuteActionsResult` classified-failure shape, `shutdownHolder` shutdown-flag mechanism, WR-01 "build evidence once" invariant in `chain.ts:142`.
- `CLAUDE.md` §"Bot hardening patterns (Phase 5 baseline)" — viem error classification via `err.walk()`, async pino flush, BigInt serialization, differentiated failure policy.

### Current implementation to modify
- `bot/src/chain.ts:142-234` — `executeActions()` current single-pass structure; target of the prepare/execute split.
- `bot/src/evidence.ts:75-79` — `buildFeedbackURI(evidence)` current data-URI implementation; will change signature to accept a CID string.
- `bot/src/config.ts` — zod schema; target for optional `PINATA_JWT` + redaction update.
- `bot/src/logger.ts` — pino redaction config; extend to `PINATA_JWT`.
- `bot/src/types.ts` — `ExecuteActionsResult`, item-failure reason union; add `"ipfs-upload-failed"` and systemic reason `"pinata-unavailable"`.

### External API reference
- Pinata REST API: `https://docs.pinata.cloud/api-reference/endpoint/pin-json-to-ipfs` (public docs; no auth to read).
- Pinata unpin endpoint (used only by integration test): `DELETE https://api.pinata.cloud/pinning/unpin/{CID}`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bot/src/evidence.ts::buildPositiveEvidence()` / `buildNegativeEvidence()` — reused verbatim in the prepare pass. No changes to schema construction.
- `bot/src/evidence.ts::formatStake()` — private helper, untouched.
- `bot/src/logger.ts` — pino instance with redaction; extend `redact.paths` to cover `PINATA_JWT`.
- `bot/src/tx.ts::estimateGasWithRetry` — same retry-with-backoff pattern is a template for the optional one-shot 5xx retry (though simpler — only one retry, no exponential ladder).
- Phase 5 `ExecuteActionsResult` shape in `bot/src/types.ts` — extended with new failure reasons rather than rewritten.

### Established Patterns
- **Differentiated failure policy (Phase 5):** item-specific failures → skip + continue, systemic failures → exit 1. Phase 6 extends this: IPFS item-upload failure = item-specific, 3-consecutive or auth failure = systemic.
- **Build evidence once per action (Phase 5 WR-01):** the prepare pass builds evidence once with a captured `createdAt`; execute pass reuses without rebuilding. The WR-01 invariant becomes even more important here — the IPFS content and on-chain URI must be derived from the same evidence object.
- **Zod optional config with defaults (Phase 5):** `z.coerce.bigint().optional().default(5_000_000_000_000_000n)` is the pattern for `PINATA_TIMEOUT_MS`. `PINATA_JWT: z.string().optional()` (no default — absence is a valid state).
- **Pino structured logging (Phase 4):** `logger.warn({ error_class, agentId, ... }, "ipfs-upload-failed")` — context fields first, message second. Redacted secrets automatically.
- **Vitest mock pattern:** `vi.mock("./module.js")` at file top, `vi.mocked(fn).mockResolvedValue(...)` per test. Phase 5's `chain.test.ts` is the template.
- **Async pino flush (Phase 5):** `flushAndExit()` helper in `bot/src/index.ts` handles exit with pino v10's callback-based flush. Phase 6 systemic-failure exit path reuses it.

### Integration Points
- `bot/src/chain.ts::executeActions()` — site of the prepare/execute split. New helper/loop structure internal to this function or extracted.
- `bot/src/index.ts` — thin orchestrator; already loops over actions via `executeActions()`. No changes expected beyond potential run-summary extensions.
- `bot/src/types.ts::ExecuteActionsResult` — extend the `reason` discriminated union with `"ipfs-upload-failed"` (item) and `"pinata-unavailable"` (systemic).
- `bot/src/config.ts::loadConfig()` — zod issue path redaction already handles `BOT_PRIVATE_KEY`; add `PINATA_JWT` to the `issue.path.includes(...)` check.

</code_context>

<specifics>
## Specific Ideas

- User emphasized: "Instead of fetching from Pinata IPFS, we want to use our Kleros CDN: `https://cdn.kleros.link/ipfs/<CID>`" — interpreted as the gateway URL for reading/browsing, not the on-chain URI format. On-chain remains `ipfs://` per ROADMAP SC-1.
- User prefers keeping upload serial to avoid Pinata rate-limit bursts; simpler state machine for the consecutive-failure counter.
- User confirmed the `createdAt` invariant must be preserved across prepare and execute (Phase 5 WR-01 carries through).
- User confirmed Pinata metadata should be structured (not just a name) for operator audit via Pinata dashboard.
- User asked for a concrete walkthrough of the no-SDK upload path before proceeding — the native-fetch approach is ~60 LOC including error classification, replacing ~230 transitive deps from the `pinata` package.

</specifics>

<deferred>
## Deferred Ideas

- **CIDv1 opt-in (`cidVersion: 1`)** — stays CIDv0 for v1.1. Revisit if consumers complain about CIDv0 gateway compat, or if Kleros CDN has a preference.
- **Pinata groups for operational organization** — group ID per deployment (sepolia-v1, mainnet-v1) for bulk management. Future operator tooling concern, not needed for v1.1.
- **`PINATA_GATEWAY` env var (configurable gateway)** — hardcoded Kleros CDN is sufficient. If Kleros CDN ever has an outage affecting operator UX, swap the constant in code.
- **CID verification after upload** — Pinata propagation delay makes this flaky; operator can re-verify via Kleros CDN externally. Out of scope per REQUIREMENTS.md.
- **Per-upload correlation IDs** — nice-to-have operability feature, can be added later without breaking changes.
- **`p-retry` or other retry libraries** — the one-shot 5xx retry is ~5 LOC; no dependency justified.
- **Pin rotation / unpin of old CIDs on revocation** — once a feedback is revoked, its CID is no longer on-chain-referenced. Leaving the pin on Pinata costs negligible storage; cleanup is a future operator tool, not bot scope.
- **Exponential backoff on the upload retry** — single retry with fixed 1s delay is sufficient for v1.1; escalate if production shows specific retry patterns benefit from backoff.
- **Progressive failure thresholds per error class** — e.g., "3 rate-limits escalates" vs "1 auth escalates immediately". Current uniform 3-consecutive rule is simpler; revisit after production signal.

</deferred>

---

*Phase: 06-ipfs-evidence*
*Context gathered: 2026-04-21*
