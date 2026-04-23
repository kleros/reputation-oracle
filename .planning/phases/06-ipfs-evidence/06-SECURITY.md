---
phase: 6
slug: ipfs-evidence
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-23
---

# Phase 6 — IPFS Evidence Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| env vars → zod schema | PINATA_JWT arrives from process.env — untrusted raw string | JWT secret string |
| bot → Pinata API | Outbound HTTPS POST to api.pinata.cloud; JWT in Authorization header; response body is untrusted | Evidence JSON (public), JWT (secret), CID (public) |
| CID string → on-chain URI | CID returned from Pinata upload result; passed to buildFeedbackURI; embedded in contract calldata | CID string (public, content-addressed) |
| prepare pass → execute pass | PreparedAction carries pre-built feedbackURI; execute pass must not rebuild it | feedbackURI string, EvidenceJson (public) |
| integration test → Pinata API | Real outbound HTTP for gated test; JWT from env; cleanup via DELETE /unpin | JWT secret (env-gated), CID (public) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-06-01-01 | Information Disclosure | config.ts zod error output | mitigate | PINATA_JWT redacted as `[REDACTED]` in safeIssues — same pattern as BOT_PRIVATE_KEY | closed |
| T-06-01-02 | Information Disclosure | logger.ts redact paths | accept | PINATA_JWT already present in redact.paths; no code change needed | closed |
| T-06-01-03 | Tampering | RunSummary serialization | accept | orphanedCids is string[] of CIDs — no PII; content-addressing makes CIDs non-sensitive | closed |
| T-06-02-01 | Information Disclosure | Authorization header | mitigate | JWT passed as `Bearer ${jwt}` in header; pino redact.paths covers `Authorization` and `PINATA_JWT` in logger.ts | closed |
| T-06-02-02 | Information Disclosure | Pinata error response body | mitigate | Error body truncated to 500 chars; pino sanitizeObject regex strips `Bearer <token>` patterns | closed |
| T-06-02-03 | Denial of Service | Upload timeout | mitigate | AbortController with configurable cap (PINATA_TIMEOUT_MS, default 30s) prevents runaway uploads | closed |
| T-06-02-04 | Tampering | Evidence content | accept | IPFS content-addressing: CID is SHA2-256 hash; any tampering produces a different CID that won't match the on-chain URI | closed |
| T-06-02-05 | Elevation of Privilege | Pinata JWT scope | mitigate | Only `pinJSONToIPFS` endpoint used; no unpin/admin calls from bot; minimal JWT scope by design | closed |
| T-06-03-01 | Tampering | buildFeedbackURI output | accept | IPFS content addressing: a modified CID points to different/nonexistent content — not exploitable | closed |
| T-06-03-02 | Tampering | createdAt drift (WR-01) | mitigate | buildFeedbackURI receives only the CID; evidence built once in chain.ts prepare pass with fixed createdAt | closed |
| T-06-03-03 | Repudiation | data: URI removal | accept | data: URIs were not on-chain-verifiable; ipfs:// URIs are IPFS-addressable and content-verifiable — improves auditability | closed |
| T-06-04-01 | Tampering | WR-01 invariant | mitigate | Evidence built once in prepare pass; execute pass receives PreparedAction.feedbackURI — never calls buildPositiveEvidence/buildNegativeEvidence again | closed |
| T-06-04-02 | Denial of Service | 3-consecutive-failure escalation | mitigate | consecutiveFailures counter resets on success; 3-threshold triggers systemicFailure="pinata-unavailable" and exits without entering execute pass | closed |
| T-06-04-03 | Information Disclosure | PINATA_JWT in chain.ts | mitigate | JWT passed directly to uploadEvidenceToIPFS() — never assigned to a logged variable; pino redact.paths covers it in any log object | closed |
| T-06-04-04 | Availability | Nonce tracking during prepare/execute split | accept | Prepare pass makes zero on-chain calls; nonce is fetched once at start of execute pass — no change needed from Phase 5 | closed |
| T-06-04-05 | Repudiation | orphanedCids logging | accept | CIDs uploaded but not submitted are logged in run summary; idempotent re-upload on next run produces same CID (IPFS content addressing) | closed |
| T-06-05-01 | Information Disclosure | Integration test JWT in env | accept | test.skipIf gate ensures JWT only used when explicitly set by operator; test runs on dev machine only, not in CI without secret | closed |
| T-06-05-02 | Information Disclosure | Run summary JSON output | accept | orphanedCids is a list of public CIDs only; no PII or secrets; logger redaction covers any accidentally included config object | closed |
| T-06-05-03 | Information Disclosure | .env.example | accept | Template file with commented-out placeholder values — no actual secrets committed | closed |
| T-06-05-04 | Tampering | vitest unstubGlobals | accept | unstubGlobals: true in bot/vitest.config.ts ensures fetch mock is cleared after each test — prevents test pollution from stub leakage | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Verification Notes

Verification method: `grep -n` pattern search in cited files. All findings reference line numbers in implementation files as-read on 2026-04-23.

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-06-01-01 | mitigate | `bot/src/config.ts:34` — `issue.path.includes("BOT_PRIVATE_KEY") \|\| issue.path.includes("PINATA_JWT") ? { received: "[REDACTED]" }` |
| T-06-01-02 | accept | `bot/src/logger.ts:32,34` — `"config.PINATA_JWT"` and `"PINATA_JWT"` present in `redact.paths` array |
| T-06-01-03 | accept | `bot/src/types.ts:76` — `orphanedCids?: string[]` — plain CID strings, no secrets |
| T-06-02-01 | mitigate | `bot/src/ipfs.ts:72` — `Authorization: \`Bearer ${jwt}\`` in headers; `bot/src/logger.ts:34,37` — `"PINATA_JWT"` and `"Authorization"` in redact.paths |
| T-06-02-02 | mitigate | `bot/src/ipfs.ts:85,87` — `.slice(0, 500)` applied to both JSON and text error body paths; `bot/src/logger.ts:4` — `sanitizeObject` regex strips `Bearer [A-Za-z0-9._-]+` |
| T-06-02-03 | mitigate | `bot/src/ipfs.ts:65-66` — `new AbortController()` + `setTimeout(() => controller.abort(), timeoutMs)`; `bot/src/ipfs.ts:78,120` — `clearTimeout(timeoutId)` in both success and catch paths |
| T-06-02-04 | accept | IPFS content-addressing — CID is SHA2-256 of content; tampering yields a different CID |
| T-06-02-05 | mitigate | `bot/src/ipfs.ts:6` — `PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS"`; only `pinJSONToIPFS` endpoint called from bot; no unpin/admin calls |
| T-06-03-01 | accept | IPFS content-addressing — a forged CID resolves to different or nonexistent content |
| T-06-03-02 | mitigate | `bot/src/chain.ts:187,191,200,233` — evidence built once in prepare pass with `buildPositiveEvidence`/`buildNegativeEvidence`; `buildFeedbackURI(uploadResult.cid)` called with CID only; execute pass uses `prep.feedbackURI` without rebuild |
| T-06-03-03 | accept | `bot/src/evidence.ts:76-78` — `buildFeedbackURI(cid: string): string` returns `ipfs://${cid}`; base64 encoding removed |
| T-06-04-01 | mitigate | `bot/src/chain.ts:187,233,296` — WR-01: evidence captured in prepare pass; execute pass reads `prep.status === "ready" ? prep.feedbackURI : undefined`; no call to `buildPositiveEvidence`/`buildNegativeEvidence` in execute loop |
| T-06-04-02 | mitigate | `bot/src/chain.ts:140,231,237,258-266` — `consecutiveFailures` counter; resets to 0 on success; `>= 3` triggers `systemicFailure: "pinata-unavailable"` return without entering execute pass |
| T-06-04-03 | mitigate | `bot/src/chain.ts:224-228` — `config.PINATA_JWT` passed directly as argument to `uploadEvidenceToIPFS()`; never assigned to a local variable that could appear in a log call |
| T-06-04-04 | accept | `bot/src/chain.ts:279-281` — nonce fetched once at start of execute pass via `publicClient.getTransactionCount`; prepare pass makes zero on-chain calls |
| T-06-04-05 | accept | `bot/src/chain.ts:232,436-438` — orphanedCids populated on upload success; CID removed on confirmed tx; remainder listed in run summary |
| T-06-05-01 | accept | `bot/test/ipfs.integration.test.ts:11` — `test.skipIf(!process.env.PINATA_JWT)` gate; test body only reached when JWT explicitly set |
| T-06-05-02 | accept | `bot/src/index.ts:129-131` — orphanedCids set to CID array only; logger redaction active for all log calls |
| T-06-05-03 | accept | `.env.example` contains only commented-out placeholder values; no actual secrets |
| T-06-05-04 | accept | `bot/vitest.config.ts` — `unstubGlobals: true` and `unstubEnvs: true` ensure stubs cleared after each test |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-06-01 | T-06-01-02 | PINATA_JWT already present in `redact.paths` per RESEARCH.md §Pitfall 10 — no code change needed; pino redacts it from all log objects automatically | gsd-security-auditor | 2026-04-23 |
| AR-06-02 | T-06-01-03 | orphanedCids is a string[] of IPFS CIDs — no PII, no secrets; CIDs are content-addressed public hashes; serialization as JSON does not expose sensitive data | gsd-security-auditor | 2026-04-23 |
| AR-06-03 | T-06-02-04 | IPFS content-addressing: CID is the SHA2-256 multihash of the pinned content. Any tampering to the evidence JSON would produce a different CID that does not match the on-chain URI, making the forgery self-evident and non-exploitable | gsd-security-auditor | 2026-04-23 |
| AR-06-04 | T-06-03-01 | buildFeedbackURI output is the CID itself (`ipfs://<CID>`). A modified CID either resolves to unrelated content or fails to resolve — not exploitable for impersonation or data injection | gsd-security-auditor | 2026-04-23 |
| AR-06-05 | T-06-03-03 | The old `data:` URI was opaque and not independently verifiable. Replacing it with `ipfs://` URIs improves auditability: any party can retrieve the evidence from IPFS and verify its content matches the on-chain record | gsd-security-auditor | 2026-04-23 |
| AR-06-06 | T-06-04-04 | Prepare pass makes zero on-chain calls; nonce is fetched once at the start of the execute pass, identical to the pre-Phase-6 behavior. RESEARCH.md Pitfall 8 confirms no nonce double-spend risk from the prepare/execute split | gsd-security-auditor | 2026-04-23 |
| AR-06-07 | T-06-04-05 | Orphaned CIDs (uploaded but not submitted) are logged in the run summary. Re-uploading the same evidence on the next run produces the same CID (IPFS content-addressing is idempotent). Pinata pin cost is negligible. The operator can inspect and unpin orphans via the CDN URL if desired | gsd-security-auditor | 2026-04-23 |
| AR-06-08 | T-06-05-01 | Integration test is gated by `test.skipIf(!process.env.PINATA_JWT)`. The JWT is never hardcoded; it is only used when the operator explicitly sets the env var at runtime. The test does not run in CI without the secret | gsd-security-auditor | 2026-04-23 |
| AR-06-09 | T-06-05-02 | Run summary JSON contains only public IPFS CIDs in `orphanedCids`. No PII or secrets are included. Logger redaction (pino `redact.paths`) is active for all log calls that include config objects | gsd-security-auditor | 2026-04-23 |
| AR-06-10 | T-06-05-03 | `.env.example` is a developer template. All sensitive entries (`PINATA_JWT`, `BOT_PRIVATE_KEY`) are commented out with placeholder empty values. No actual secrets are present or committed | gsd-security-auditor | 2026-04-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Threat Flags

None. All `## Threat Flags` sections in SUMMARY.md files for Plans 06-01 through 06-05 report no new threat flags beyond what is covered by the plan's threat models.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-23 | 20 | 20 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-23
