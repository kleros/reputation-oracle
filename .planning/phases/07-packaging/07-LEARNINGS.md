---
phase: 07
phase_name: "packaging"
project: "Kleros Reputation Oracle"
generated: "2026-04-23"
counts:
  decisions: 16
  lessons: 5
  patterns: 9
  surprises: 5
missing_artifacts: []
---

# Phase 07 Learnings: packaging

## Decisions

### tsx promoted to runtime `dependencies`
`tsx@^4.21.0` moved from `devDependencies` to `dependencies`.

**Rationale:** `npm ci --omit=dev` on the VPS would silently drop it, breaking `node --import tsx` at startup (P1-02, D-04). No TypeScript compile step in this deploy layout.
**Source:** 07-01-SUMMARY.md

---

### systemd `Type=oneshot` with no `Restart=`
Service unit runs to completion and exits.

**Rationale:** The timer is the retry mechanism. `Restart=on-failure` would thrash on 429s and fight the timer's back-off (D-14, P1-03).
**Source:** 07-02-SUMMARY.md

---

### `AccuracySec=30s` (CONTEXT.md D-13 beats STACK.md `1s`)
Timer trades tight firing for batched system wake-ups.

**Rationale:** 15-min cadence does not require sub-second accuracy; 30s slack lets systemd coalesce wakes on shared power states. CONTEXT.md D-13 treated as authoritative when STACK.md conflicts.
**Source:** 07-02-SUMMARY.md

---

### Exactly 4 hardening directives — no speculative extras
`ProtectSystem=strict`, `PrivateTmp=true`, `NoNewPrivileges=true`, `TimeoutStartSec=300`.

**Rationale:** Per D-15, add MemoryMax/CPUQuota/ProtectHome only if a concrete threat motivates them. Unmotivated hardening creates debug noise and silent failures later.
**Source:** 07-02-SUMMARY.md

---

### No `[Install]` on the service unit; timer owns `WantedBy=timers.target`
Service is triggered, never enabled directly.

**Rationale:** Prevents the operator mistake of `systemctl enable ...@.service` running the bot outside the timer's schedule.
**Source:** 07-02-SUMMARY.md

---

### `EnvironmentFile=` only — never inline `Environment=KEY=val`
All secrets live in `/etc/reputation-oracle/%i.env` at mode 0600.

**Rationale:** `systemctl show` prints inline `Environment=` values. `EnvironmentFile=` contents stay on disk (T-07-02-01 mitigation).
**Source:** 07-02-SUMMARY.md

---

### Secret stub created via `install -m 0600 -o oracle -g oracle /dev/null` then heredoc append
Never `echo >>` or `cat <<EOF >` with real values.

**Rationale:** `install` sets ownership + mode atomically; heredoc-only-with-placeholders keeps real secret values out of bash history (D-16, P1-12).
**Source:** 07-03-SUMMARY.md

---

### Bootstrap step order is load-bearing
Step 3 `useradd` precedes steps 5/6/7 (chown, npm ci, install -o oracle).

**Rationale:** `chown oracle:oracle` on a user that doesn't exist fails silently on some distros (D-23; fixes the circular dependency noted in D-21).
**Source:** 07-03-SUMMARY.md

---

### Bootstrap never enables or starts the timer
Operator enables manually via `start-timer.sh` after dry-run passes.

**Rationale:** The dry-run is the acceptance gate. Auto-enabling would burn gas on a bad config before the operator has a chance to read the RunSummary (D-24).
**Source:** 07-03-SUMMARY.md

---

### Permissions asserted via `stat -c '%a %U %G'` before bootstrap exits
Fails loudly with fix instructions if the env file is not `0600 oracle oracle`.

**Rationale:** A pre-existing file with wrong perms is silent data loss otherwise — subsequent runs appear to succeed but journald leaks credentials.
**Source:** 07-03-SUMMARY.md

---

### `update.sh` four-step order: stop → pull → ci → start
No extra `git` steps (fetch, stash) inserted.

**Rationale:** Every extra step is a new failure mode during a live incident. Ordered atomicity prevents partial-update states (P1-09).
**Source:** 07-04-SUMMARY.md

---

### `on_error` trap captures timer state at failure time
`systemctl is-active` called inside the trap.

**Rationale:** Operator reading the failure message immediately knows if the timer is live (bot still firing broken code) or stopped (service outage). Informs recovery strategy.
**Source:** 07-04-SUMMARY.md

---

### `start-timer.sh` takes `[sepolia|mainnet]` instance arg (not hardcoded)
`case` statement allowlist.

**Rationale:** Phase 9 Mainnet reuse with zero code changes; fail-closed on typos.
**Source:** 07-04-SUMMARY.md

---

### Single `deploy/RUNBOOK.md` (not split per concern)
One document operator bookmarks during incidents.

**Rationale:** Per D-39, incident latency matters more than modularity. A 278-line single file beats five cross-linked files when someone is paging at 3am.
**Source:** 07-05-SUMMARY.md

---

### README `## Deployment` section appended at end (no existing content reordered)
Minimal footprint on the repo landing page.

**Rationale:** README is a reader's first impression; preserving existing structure prevents merge churn and reader confusion.
**Source:** 07-05-SUMMARY.md

---

### Acceptance checklist maps 1:1 to PKG-01..PKG-08 with exact shell commands
33 checkboxes with concrete expected output, not prose.

**Rationale:** "It should work" vs. `# Expected: active\nactive` — the latter is unambiguous and copy-pasteable. Aligns acceptance with requirement traceability.
**Source:** 07-06-SUMMARY.md

---

## Lessons

### Plan-level verification can't catch cross-artifact drift
07-05 RUNBOOK documented SUBGRAPH_URL as "pre-filled default correct for Sepolia" while 07-03 bootstrap.sh wrote it blank. Each plan verified independently passed; only the code-review agent, reading both files together, caught the contradiction.

**Context:** Phase verification agents read plans and summaries one at a time. Cross-file consistency is a code-review problem, not a plan-verifier problem.
**Source:** 07-REVIEW.md WR-02

---

### `env $(cat ... | xargs)` has two real bugs nobody caught during planning
Word-splits on whitespace inside env values and leaks `BOT_PRIVATE_KEY` into `/proc/self/cmdline`. The pattern was in CONTEXT.md D-29, copied into both RUNBOOK.md and ACCEPTANCE.md, survived plan review, and only surfaced at code-review.

**Context:** Upstream CONTEXT.md decisions propagate unquestioned. A spec-level bug cascades into every plan that references it. Node 22 native `--env-file` is the correct primitive.
**Source:** 07-REVIEW.md WR-03 + 07-REVIEW-FIX.md

---

### `update.sh` silently dropped systemd unit changes
The "4-step atomic update" never re-copied unit files to `/etc/systemd/system/` or ran `daemon-reload`. A `git pull` that changed the timer interval would be ignored by systemd indefinitely — no error, no warning.

**Context:** Atomicity was framed around the bot (stop → ci → start) but systemd state was orthogonal. The plan didn't ask "what about unit files?" because the mental model was "code update" not "deployment update".
**Source:** 07-REVIEW.md WR-01

---

### Bot `--dry-run` doesn't self-test without a stub env file
`node --import tsx src/index.ts --dry-run` exits with a zod config error (missing `BOT_PRIVATE_KEY` etc.) rather than a runnable dry-run. Module resolution is confirmed healthy, but end-to-end dry-run requires real secrets.

**Context:** SC-2 verification is split — `npm ci --omit=dev` correctness can be fully automated, but PKG-08 live dry-run needs real Sepolia RPC + real subgraph + real secrets, which is why ACCEPTANCE.md exists.
**Source:** 07-01-SUMMARY.md verification results + 07-VERIFICATION.md SC-2

---

### Executor's per-plan completion update races ahead of phase verification
Closing the final plan (07-06) via `update-plan-progress complete` flipped the ROADMAP checkbox to `[x] Phase 7 (completed 2026-04-23)` **before** the phase verifier returned `human_needed`. The auto-marker is plan-local and doesn't know about phase-level UAT gating.

**Context:** Phase 7's success depends on a live VPS that doesn't exist in the repo. Marking it `[x]` before live-VPS acceptance misrepresents ship status. Added as a durable feedback memory (`feedback_phase_complete_gating.md`) for future phases with live-infra UAT.
**Source:** 07-HUMAN-UAT.md + ROADMAP.md rollback commit 0baa730

---

## Patterns

### Idempotent bash provisioner
Every mutation is guarded by a check-before-act: `id oracle >/dev/null 2>&1 || useradd ...`, `node --version | grep -q v22 || curl | apt ...`, `test -f /etc/reputation-oracle/sepolia.env || install ...`.

**When to use:** Any shell script that could be re-run on partial-completion state (bootstrap, upgrade, incident recovery).
**Source:** 07-03-SUMMARY.md

---

### Secure secret stub via `install -m 0600 -o user -g group /dev/null` + heredoc
Atomic mode/owner set; no real secrets ever in the script body; heredoc only has placeholder values with comments explaining format.

**When to use:** Any time a bootstrap script creates a secrets file the operator must later edit.
**Source:** 07-03-SUMMARY.md

---

### `trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR` with `CURRENT_STEP` variable
Every major block sets `CURRENT_STEP="step-name"` before executing. On error, the trap prints the human-readable step name + line + command + (for update.sh) timer live-state.

**When to use:** Strict-bash scripts (`set -euo pipefail`) where a raw line-number-only failure is too opaque for operators.
**Source:** 07-03-SUMMARY.md, 07-04-SUMMARY.md

---

### Banners to stderr, data to stdout
All `>&2 echo "[step] …"` progress messages; stdout reserved for machine-parseable output (e.g., RunSummary JSON).

**When to use:** Scripts whose stdout may be piped to `jq`, logged to a file, or captured by a supervisor.
**Source:** 07-03-SUMMARY.md

---

### Atomic 5-step update: stop → pull → reinstall-units + daemon-reload → ci → start
Revised from the original 4-step after WR-01 — systemd unit file refresh is its own step.

**When to use:** Any bot-plus-systemd-unit deployment where `git pull` can modify `.service`/`.timer` files.
**Source:** 07-04-SUMMARY.md + 07-REVIEW-FIX.md ec5bebd

---

### Instance-arg allowlist: `case "$1" in sepolia|mainnet) … ;; *) exit 1 ;; esac`
Scripts take an environment argument, validated up front with an explicit allowlist.

**When to use:** Any script that will be reused across environments (Sepolia → Mainnet, staging → prod). Prevents typo-driven misfires.
**Source:** 07-04-SUMMARY.md

---

### Dry-run acceptance gate before timer enable
Two-step human validation: bootstrap provisions but does NOT enable timer → operator runs dry-run manually → operator runs `start-timer.sh` only after RunSummary looks right.

**When to use:** Any deployment that spends money/tokens/gas on each run. Auto-enable is a footgun when config can be subtly wrong.
**Source:** 07-03-SUMMARY.md + 07-05-SUMMARY.md

---

### Acceptance checklist with 1:1 requirement mapping and concrete expected output
One section per requirement ID (PKG-01..PKG-08), each with exact shell commands and `# Expected: …` comments. Operator marks `[x]` inline.

**When to use:** Any phase whose success criteria depend on live infrastructure that can't be simulated in CI.
**Source:** 07-06-SUMMARY.md

---

### `node --env-file <path>` over `env $(cat <path> | xargs) node ...`
Node 22's native `--env-file` flag loads env vars without shell word-splitting and without exposing them in `/proc/self/cmdline`.

**When to use:** Any command that needs to load production env vars into a Node process. Only pattern that is safe for files containing secrets.
**Source:** 07-REVIEW-FIX.md (commit 0b08913) — replaces the pattern originally adopted from CONTEXT.md D-29.

---

## Surprises

### Code-review found 3 real warnings that plan-verification missed
All three (silent daemon-reload drop, SUBGRAPH_URL drift, xargs-word-splitting/leak) were "code works as designed but design is wrong" — not typos, not syntax. Plan verifiers check "is the artifact present and well-formed"; they don't reason about interactions between artifacts or security implications.

**Impact:** Confirmed that code-review is a non-negotiable phase gate, not optional polish. Saved three operator-visible bugs from reaching a live VPS.
**Source:** 07-REVIEW.md + 07-REVIEW-FIX.md

---

### Executor flipped ROADMAP `[x]` complete before verifier ran
Plan 07-06's closeout commit `update-plan-progress complete` also auto-advanced phase status, so ROADMAP showed `[x] Phase 7 … (completed 2026-04-23)` seconds before the verifier returned `status: human_needed`.

**Impact:** Had to revert the marker to `[ ]` with "_awaiting live-VPS acceptance_" note. Saved as a feedback memory so future phases with live-infra UAT don't repeat the race.
**Source:** 07-VERIFICATION.md + commit 0baa730

---

### Phase wall-clock ~15 minutes across 6 plans
Per-plan durations: P01 5m, P02 5m, P03 2m, P04 48s, P05 2m, P06 2m. Significantly faster than v1.1 phases because deliverables are configs/scripts with no new runtime tests to author.

**Impact:** Reset expectations for future config/deploy phases — estimate in minutes, not hours. The opposite direction from e.g. Phase 5 (transaction safety) which was multi-hour because of viem error-classification work.
**Source:** All 07-0{1..6}-SUMMARY.md metrics blocks

---

### All 5 human-verification items require real Ubuntu 24.04 + real Sepolia infra
None of them can be closed in CI or on macOS. No amount of local simulation would reduce the UAT surface.

**Impact:** `deploy/ACCEPTANCE.md` is not redundant with `07-HUMAN-UAT.md` — it IS the hand-off artifact. Phase close depends on a live VPS existing, which is a separate operational blocker.
**Source:** 07-VERIFICATION.md human_verification section

---

### A single CONTEXT.md decision (D-29) cascaded a security bug into two files
The `env $(cat ... | xargs)` dry-run pattern was enshrined in CONTEXT.md, then copied verbatim into RUNBOOK.md and ACCEPTANCE.md. One spec-level bug became three files to fix.

**Impact:** Upstream artifacts (CONTEXT.md, RESEARCH.md) deserve their own scrutiny — decisions there propagate unchallenged through every downstream plan. Treat CONTEXT.md amendments as equally high-stakes to code changes.
**Source:** 07-REVIEW.md WR-03 + 07-05-SUMMARY.md + 07-06-SUMMARY.md (both carry the same flawed command)

---
