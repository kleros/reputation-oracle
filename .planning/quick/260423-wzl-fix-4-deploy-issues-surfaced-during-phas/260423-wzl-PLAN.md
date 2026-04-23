---
quick_id: 260423-wzl
type: quick
autonomous: true
files_modified:
  - deploy/bootstrap.sh
  - deploy/RUNBOOK.md

must_haves:
  truths:
    - "bootstrap.sh purges Ubuntu-shipped nodejs before NodeSource install — no libnode-dev conflict"
    - "bootstrap.sh creates oracle home dir — npm ci can write .npm cache"
    - "RUNBOOK.md dry-run commands cd into bot/ first — tsx resolves from node_modules"
    - "RUNBOOK.md Useful Commands block uses sudo prefix on all journalctl/systemctl commands"
  artifacts:
    - path: deploy/bootstrap.sh
      provides: "Idempotent VPS provisioner"
      contains: "apt-get remove --purge -y nodejs libnode-dev npm"
    - path: deploy/RUNBOOK.md
      provides: "Operator runbook"
      contains: "cd /opt/reputation-oracle/bot &&"
---

<objective>
Fix 4 deploy issues discovered during Phase 7 live VPS provisioning on Ubuntu 24.04.

Purpose: bootstrap.sh and RUNBOOK.md had two bugs each that blocked a clean VPS install.
Output: Working deploy/bootstrap.sh and deploy/RUNBOOK.md with all 4 issues resolved.
</objective>

<execution_context>
@/Users/jaybuidl/project/kleros/reputation-oracle/.claude/get-shit-done/workflows/execute-plan.md
@/Users/jaybuidl/project/kleros/reputation-oracle/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

<!-- Key facts from required reading:
  - systemd unit: WorkingDirectory=/opt/reputation-oracle/bot, ExecStart uses bare `--import tsx`
  - bot/package.json: tsx is in dependencies (not devDependencies) — correct already
  - bootstrap.sh step 2: NodeSource curl at line 43; step 3: useradd at line 57
  - RUNBOOK.md §3 dry-run: lines 104-107 and 123-127; §5 Useful Commands: lines 253-280
  - Do NOT add start:prod to bot/package.json — cwd fix makes it unnecessary
  - Do NOT modify systemd unit — WorkingDirectory already correct
-->
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix bootstrap.sh — purge conflicting nodejs + create oracle home dir</name>
  <files>deploy/bootstrap.sh</files>
  <action>
Two targeted edits to deploy/bootstrap.sh:

**Edit A — Step 2 (NodeSource install, around line 42-44):**

Before the `curl -fsSL https://deb.nodesource.com/setup_22.x | bash -` line, insert two new lines
that purge the Ubuntu-shipped nodejs packages. These ship with Ubuntu 24.04 as `libnode-dev` and
conflict with the NodeSource package. The insert goes INSIDE the `else` branch, before the curl:

```bash
  >&2 echo "[bootstrap] Purging Ubuntu-shipped nodejs to prevent NodeSource conflict..."
  apt-get remove --purge -y nodejs libnode-dev npm 2>/dev/null || true
  apt-get autoremove -y
  >&2 echo "[bootstrap] Installing Node 22 via NodeSource apt..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
```

The `2>/dev/null || true` ensures idempotency — if none of these packages exist the command exits 0.
`apt-get autoremove -y` cleans up orphaned deps left behind by the purge.

**Edit B — Step 3 (useradd, around line 57):**

Change:
```bash
  useradd --system --no-create-home --shell /usr/sbin/nologin oracle
```
To:
```bash
  useradd --system --shell /usr/sbin/nologin oracle
```

Drop `--no-create-home`. Without a home dir, `npm ci` (step 6) fails because npm writes to
`$HOME/.npm` cache. The `/usr/sbin/nologin` shell already blocks interactive logins.
The `if id oracle` idempotency guard around step 3 is unaffected — leave it as-is.

Also update the RUNBOOK.md §1 description of Step 3 to remove `--no-create-home` from the
descriptive prose line:
  "Creates `oracle` system user with no shell, no home — `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`"
Change to:
  "Creates `oracle` system user — `useradd --system --shell /usr/sbin/nologin oracle` (`/usr/sbin/nologin` blocks interactive login; home dir required for `npm ci` cache)"

Wait — RUNBOOK.md is Task 2's file. Update that prose in Task 2.
  </action>
  <verify>
    <automated>bash -n deploy/bootstrap.sh && grep -c "apt-get remove --purge -y nodejs libnode-dev npm" deploy/bootstrap.sh && grep -c "\-\-no-create-home" deploy/bootstrap.sh</automated>
  </verify>
  <done>
    - `bash -n deploy/bootstrap.sh` exits 0 (no syntax errors)
    - `grep -c "apt-get remove --purge -y nodejs libnode-dev npm"` returns 1
    - `grep -c "\-\-no-create-home"` returns 0 (flag removed)
  </done>
</task>

<task type="auto">
  <name>Task 2: Fix RUNBOOK.md — dry-run cwd prefix + sudo prefixes in Useful Commands</name>
  <files>deploy/RUNBOOK.md</files>
  <action>
Three targeted edits to deploy/RUNBOOK.md:

**Edit A — §3 First-Run Verification, dry-run block 1 (around line 104-107):**

Change:
```bash
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```
To:
```bash
sudo -u oracle bash -c 'cd /opt/reputation-oracle/bot && /usr/bin/node \
  --env-file=/etc/reputation-oracle/sepolia.env \
  --import tsx src/index.ts --dry-run'
```

Note: `index.ts` path becomes relative (`src/index.ts`) after cd. `--env-file` changes to
`--env-file=` (equals form) for clarity, though both forms work with Node 22.

**Edit B — §3 First-Run Verification, dry-run block 2 (around line 123-127, the RunSummary parse block):**

Change:
```bash
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run \
  | grep '"type":"RunSummary"' | python3 -m json.tool
```
To:
```bash
sudo -u oracle bash -c 'cd /opt/reputation-oracle/bot && /usr/bin/node \
  --env-file=/etc/reputation-oracle/sepolia.env \
  --import tsx src/index.ts --dry-run' \
  | grep '"type":"RunSummary"' | python3 -m json.tool
```

The pipe to `grep | python3` stays outside the bash -c string (it runs in the caller's shell).

**Edit C — §8 Troubleshooting, Useful Commands block (around lines 253-280):**

Audit every bare `journalctl` and `systemctl` command in the Useful Commands block. Add `sudo `
prefix where missing. Specifically:

Lines that need `sudo ` added:
- `journalctl -u reputation-oracle@sepolia -n 50`  →  `sudo journalctl -u reputation-oracle@sepolia -n 50`
- `journalctl -u reputation-oracle@sepolia -f`  →  `sudo journalctl -u reputation-oracle@sepolia -f`
- `journalctl -u reputation-oracle@sepolia -o json | head -5`  →  `sudo journalctl -u reputation-oracle@sepolia -o json | head -5`
- `systemctl list-timers reputation-oracle@sepolia.timer`  →  `sudo systemctl list-timers reputation-oracle@sepolia.timer`
- `journalctl --disk-usage`  →  `sudo journalctl --disk-usage`

Lines that ALREADY have sudo — leave unchanged:
- `systemctl show reputation-oracle@sepolia.service | grep ExecMainStatus` — check if sudo present, add if not

Non-root users get "permission denied" reading service-specific journal entries. Consistent `sudo`
prefix across the entire block prevents confusion for first-time operators.

**Edit D — §1 What bootstrap does, Step 3 description:**

Update the prose description of Step 3 from:
  "Creates `oracle` system user with no shell, no home — `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`"
To:
  "Creates `oracle` system user — `useradd --system --shell /usr/sbin/nologin oracle` (`/usr/sbin/nologin` blocks interactive login; home dir required for `npm ci` cache)"
  </action>
  <verify>
    <automated>grep -c "cd /opt/reputation-oracle/bot &&" deploy/RUNBOOK.md && grep -c "\-\-no-create-home" deploy/RUNBOOK.md</automated>
  </verify>
  <done>
    - `grep -c "cd /opt/reputation-oracle/bot &&"` returns >= 2 (both dry-run blocks fixed)
    - `grep -c "\-\-no-create-home"` returns 0 (prose updated to remove mention)
    - All bare `journalctl`/`systemctl` commands in Useful Commands block have `sudo ` prefix
  </done>
</task>

</tasks>

<verification>
After both tasks complete:

```bash
# Task 1 checks
bash -n deploy/bootstrap.sh
grep "apt-get remove --purge -y nodejs libnode-dev npm" deploy/bootstrap.sh
grep -c "\-\-no-create-home" deploy/bootstrap.sh   # must be 0

# Task 2 checks
grep -c "cd /opt/reputation-oracle/bot &&" deploy/RUNBOOK.md   # must be >= 2
grep -n "sudo journalctl -u\|sudo systemctl" deploy/RUNBOOK.md | wc -l
# compare to before — count should increase
```
</verification>

<success_criteria>
- bootstrap.sh: purge block present before NodeSource curl; `--no-create-home` gone from useradd
- bootstrap.sh: `bash -n` passes (syntax clean)
- RUNBOOK.md: both dry-run blocks use `bash -c 'cd /opt/reputation-oracle/bot && ...'` form
- RUNBOOK.md: all journalctl/systemctl commands in Useful Commands carry `sudo ` prefix
- RUNBOOK.md: §1 prose no longer mentions `--no-create-home`
- bot/package.json: NOT modified (no `start:prod` added)
- deploy/systemd/reputation-oracle@.service: NOT modified
- DEPLOY_ISSUES.md at repo root: NOT deleted (user may remove manually after fixes ship)
</success_criteria>

<commit>
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(deploy-wzl): purge conflicting nodejs, drop --no-create-home, fix dry-run cwd + sudo prefixes

bootstrap.sh (260423-wzl):
- Purge ubuntu-shipped nodejs/libnode-dev/npm before NodeSource setup_22.x to prevent
  apt conflict on Ubuntu 24.04 (operator had to manually purge and retry)
- Drop --no-create-home from useradd: npm ci needs $HOME/.npm cache dir;
  /usr/sbin/nologin already blocks interactive login

RUNBOOK.md (260423-wzl):
- Both dry-run blocks wrap node invocation in bash -c 'cd /opt/reputation-oracle/bot && ...'
  to match systemd WorkingDirectory; bare --import tsx only resolves from bot/node_modules
- Useful Commands: add sudo prefix to all bare journalctl/systemctl calls;
  non-root users hit permission denied on service-specific journal reads

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
</commit>

<output>
After completion, create `.planning/quick/260423-wzl-fix-4-deploy-issues-surfaced-during-phas/260423-wzl-SUMMARY.md`

Fields to include:
- quick_id: 260423-wzl
- files_modified: [deploy/bootstrap.sh, deploy/RUNBOOK.md]
- commit: (hash after commit)
- status: Complete
- issues_fixed: 4 (libnode-dev conflict, --no-create-home, dry-run cwd x2, sudo prefixes)
</output>
