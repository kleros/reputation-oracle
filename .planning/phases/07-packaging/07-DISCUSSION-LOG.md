# Phase 7: Packaging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 07-packaging
**Areas discussed:** bootstrap.sh scope & shape, Secret population flow, Update mechanism, Extra hardening directives

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| bootstrap.sh scope & shape | Monolithic vs staged vs flagged | ✓ |
| Secret population flow | Stub, template, external, interactive | ✓ |
| Update mechanism | Runbook, script, both | ✓ |
| Extra hardening directives | Minimum vs +extras | ✓ |

**User's choice:** All four selected for discussion.

---

## bootstrap.sh Scope & Shape

### Q1: How should bootstrap.sh be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Single script, internal idempotency | One `deploy/bootstrap.sh`, guards via `id ... || useradd`, re-runs safe | ✓ |
| Split into staged scripts | `01-prepare-host.sh`, `02-install-app.sh`, `03-install-systemd.sh` | |
| Single script with `--stage` flags | `bootstrap.sh --stage=host\|app\|systemd\|all` | |

**User's choice:** Single script, internal idempotency (recommended option).

### Q2: Does bootstrap clone the repo, or does operator clone first and run from inside?

| Option | Description | Selected |
|--------|-------------|----------|
| Operator clones first, runs from inside | `git clone ... && cd ... && sudo ./deploy/bootstrap.sh` | ✓ |
| Bootstrap handles the clone | `curl ... bootstrap.sh \| sudo bash` or download-and-run | |

**User's choice:** Operator clones first (recommended option).

### Q3: At end of bootstrap.sh, what state should systemd be in?

| Option | Description | Selected |
|--------|-------------|----------|
| Install units, leave timer disabled | Units installed, `daemon-reload` run, NOT `enable --now` | ✓ |
| Enable + start timer at end | `systemctl enable --now` as final step | |
| Enable timer but do NOT start it | `systemctl enable` without `--now` | |

**User's choice:** Install units, leave timer disabled — PLUS add a convenience script/command to enable + start timer.
**Notes:** User annotated the answer with "provide a convenience script/command to enable + start timer". Captured as `deploy/start-timer.sh` helper in CONTEXT.md D-24 / D-38.

---

## Secret Population Flow

### Q4: How should /etc/reputation-oracle/sepolia.env get populated?

| Option | Description | Selected |
|--------|-------------|----------|
| Stub + manual edit | Bootstrap creates empty 0600 file + template comments; operator `sudo -u oracle nano` fills | ✓ |
| Copy from template + edit | Commit `deploy/sepolia.env.example`; `sudo install -m 0600 ...` then edit | |
| External injection | Bootstrap refuses to finish unless env file exists (scp / cloud-init injection) | |
| Interactive prompts | Bootstrap reads each secret via `read -rs`, writes 0600 file | |

**User's choice:** Stub + manual edit (recommended option).
**Notes:** Rationale locked in CONTEXT.md D-16: avoids P1-12 bash-history risk, matches runbook discipline, works for unattended re-runs.

---

## Update Mechanism

### Q5 (first attempt): How should the atomic update flow be delivered?

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown runbook only | 4-step sequence in `docs/DEPLOY.md`; operator copy-pastes | |
| Runbook + scripts/update.sh | Both: Markdown AND wrapper script | |
| scripts/update.sh only | Script wraps the sequence; one command | (rejected — user asked for clarification) |

**User's action:** Rejected the question, asked Claude to unpack what "update flow" means.

### Q5 (after clarification): same question re-asked

**User's choice:** Script only — with explicit requirement that the script NOT fail silently. Operator must know which step failed and in what state the timer is.

**Notes from user:**
- "I prefer script only, but try to make the script not fail silently to help the operator."
- "In addition, there is an assumption so far that there is a dedicated Linux user `oracle` created on the machine. It will need to be created, it doesn't exist yet."

Captured as:
- D-26 through D-28 (script-only update, strict error handling, step banners, trap-on-ERR with timer state + recovery hint).
- D-08 (bootstrap explicitly creates the `oracle` user idempotently; user called this out as an assumption worth making explicit).

---

## Extra Hardening Directives

### Q6: Which systemd hardening directives beyond the PKG-05 minimum?

| Option | Description | Selected |
|--------|-------------|----------|
| ProtectHome=true | Free safety, `/home` inaccessible | |
| MemoryMax=512M | OOM cap, prevents one bad run taking down VPS | |
| CPUQuota=50% | Cap to half a core; I/O-bound bot barely benefits | |
| Stick to PKG-05 minimum only | 4 directives: ProtectSystem=strict, PrivateTmp=true, NoNewPrivileges=true, TimeoutStartSec=300 | ✓ |

**User's choice:** Stick to PKG-05 minimum only.
**Notes:** User explicitly declined the extras. Rationale captured in CONTEXT.md D-15: keep PKG-05 scope tight, stay verbatim-aligned with REQUIREMENTS.md. Extras moved to `<deferred>` for possible future reconsideration.

---

## Final Confirmation

### Q7: Ready to write CONTEXT.md, or more to discuss?

| Option | Description | Selected |
|--------|-------------|----------|
| Write CONTEXT.md | Lock all decisions, proceed to research/planning | ✓ |
| More to discuss | Additional gray areas before context is written | |

**User's choice:** Write CONTEXT.md.

---

## Claude's Discretion (captured in CONTEXT.md `<decisions>` §"Claude's Discretion")

- D-36: sepolia.env stub template content (key ordering, comments) — align with existing `bot/.env.example`
- D-37: exact wording of trap-on-error messages in bootstrap.sh and update.sh
- D-38: whether `start-timer.sh` takes an instance arg in Phase 7 (Sepolia-only now vs. parameterized)
- D-39: deploy/RUNBOOK.md single-file vs split
- D-40: bootstrap handling of partial-install state — default is "idempotent guards handle it"

## Deferred Ideas (captured in CONTEXT.md `<deferred>`)

- `LoadCredential=` systemd credential store → v1.3 (SEC-02)
- Hardware-wallet-held UUPS upgrade key → v1.3 (SEC-03)
- Additional hardening directives (MemoryMax, CPUQuota, ProtectHome, ReadWritePaths) → revisit later if needed
- Docker / Compose / pm2 / k8s / Ansible / Terraform / logrotate — explicit anti-features
- `dist/` build step — keep tsx runtime
- Betterstack wiring → Phase 8
- Mainnet systemd instance activation → Phase 9
