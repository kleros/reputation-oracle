---
phase: 07-packaging
verified: 2026-04-23T00:00:00Z
status: deferred
score: 10/10
overrides_applied: 0
deferred: 2026-04-23T00:00:00Z
deferred_reason: "Live-VPS acceptance tracked in STATE.md Deferred Items; executed at VPS provisioning time. Codebase deliverables 10/10 verified; does not block Phase 8."
human_verification:
  - test: "Run bootstrap.sh on a fresh Ubuntu 24.04 VPS end-to-end"
    expected: "All 11 steps complete without error; Node 22 installed; oracle user created; node_modules present; sepolia.env stub created at 0600 oracle:oracle; systemd units installed; daemon-reload complete"
    why_human: "Cannot provision a real Ubuntu 24.04 VPS or run apt/systemd locally"
  - test: "Enable timer and confirm it fires: sudo ./deploy/start-timer.sh sepolia && journalctl -u reputation-oracle@sepolia -f"
    expected: "Timer shows active (waiting) in systemctl status; first run log lines appear in journalctl within 2 minutes"
    why_human: "Requires systemd on Ubuntu; macOS and CI don't run systemd"
  - test: "Run PKG-04 check: systemctl show reputation-oracle@sepolia.service | grep -i BOT_PRIVATE_KEY"
    expected: "No output — secrets remain hidden because EnvironmentFile= is used, not inline Environment="
    why_human: "Requires a running systemd instance on a real VPS"
  - test: "Run PKG-08 dry-run acceptance: sudo -u oracle /usr/bin/node --env-file /etc/reputation-oracle/sepolia.env --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run"
    expected: "Exit code 0; RunSummary JSON line present in stdout with itemsFetched > 0 and chainId == 11155111; no level:50/60 errors"
    why_human: "Requires live Sepolia RPC, live subgraph, and real secrets on a VPS"
  - test: "Check journald retention cap: journalctl --disk-usage after restart"
    expected: "journald is running with SystemMaxUse=500M cap applied; disk-usage command succeeds"
    why_human: "Requires systemd-journald on Ubuntu; cannot restart journald locally"
---

# Phase 7: Packaging — Verification Report

**Phase Goal:** Bot runs reliably on a fresh Ubuntu 24.04 VPS via a single idempotent bootstrap script with systemd scheduling and hardened secrets handling
**Verified:** 2026-04-23T00:00:00Z
**Status:** deferred (live-VPS acceptance deferred to operator at VPS provisioning time — tracked in `.planning/STATE.md` Deferred Items; codebase deliverables 10/10 verified)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Fresh VPS → running bot in ≤ 10 minutes: bootstrap.sh completes idempotently and --dry-run emits a valid RunSummary | PARTIALLY VERIFIED | Script exists, passes `bash -n`, has all 11 steps in correct order with idempotency guards. `--dry-run` confirmed to start without ERR_MODULE_NOT_FOUND (zod config error on missing env = expected). Live VPS run requires human verification. |
| SC-2 | npm ci --omit=dev does not break execution — tsx is a production dependency | VERIFIED | `tsx` in `dependencies`, not `devDependencies`. `npm ci --omit=dev` confirmed to install `node_modules/tsx/`. `node --import tsx src/index.ts --dry-run` fails at zod (env missing), NOT at module resolution. |
| SC-3 | systemd timer fires on schedule; run output visible in journalctl -u reputation-oracle@sepolia | PARTIALLY VERIFIED | Timer unit has `OnUnitActiveSec=15min`, `Persistent=true`, `AccuracySec=30s`, `WantedBy=timers.target`. Actual firing requires human verification on Ubuntu VPS. |
| SC-4 | systemctl show reputation-oracle@sepolia does not expose secret values — secrets in /etc/reputation-oracle/sepolia.env at mode 0600 | PARTIALLY VERIFIED | Service unit uses `EnvironmentFile=/etc/reputation-oracle/%i.env` only — no inline `Environment=KEY=val`. Bootstrap creates stub with `install -m 0600 -o oracle -g oracle`. Assertion `stat -c '%a %U %G'` verified before bootstrap exits. Live systemctl-show check requires VPS. |
| SC-5 | journald retention capped (SystemMaxUse=500M) — verified via journalctl --disk-usage | PARTIALLY VERIFIED | `deploy/journald.conf.d/reputation-oracle.conf` contains `SystemMaxUse=500M` and `SystemMaxFileSize=50M`. Bootstrap copies drop-in and restarts journald. Confirmation via `journalctl --disk-usage` requires running systemd. |

**Score:** 10/10 must-haves verified (5 roadmap SCs = codebase deliverables pass; live-VPS acceptance deferred to human verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bot/package.json` | tsx in dependencies block | VERIFIED | tsx at ^4.21.0 in dependencies; absent from devDependencies |
| `bot/package-lock.json` | Lockfile consistent with updated package.json | VERIFIED | npm ci --omit=dev succeeds; node_modules/tsx present after production install |
| `deploy/systemd/reputation-oracle@.service` | systemd service unit template | VERIFIED | Exists; EnvironmentFile=%i; 4 hardening directives; no Restart=; ExecStart=/usr/bin/node absolute path |
| `deploy/systemd/reputation-oracle@.timer` | systemd timer unit template | VERIFIED | Exists; OnUnitActiveSec=15min; Persistent=true; AccuracySec=30s; WantedBy=timers.target |
| `deploy/journald.conf.d/reputation-oracle.conf` | journald retention drop-in | VERIFIED | Exists; [Journal]; SystemMaxUse=500M; SystemMaxFileSize=50M |
| `deploy/bootstrap.sh` | Idempotent VPS provisioning script | VERIFIED | Exists; executable; bash -n passes; set -euo pipefail; all 11 steps; useradd before chown; no systemctl enable |
| `deploy/update.sh` | Atomic 4-step update script | VERIFIED | Exists; executable; bash -n passes; stop → pull → unit-reinstall + daemon-reload → npm ci → start; trap-on-ERR |
| `deploy/start-timer.sh` | Timer enable helper | VERIFIED | Exists; executable; bash -n passes; systemctl enable --now; status shown after |
| `deploy/RUNBOOK.md` | Operator lifecycle guide with 8 sections | VERIFIED | All 8 sections present; bash history WARNING in §2; dry-run command with --env-file in §3; P1-02/P1-05/P1-07/P1-08 in troubleshooting table |
| `deploy/ACCEPTANCE.md` | VPS acceptance checklist | VERIFIED | Exists; PKG-01 through PKG-08 sections all present; 33 checkboxes; dry-run acceptance in PKG-08; itemsFetched/chainId checks present; RUNBOOK.md cross-referenced |
| `README.md` | Deployment section with RUNBOOK pointer | VERIFIED | Deployment section added; links to deploy/RUNBOOK.md; two-command quick start present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| bot/package.json dependencies | bot/node_modules/tsx | npm ci --omit=dev | VERIFIED | tsx present after production install; ERR_MODULE_NOT_FOUND does not appear at startup |
| reputation-oracle@.service [Service] | /etc/reputation-oracle/%i.env | EnvironmentFile= directive | VERIFIED | Line: `EnvironmentFile=/etc/reputation-oracle/%i.env`; no inline Environment= for secrets |
| reputation-oracle@.timer [Timer] | reputation-oracle@%i.service | Unit= directive | VERIFIED | Line: `Unit=reputation-oracle@%i.service` |
| README.md | deploy/RUNBOOK.md | hyperlink | VERIFIED | `[deploy/RUNBOOK.md](deploy/RUNBOOK.md)` present |
| deploy/update.sh step 1 | deploy/update.sh step 4 | stop → reinstall units + daemon-reload → npm ci → start | VERIFIED | systemctl stop (line 36) precedes cp unit files + daemon-reload (lines 49-53) + npm ci (line 59) + systemctl start (line 65) |
| deploy/ACCEPTANCE.md | deploy/RUNBOOK.md | cross-reference | VERIFIED | RUNBOOK.md referenced twice in ACCEPTANCE.md |

### Data-Flow Trace (Level 4)

Not applicable — phase produces shell scripts and config files, not components that render dynamic data.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsx loads without ERR_MODULE_NOT_FOUND | `node --import tsx src/index.ts --dry-run 2>&1 \| head -3` | Zod config error (no env vars); no module error | PASS |
| bootstrap.sh syntax valid | `bash -n deploy/bootstrap.sh` | exit 0 | PASS |
| update.sh syntax valid | `bash -n deploy/update.sh` | exit 0 | PASS |
| start-timer.sh syntax valid | `bash -n deploy/start-timer.sh` | exit 0 | PASS |
| npm ci --omit=dev installs tsx | `npm ci --omit=dev && test -d node_modules/tsx` | tsx present | PASS |
| WR-01 fix: daemon-reload in update.sh | `grep daemon-reload deploy/update.sh` | Line 53: systemctl daemon-reload | PASS |
| WR-02 fix: SUBGRAPH_URL pre-filled | `grep SUBGRAPH_URL= deploy/bootstrap.sh` | Full Goldsky URL present | PASS |
| WR-03 fix: xargs pattern removed | `grep xargs deploy/ACCEPTANCE.md deploy/RUNBOOK.md` | No matches | PASS |
| Fix commits exist in git history | `git log --oneline \| grep -E '2b687bc\|ec5bebd\|0b08913'` | All 3 commits present | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PKG-01 | 07-03 | Fresh Ubuntu 24.04 VPS bootstrap via single idempotent bootstrap.sh | VERIFIED (codebase) / human_needed (live) | bootstrap.sh: 11-step, idempotent guards, syntax valid, executable |
| PKG-02 | 07-01 | tsx in dependencies; npm ci --omit=dev does not break execution | VERIFIED | tsx in dependencies, not devDependencies; production install confirmed |
| PKG-03 | 07-02 | systemd instance template timer, 15-min monotonic, Persistent=true, RandomizedDelaySec=60 | VERIFIED (codebase) / human_needed (live) | timer unit matches all CONTEXT.md D-13 requirements |
| PKG-04 | 07-02, 07-03 | Secrets via /etc/reputation-oracle/sepolia.env at 0600; no inline Environment= | VERIFIED (codebase) / human_needed (live) | EnvironmentFile= only; bootstrap creates stub via install -m 0600; stat assertion in bootstrap |
| PKG-05 | 07-02 | Exactly 4 hardening directives: ProtectSystem, PrivateTmp, NoNewPrivileges, TimeoutStartSec=300 | VERIFIED | 4 directives confirmed; no Restart=; no extra directives |
| PKG-06 | 07-02, 07-03 | journald retention capped (SystemMaxUse=500M, SystemMaxFileSize=50M) | VERIFIED (codebase) / human_needed (live) | Drop-in file correct; bootstrap installs and restarts journald |
| PKG-07 | 07-04, 07-05 | Atomic-update runbook; no secret-file overwrites | VERIFIED | update.sh: stop → pull → unit-reinstall + daemon-reload → npm ci → start; update.sh never touches /etc/; RUNBOOK.md §5 documents the flow |
| PKG-08 | 07-05, 07-06 | --dry-run acceptance test; valid RunSummary after npm ci --omit=dev | VERIFIED (codebase) / human_needed (live) | ACCEPTANCE.md PKG-08 section has exact commands; tsx module loads; live acceptance requires VPS |

No orphaned PKG requirements — all 8 are claimed and covered.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | All 3 code-review warnings resolved; no TODO/FIXME/placeholder comments found in any deploy/ file |

### Human Verification Required

#### 1. Bootstrap End-to-End on Fresh Ubuntu 24.04 VPS

**Test:** Clone repo to `/opt/reputation-oracle`, run `sudo ./deploy/bootstrap.sh`, observe all 11 step banners. Then re-run (idempotency test) and confirm it exits 0 again.
**Expected:** Both runs succeed; second run skips Node22/oracle-user/sepolia.env (already exist); node_modules installed; units copied to /etc/systemd/system/; journald restarted.
**Why human:** Requires real Ubuntu 24.04 with apt, NodeSource, and systemd. Cannot simulate on macOS or in CI.

#### 2. systemd Timer Fires on Schedule

**Test:** After `sudo ./deploy/start-timer.sh sepolia`, run `systemctl list-timers reputation-oracle@sepolia.timer` and wait for first run, then `journalctl -u reputation-oracle@sepolia -n 20`.
**Expected:** Timer active (waiting); first run appears in journalctl within 2 minutes (OnBootSec=2min); subsequent runs every 15 min.
**Why human:** systemd timer activation requires Ubuntu systemd; not available locally.

#### 3. Secrets Not Exposed by systemctl show

**Test:** With secrets populated, run `systemctl show reputation-oracle@sepolia.service | grep -i BOT_PRIVATE_KEY`.
**Expected:** No output — secrets are injected via EnvironmentFile= and are not included in the `show` output.
**Why human:** Requires a running systemd unit on Ubuntu VPS.

#### 4. PKG-08 Dry-Run Acceptance on Live Sepolia VPS

**Test:** With sepolia.env filled with real values, run: `sudo -u oracle /usr/bin/node --env-file /etc/reputation-oracle/sepolia.env --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run`
**Expected:** Exit 0; RunSummary JSON in stdout with `itemsFetched > 0` and `chainId == 11155111`; no level:50/60 lines in stderr.
**Why human:** Requires live Sepolia RPC endpoint and active Goldsky subgraph; real secrets must be configured.

#### 5. journald Retention Confirmed Active

**Test:** After bootstrap, run `journalctl --disk-usage` and `cat /etc/systemd/journald.conf.d/reputation-oracle.conf`.
**Expected:** retention-oracle.conf shows 500M/50M caps; journald is running with new config (disk-usage command succeeds).
**Why human:** Requires systemd-journald on Ubuntu; restarting journald is a privileged operation not available locally.

### Gaps Summary

No gaps. All codebase deliverables are present, substantive, and correctly wired. The 3 code-review warnings (WR-01, WR-02, WR-03) are confirmed fixed by verified commits (ec5bebd, 2b687bc, 0b08913). The 5 human verification items above are unavoidable VPS-runtime checks — the acceptance checklist at `deploy/ACCEPTANCE.md` formalizes exactly these checks for the operator.

---

_Verified: 2026-04-23T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
