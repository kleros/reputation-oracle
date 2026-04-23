# Phase 7: Packaging - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Package the existing v1.1 bot to run reliably on a fresh Ubuntu 24.04 VPS via a single idempotent bootstrap script, with systemd instance-unit scheduling and hardened secrets handling. No bot logic changes. Establishes the runtime that Phase 8 (Observability) and Phase 9 (Mainnet) build on.

In scope: bootstrap script, systemd service/timer unit files, secret delivery model, journald retention, update-flow script, acceptance dry-run on a live VPS.

Out of scope: Betterstack wiring (Phase 8), Mainnet ERC-8004 wiring and RPC fallback (Phase 9), any bot src/ changes beyond the `tsx` `devDependencies` → `dependencies` promotion.

</domain>

<decisions>
## Implementation Decisions

### Runtime & Node provisioning
- **D-01:** Node 22 LTS via NodeSource apt (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` → `apt install -y nodejs`). System-wide `/usr/bin/node` visible to systemd ExecStart.
- **D-02:** No nvm, no asdf, no Ubuntu-default apt Node (ships 18). Rationale: per-user managers are invisible to systemd and distro Node is too old.
- **D-03:** Bot runs from TypeScript source via `node --import tsx /opt/reputation-oracle/bot/src/index.ts`. No `dist/` build step for v1.2. `tsconfig.json` `noEmit: true` stays.
- **D-04:** `tsx` moved from `bot/package.json` devDependencies → dependencies. Fixes P1-02 (P1-02: `npm ci --omit=dev` silently omits tsx → bot never starts).

### Filesystem layout
- **D-05:** App root: `/opt/reputation-oracle/` (full repo clone, including `contracts/`, `docs/`, `.git/`). Not `/usr/local/`, not `/var/www/`.
- **D-06:** Secrets separated from app tree: `/etc/reputation-oracle/sepolia.env`. `git pull` never clobbers secrets; secrets never enter git.
- **D-07:** Repo deploy artifacts live under `deploy/` at repo root: `deploy/bootstrap.sh`, `deploy/update.sh`, `deploy/start-timer.sh` (convenience enable+start helper), `deploy/systemd/reputation-oracle@.service`, `deploy/systemd/reputation-oracle@.timer`, `deploy/journald.conf.d/reputation-oracle.conf`, `deploy/sepolia.env.example` (if used — see D-16), `deploy/RUNBOOK.md`.

### System user
- **D-08:** Dedicated service account `oracle` (does not exist on a fresh VPS — bootstrap MUST create it). Idempotent guard: `id oracle &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin oracle`.
- **D-09:** `oracle` owns `/opt/reputation-oracle/` (recursive `chown -R oracle:oracle`) and `/etc/reputation-oracle/sepolia.env` (mode 0600, owner oracle, group oracle).
- **D-10:** Systemd `[Service]` runs as `User=oracle`, `Group=oracle`. Never root.

### systemd unit design
- **D-11:** Instance-unit template from day one: `reputation-oracle@.service` + `reputation-oracle@.timer`. Sepolia enables `reputation-oracle@sepolia.timer`. Phase 9 reuses the same template for `reputation-oracle@mainnet.timer` — no config drift. Instance specifier `%i` selects `/etc/reputation-oracle/%i.env`.
- **D-12:** Service: `Type=oneshot`, `RemainAfterExit=no` (explicit), `After=network-online.target`, `Wants=network-online.target`, `WorkingDirectory=/opt/reputation-oracle/bot`, `EnvironmentFile=/etc/reputation-oracle/%i.env`, `ExecStart=/usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts`, `StandardOutput=journal`, `StandardError=journal`, `SyslogIdentifier=reputation-oracle-%i`.
- **D-13:** Timer: `OnBootSec=2min`, `OnUnitActiveSec=15min`, `RandomizedDelaySec=60`, `Persistent=true`, `AccuracySec=30s`, `Unit=reputation-oracle@%i.service`. Install `WantedBy=timers.target`.
- **D-14:** No `Restart=` directive. `Type=oneshot` + timer = implicit retry. `Restart=on-failure` would thrash on 429s (P1-03).

### Hardening (PKG-05 minimum only)
- **D-15:** Exactly four hardening directives in `[Service]`, no more: `ProtectSystem=strict`, `PrivateTmp=true`, `NoNewPrivileges=true`, `TimeoutStartSec=300`. User explicitly declined the extras (`ProtectHome=true`, `MemoryMax=512M`, `CPUQuota=50%`, `ReadWritePaths=`) to keep PKG-05 scope tight and stay verbatim-aligned with REQUIREMENTS.md PKG-05.

### Secret delivery
- **D-16:** Stub-plus-manual-edit flow. Bootstrap creates `/etc/reputation-oracle/sepolia.env` via `install -m 0600 -o oracle -g oracle /dev/null /etc/reputation-oracle/sepolia.env`, then appends a commented template (placeholders for every env var, no real values). Operator fills values via `sudo -u oracle nano /etc/reputation-oracle/sepolia.env`. Never via `echo >> ` or heredoc — avoids P1-12 (bash history key capture).
- **D-17:** Permissions verification: `stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env` must print exactly `600 oracle oracle`. Bootstrap asserts this before exiting successfully.
- **D-18:** No inline `Environment=KEY=val` in unit files for any secret. Non-secret config (e.g. `LOG_LEVEL=info`) may use `Environment=` in the unit file, but the convention is to keep everything in `EnvironmentFile` for uniformity.
- **D-19:** If bootstrap detects `/etc/reputation-oracle/sepolia.env` already exists, it MUST NOT overwrite. Idempotency rule: "create if missing" only; never clobber filled secrets on re-run.

### Bootstrap script shape
- **D-20:** Single monolithic script: `deploy/bootstrap.sh`. Runs top-to-bottom with internal idempotency guards (`command -v node || install`, `id oracle || useradd`, `test -f ... || create`, `systemctl is-enabled ... || enable`). Re-runs are safe.
- **D-21:** Operator clones the repo first, then runs bootstrap from inside the tree. Runbook pattern: `sudo git clone https://github.com/… /opt/reputation-oracle && sudo chown -R oracle:oracle /opt/reputation-oracle && cd /opt/reputation-oracle && sudo ./deploy/bootstrap.sh`. Bootstrap does NOT handle the initial clone. Rationale: conventional Linux ops; re-running after `git pull` is natural.
- **D-22:** `bootstrap.sh` is strict Bash: `#!/usr/bin/env bash`, `set -euo pipefail`. Step headers emitted to stderr (`>&2 echo "[bootstrap] Step N: ..."`). Trap-on-ERR reports the failing step and exits non-zero with a human-readable message.
- **D-23:** Bootstrap covers, in order: (1) apt update + install prerequisites (git, curl, ca-certificates); (2) NodeSource Node 22 install; (3) create `oracle` system user; (4) create `/etc/reputation-oracle/` directory (mode 0755 owner root); (5) `chown -R oracle:oracle /opt/reputation-oracle`; (6) `cd bot && sudo -u oracle npm ci --omit=dev`; (7) create `/etc/reputation-oracle/sepolia.env` stub at 0600 with template comments (only if missing); (8) install systemd unit files to `/etc/systemd/system/`; (9) install journald drop-in; (10) `systemctl daemon-reload`; (11) `systemctl restart systemd-journald`. Bootstrap does NOT run `systemctl enable --now`.
- **D-24:** Bootstrap does NOT enable or start the timer. Operator explicitly runs `sudo ./deploy/start-timer.sh sepolia` (convenience helper) or `sudo systemctl enable --now reputation-oracle@sepolia.timer` after filling secrets and validating with `--dry-run`. Safer: prevents the first cycle firing against empty/bogus env.

### journald retention
- **D-25:** Global journald caps via drop-in: `/etc/systemd/journald.conf.d/reputation-oracle.conf` with `[Journal]` section setting `SystemMaxUse=500M` and `SystemMaxFileSize=50M`. Not per-service — journald limits are system-wide. Bootstrap writes the drop-in and runs `systemctl restart systemd-journald`.

### Update flow
- **D-26:** Script-only delivery: `deploy/update.sh`. No separate Markdown runbook of the same steps (the script itself is the runbook; `deploy/RUNBOOK.md` references it and covers the broader operator lifecycle).
- **D-27:** `update.sh` is loud on failure, not silent. Required properties:
  - `#!/usr/bin/env bash`; `set -euo pipefail`.
  - Accepts an instance argument: `update.sh [sepolia|mainnet]`. Defaults to `sepolia`. Validates argument early.
  - Step banner to stderr before each step (`[update:1/4] Stopping timer…`, `[update:2/4] git pull…`, etc.).
  - `trap 'on_error $? $LINENO $BASH_COMMAND' ERR` — on failure, prints: which step failed, the failing command, current timer state (via `systemctl is-active reputation-oracle@$INSTANCE.timer`), and recovery hint ("timer is stopped; rerun `update.sh sepolia` or `systemctl start reputation-oracle@sepolia.timer` to restore").
  - On `npm ci` failure, explicitly surfaces the stderr output (not swallowed).
  - Four steps, in this order: (1) `systemctl stop reputation-oracle@$INSTANCE.timer`; (2) `sudo -u oracle git -C /opt/reputation-oracle pull --ff-only`; (3) `sudo -u oracle npm --prefix /opt/reputation-oracle/bot ci --omit=dev`; (4) `systemctl start reputation-oracle@$INSTANCE.timer`.
  - Final line on success: `[update] Done. Timer state: $(systemctl is-active …)` — human-visible confirmation.
- **D-28:** `update.sh` must be safe to re-run after a mid-sequence failure (each step is idempotent or safely retriable). Operator reruns same command.

### Acceptance test (PKG-08)
- **D-29:** Acceptance verification is a manual `--dry-run` invocation as the `oracle` user after bootstrap and secret fill: `sudo -u oracle --preserve-env=HOME env $(cat /etc/reputation-oracle/sepolia.env | xargs) /usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run`. Alternative clean form: add a `deploy/verify.sh` wrapper that sources the env file correctly and runs the same command. Plan to decide whether the wrapper is warranted — current preference: inline command in RUNBOOK.md referencing D-29, plus one paragraph explaining what RunSummary fields to inspect (`itemsFetched`, `actionsComputed`, `chainId`).
- **D-30:** Acceptance passes when: (a) command exits 0, (b) stdout contains a valid `RunSummary` JSON line with `itemsFetched > 0` and `chainId == 11155111`, (c) stderr NDJSON is clean (no `level:error` or `level:fatal` lines), (d) no file written to disk (stateless bot property preserved).

### Runbook
- **D-31:** `deploy/RUNBOOK.md` covers: fresh-VPS install (invoking bootstrap), secret fill procedure, first-run verification (the `--dry-run` acceptance test), enabling the timer via `start-timer.sh` or `systemctl enable --now`, update flow (points to `update.sh`), rollback sketch (`git reset --hard <prev> && npm ci --omit=dev && systemctl restart timer`), time-sync check (`timedatectl`), and troubleshooting table for common failures (P1-02 missing tsx, P1-05 wrong perms, P1-07 wrong Node path, P1-08 journald silent drop).

### What stays UNCHANGED in Phase 7
- **D-32:** `bot/src/*.ts` — no changes. Phase 7 is pure packaging/deployment.
- **D-33:** `bot/tsconfig.json`, `bot/vitest.config.ts`, `bot/biome.json` — no changes.
- **D-34:** `contracts/` — untouched in Phase 7 (Phase 9 concern).
- **D-35:** Existing tests — 81 vitest + 17 Foundry — not modified. Phase 7 adds no new unit tests. Verification is operational (the VPS acceptance dry-run per D-29).

### Claude's Discretion
- **D-36:** Exact content of the `sepolia.env` stub template (which comments, key ordering, section headers) — align with existing `bot/.env.example` keys and add Betterstack placeholder keys (commented out, to be filled by Phase 8). Bootstrap uses a heredoc-style writer for the stub.
- **D-37:** Exact wording of trap-on-error messages in `update.sh` and `bootstrap.sh` — must be actionable; planner chooses phrasing.
- **D-38:** Whether `start-timer.sh` accepts an instance arg or is Sepolia-only in Phase 7 (Phase 9 re-touches it). Defer to planner; instance-arg form is trivially more flexible and matches `update.sh`.
- **D-39:** Whether `deploy/RUNBOOK.md` is a single file or split into `INSTALL.md` / `UPDATE.md` / `TROUBLESHOOT.md`. Default: one file, referenced from root `README.md`.
- **D-40:** Bootstrap's handling of partial-install state (e.g. previous bootstrap failed mid-way). Default: idempotent guards on every step make this safe; no special recovery mode needed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §Packaging — PKG-01..PKG-08 verbatim requirements and acceptance semantics
- `.planning/ROADMAP.md` §"Phase 7: Packaging" — goal statement and 5 Success Criteria

### Research (produced 2026-04-23 for v1.2)
- `.planning/research/STACK.md` §1 "Packaging — Node 22 on Ubuntu 24.04" — NodeSource rationale, version context
- `.planning/research/STACK.md` §2 "Packaging — systemd Timer + Service Unit" — full unit file templates, directive table
- `.planning/research/ARCHITECTURE.md` §"Feature 1: VPS Packaging + systemd" — layout, ExecStart pattern, bootstrap sequence, update flow, tsx devDep fix
- `.planning/research/FEATURES.md` §A "Packaging & VPS Deployment" — table stakes, differentiators, anti-features (Docker / pm2 / k8s / nvm all excluded)
- `.planning/research/PITFALLS.md` §"Category 1: Packaging / systemd / VPS" — P1-01 through P1-12 (blocker and major pitfalls to prevent in implementation)
- `.planning/research/SUMMARY.md` §"Phase 7 — Packaging: Key Tasks" — synthesized 7-item task list

### Project-level context
- `CLAUDE.md` §"Project" and §"Technology Stack" — project overview, tech stack, Do Not rules (no Docker, no daemon, no DB)
- `CLAUDE.md` §"Bot hardening patterns (Phase 5 baseline — apply to any bot change)" — even though Phase 7 touches no bot code, the `tsx` → dependencies promotion still interacts with Phase 5 `flushAndExit` patterns (no regression)
- `.planning/PROJECT.md` §"Target features" under v1.2 milestone — bullet 1 ("Packaging & Sepolia VPS deployment") defines scope boundary
- `.planning/milestones/v1.1-research/STACK.md` — baseline tech stack (v1.1) that v1.2 is additive to; do not re-litigate these choices

### Existing artifacts to respect
- `bot/package.json` — add `tsx` to `dependencies` (D-04); remove from `devDependencies`
- `bot/.env.example` — canonical key list for the stub template (D-36)
- `bot/src/index.ts` — entry point ExecStart points to; verify `--dry-run` path still works after tsx promotion

### Pitfalls (high-priority for this phase)
- P1-02 (tsx missing after `npm ci --omit=dev`) — MUST fix via D-04
- P1-05 (EnvironmentFile wrong perms) — MUST verify via D-17
- P1-07 (nvm invisible to systemd) — MUST prevent via D-01/D-02
- P1-12 (bash history captures secrets) — MUST warn in RUNBOOK, prevent via D-16
- P1-03 (Restart thrashing) — MUST prevent via D-14
- P1-04 (missing TimeoutStartSec) — MUST set per D-15
- P1-08 (journald silent drop) — MUST set via D-25
- P1-09 (git pull mid-run race) — MUST prevent via D-27 (stop → pull → ci → start sequence)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing `bot/.env.example`** (22 lines with PINATA_*, TX_RECEIPT_TIMEOUT_MS, MIN_BALANCE_WEI keys) — authoritative key list for the sepolia.env stub template (D-36).
- **Existing `bot/package.json`** — only touched by D-04 (tsx relocation). Do not add or change other deps in Phase 7.
- **`bot/src/index.ts`** dry-run path — already emits RunSummary on all exit paths; D-29 acceptance test depends on this behavior unchanged.
- **`pino v10` callback flush** (v1.1 Phase 4 baseline) — already exits cleanly; no adjustment needed for systemd integration.
- **`flushAndExit(code)` in `bot/src/index.ts`** — systemd's `Type=oneshot` reads the exit code; 0 = healthy, 1 = systemic failure (per Phase 5 policy).

### Established Patterns
- **`node --env-file=.env`** (local dev) vs **`EnvironmentFile=` (systemd)** — both inject env the same way; zod config validation is identical. `node --env-file` is kept in `package.json` scripts for local dev; systemd ExecStart does NOT use `--env-file` (redundant when `EnvironmentFile=` is set).
- **Stateless bot** — no files written by the bot at runtime. This enables `ProtectSystem=strict` + `PrivateTmp=true` without any `ReadWritePaths=`.
- **stdout reserved for `--dry-run` RunSummary JSON** (v1.1 Phase 4 locked) — `StandardOutput=journal` in the unit file routes both stdout and stderr to journald, which is fine for production (no consumer of dry-run stdout in production runs).
- **Biome v2 + vitest v4 + zod v4 + pino v10 + tsx v4 currently in `devDependencies`/`dependencies`** — only `tsx` moves in Phase 7.

### Integration Points
- **systemd `EnvironmentFile` → zod `loadConfig()`** — all keys must match zod schema names; stub template (D-36) must reflect the zod schema exactly.
- **systemd `StandardError=journal` → pino NDJSON stderr** — journald parses per-line JSON automatically if `Syslog*` fields are not overridden. `journalctl -u reputation-oracle@sepolia -o json` returns structured entries usable by Phase 8.
- **Exit code → systemd state** — `Type=oneshot` records the exit code in `systemctl show reputation-oracle@sepolia.service | grep ExecMainStatus`. Phase 8 builds the Betterstack heartbeat on top of this.
- **`/opt/reputation-oracle/.git/` → `update.sh`** — `git -C /opt/reputation-oracle pull --ff-only` keeps history auditable on the VPS for incident forensics (last commit == deployed version).

</code_context>

<specifics>
## Specific Ideas

- Update must not be silent: operator must immediately know which step failed and what state the timer is in (user preference captured mid-discussion). Implemented via D-27's explicit trap + recovery hint.
- The `oracle` user does not exist yet on the target VPS — bootstrap creates it. (Captured explicitly in D-08 after user called it out; was implicit in research but needs to be a visible step in bootstrap output.)
- Prefer a script over a Markdown runbook for the update flow — same philosophy applies to repeatable ops actions: scripts > docs when the sequence is short and the failure modes matter (user directive).
- Keep hardening directives at the PKG-05 minimum in v1.2 — do not add `MemoryMax`/`CPUQuota`/`ProtectHome`/`ReadWritePaths` speculatively. Can revisit in a later milestone if the bot grows (user directive).
- Install-but-don't-start-timer pattern: bootstrap finishes with the timer disabled; operator gets one explicit moment to validate dry-run before enabling (user directive, matches first-run-verification pitfall P2-05 mitigation).

</specifics>

<deferred>
## Deferred Ideas

- `LoadCredential=` systemd credential store — deferred to v1.3 (requires app refactor to read from `$CREDENTIALS_DIRECTORY`). REQUIREMENTS.md §Future Requirements logs this as SEC-02.
- Hardware-wallet-held UUPS upgrade key — deferred to v1.3 (SEC-03).
- Additional hardening directives (`MemoryMax`, `CPUQuota`, `ProtectHome`, `ReadWritePaths`) — not speculative defense-in-depth in v1.2; reconsider if an incident or code change justifies.
- Docker / Compose / pm2 / Kubernetes — out of scope (REQUIREMENTS.md §Out of Scope).
- Ansible / Terraform / config-management — explicit anti-feature in research; shell runbook + bootstrap script is the chosen path.
- Log rotation via logrotate — not needed; journald owns retention via D-25.
- `dist/` build step + `node dist/index.js` execution — keep `tsx` runtime per D-03. Revisit if startup cost ever becomes measurable.
- Betterstack transport, `runId`/`chainId`, heartbeat ping — Phase 8 concern. Phase 7 leaves placeholder env var lines in the sepolia.env stub template but does not wire them.
- Mainnet systemd instance activation — Phase 9 concern. Phase 7's instance-template design (D-11) makes Mainnet a one-line enable command.

</deferred>

---

*Phase: 07-packaging*
*Context gathered: 2026-04-23*
