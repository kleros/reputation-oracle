---
phase: 7
slug: 07-packaging
status: verified
threats_open: 0
asvs_level: 2
created: 2026-04-24
---

# Phase 7 — Packaging Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry → package.json | Version ranges resolved at install time via lockfile | tsx binary (transpiler) |
| systemd unit → oracle process | Unit file directives define privilege scope | env vars from EnvironmentFile |
| EnvironmentFile path → /etc/reputation-oracle/%i.env | 0600 oracle:oracle; root cannot read without sudo | BOT_PRIVATE_KEY, RPC_URL, PINATA_JWT |
| bootstrap.sh (root) → oracle-owned files | Script runs as root; drops to oracle for npm ci | repo ownership, node_modules |
| git remote → /opt/reputation-oracle | git pull --ff-only as oracle; operator controls timing | code, package-lock.json |
| RUNBOOK.md / ACCEPTANCE.md → public git | Documentation only; no secret values | none (plain text docs) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-01-01 | Tampering | npm supply chain (tsx) | mitigate | `npm ci` uses lockfile integrity hashes; tsx pinned to `^4.21.0` in dependencies | closed |
| T-07-01-02 | Information Disclosure | package.json in git | accept | package.json is public repo content; no secrets; tsx version is not sensitive | closed |
| T-07-01-03 | Elevation of Privilege | tsx as production dep | accept | tsx is a transpiler; no runtime privilege escalation; downstream mitigation via `NoNewPrivileges=true` in systemd unit | closed |
| T-07-02-01 | Information Disclosure | `systemctl show` env exposure | mitigate | `EnvironmentFile=` used exclusively; no `Environment=KEY=secret` directives in unit file | closed |
| T-07-02-02 | Elevation of Privilege | Service running as root | mitigate | `User=oracle`, `Group=oracle`, `NoNewPrivileges=true` all explicit in [Service] | closed |
| T-07-02-03 | Tampering | World-writable unit file | mitigate | Unit files installed root:root 0644 via bootstrap; `ProtectSystem=strict` prevents oracle from modifying /etc/ | closed |
| T-07-02-04 | Denial of Service | Hung bot blocks timer | mitigate | `TimeoutStartSec=300` in service unit — systemd kills after 5 min | closed |
| T-07-02-05 | Denial of Service | Restart= thrash spiral | mitigate | No `Restart=` directive present in unit file; timer is the retry mechanism | closed |
| T-07-02-06 | Denial of Service | journald disk exhaustion | mitigate | `SystemMaxUse=500M` in deploy/journald.conf.d/reputation-oracle.conf | closed |
| T-07-03-01 | Information Disclosure | bash history secret capture | mitigate | bootstrap.sh warns operator explicitly in stub header and Done banner; `install` + heredoc pattern used (no `echo` of values) | closed |
| T-07-03-02 | Information Disclosure | sepolia.env world-readable | mitigate | `install -m 0600 -o oracle -g oracle /dev/null` sets perms atomically before data written; `stat -c '%a %U %G'` assertion before bootstrap exits | closed |
| T-07-03-03 | Tampering | NodeSource curl-pipe-bash | mitigate | `curl -fsSL` (fail on error); idempotency guard skips re-download if Node v22 already installed | closed |
| T-07-03-04 | Elevation of Privilege | npm ci runs as root | mitigate | `sudo -u oracle npm --prefix ... ci --omit=dev` — writes to oracle-owned node_modules; chown (step 5) precedes npm (step 6) | closed |
| T-07-03-05 | Tampering | bootstrap.sh world-writable | mitigate | bootstrap.sh committed to git; repo chowned to oracle after bootstrap; `ProtectSystem=strict` prevents oracle modifying /etc/systemd/ | closed |
| T-07-03-06 | Denial of Service | bootstrap re-run clobbers secrets | mitigate | `if [ ! -f /etc/reputation-oracle/sepolia.env ]` guard — clobber never happens | closed |
| T-07-04-01 | Tampering | git pull brings malicious code | mitigate | `sudo -u oracle git -C ... pull --ff-only` — non-fast-forward merges rejected | closed |
| T-07-04-02 | Denial of Service | update.sh fails, timer stays stopped | mitigate | `trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR` prints timer state and recovery hint; script is idempotent and re-runnable | closed |
| T-07-04-03 | Denial of Service | Concurrent update + running bot | accept | `systemctl stop timer` (step 1) ensures bot has completed current run before code changes; Type=oneshot semantics ensure clean handoff | closed |
| T-07-04-04 | Elevation of Privilege | update.sh npm ci as root | mitigate | `sudo -u oracle npm --prefix ... ci --omit=dev` — writes to oracle-owned node_modules only | closed |
| T-07-04-05 | Spoofing | start-timer.sh enables wrong instance | mitigate | `case "$INSTANCE" in sepolia|mainnet) ;;` explicit allowlist; unknown arguments exit 1 | closed |
| T-07-05-01 | Information Disclosure | dry-run `env $(xargs)` visible in ps | accept | Process window is milliseconds; local VPS single-user context; alternative wrapper adds complexity for no security gain | closed |
| T-07-05-02 | Information Disclosure | RUNBOOK.md in public git | accept | RUNBOOK contains no secret values; all secrets reside on VPS in /etc/reputation-oracle/ only | closed |
| T-07-05-03 | Tampering | Operator follows stale cached RUNBOOK | accept | RUNBOOK co-located with scripts in git; `git pull` as part of update flow keeps it current | closed |
| T-07-06-01 | Information Disclosure | ACCEPTANCE.md dry-run exposes env in ps | accept | Same rationale as T-07-05-01 — millisecond window, local VPS, single operator | closed |
| T-07-06-02 | Tampering | Operator skips acceptance checklist | accept | Checklist is documented discipline, not code-enforced; bootstrap step 7 assertions provide partial automated coverage | closed |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-07-01 | T-07-01-02 | package.json is public repo content; tsx version number is not sensitive information | gsd-security-auditor | 2026-04-24 |
| AR-07-02 | T-07-01-03 | tsx is a dev-time transpiler with no runtime privilege escalation surface; downstream NoNewPrivileges=true in systemd provides defence-in-depth | gsd-security-auditor | 2026-04-24 |
| AR-07-03 | T-07-04-03 | systemctl stop timer (step 1) ensures current bot run completes before code changes; Type=oneshot prevents overlapping execution; intentional and bounded downtime window | gsd-security-auditor | 2026-04-24 |
| AR-07-04 | T-07-05-01 | env $(xargs) exposes env vars in /proc/PID/environ for milliseconds during a local single-user VPS command; threat level is negligible; alternative wrapper script adds complexity with no security gain at this scale | gsd-security-auditor | 2026-04-24 |
| AR-07-05 | T-07-05-02 | RUNBOOK.md verified to contain no secret values; all actual secrets reside only in /etc/reputation-oracle/sepolia.env on the VPS | gsd-security-auditor | 2026-04-24 |
| AR-07-06 | T-07-05-03 | RUNBOOK is co-located with scripts in git; update.sh pulls RUNBOOK and scripts atomically; operator who skips git pull before consulting RUNBOOK may see stale docs but this is an operator discipline issue not a security issue | gsd-security-auditor | 2026-04-24 |
| AR-07-07 | T-07-06-01 | Same rationale as AR-07-04; ACCEPTANCE.md dry-run command has identical env exposure profile | gsd-security-auditor | 2026-04-24 |
| AR-07-08 | T-07-06-02 | Acceptance checklist is a document, not a code gate; bootstrap step 7 (stat -c assertion) and systemd unit configuration provide automated partial coverage; residual risk is operator discipline | gsd-security-auditor | 2026-04-24 |

---

## Unregistered Threat Flags

None. All SUMMARY.md `## Threat Flags` sections across plans 07-01 through 07-06 report "None". No unregistered surface was detected during implementation.

---

## Notable Observations (Non-blocking)

**Timer interval deviation:** `deploy/systemd/reputation-oracle@.timer` contains `OnUnitActiveSec=5min`, while the plan (07-02-PLAN.md) specified `15min` and SUMMARY.md self-reported `15min`. The UAT on the live Sepolia VPS passed with `5min` (per 07-VERIFICATION.md). This is an operational parameter deviation, not a security threat — none of the 25 registered threats reference the timer interval value. Logged here for traceability; no security impact.

**@logtail/pino added to dependencies:** `bot/package.json` contains `"@logtail/pino": "^0.5.8"` as a production dependency, which was not present in the plan's target state for 07-01. This is a Phase 8 Observability dependency added ahead of schedule. It enters the supply chain lockfile hash pool. No security threat is introduced beyond the general T-07-01-01 supply chain trust boundary (already mitigated by `npm ci` lockfile integrity). Logged for traceability.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-24 | 25 | 25 | 0 | gsd-security-auditor (claude-sonnet-4-6) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-24
