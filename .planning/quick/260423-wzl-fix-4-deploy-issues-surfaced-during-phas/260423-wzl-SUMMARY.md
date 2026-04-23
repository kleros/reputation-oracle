---
quick_id: 260423-wzl
status: Complete
date: "2026-04-23"
commit: 0ed9f2a
files_modified:
  - deploy/bootstrap.sh
  - deploy/RUNBOOK.md
issues_fixed: 4
tags: [deploy, bootstrap, runbook, ubuntu, nodejs, systemd]
---

# Quick Task 260423-wzl: Fix 4 Deploy Issues Surfaced During Phase 7 VPS Provisioning

**One-liner:** Fixed 4 Ubuntu 24.04 VPS provisioning blockers: libnode-dev apt conflict, missing npm cache home dir, tsx resolution failure in dry-run, and sudo-less journalctl/systemctl commands.

## Issues Fixed

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `deploy/bootstrap.sh` | Ubuntu 24.04 ships `libnode-dev` which conflicts with NodeSource `nodejs` package — apt errors out mid-install | Added `apt-get remove --purge -y nodejs libnode-dev npm && apt-get autoremove -y` before the NodeSource `curl \| bash` line |
| 2 | `deploy/bootstrap.sh` | `--no-create-home` on `useradd` meant no `$HOME/.npm` cache dir — `npm ci` (step 6) fails writing npm cache | Dropped `--no-create-home`; `/usr/sbin/nologin` already blocks interactive login |
| 3 | `deploy/RUNBOOK.md` | Both dry-run commands invoked node as `node --import tsx /opt/.../bot/src/index.ts` without `cd`-ing into `bot/` — tsx resolves from `node_modules/` relative to cwd, not the absolute path | Wrapped both blocks in `bash -c 'cd /opt/reputation-oracle/bot && /usr/bin/node --import tsx src/index.ts ...'` |
| 4 | `deploy/RUNBOOK.md` | Useful Commands block had bare `journalctl`/`systemctl` calls — non-root users get permission denied reading service-specific journal entries | Added `sudo ` prefix to all 5 affected commands in the block |

## Commit

`0ed9f2a` — `fix(deploy-wzl): purge conflicting nodejs, drop --no-create-home, fix dry-run cwd + sudo prefixes`

## Verification

```
bash -n deploy/bootstrap.sh                                          → syntax OK
grep -c "apt-get remove --purge -y nodejs libnode-dev npm" ...       → 1
grep -c "\-\-no-create-home" deploy/bootstrap.sh                     → 0
grep -c "cd /opt/reputation-oracle/bot &&" deploy/RUNBOOK.md         → 2
grep -c "\-\-no-create-home" deploy/RUNBOOK.md                       → 0
sudo journalctl/systemctl lines in Useful Commands                   → 14 (all prefixed)
```

## Deviations

None — plan executed exactly as written.

## Self-Check: PASSED

- `deploy/bootstrap.sh` modified: confirmed (2 edits)
- `deploy/RUNBOOK.md` modified: confirmed (4 edits)
- Commit `0ed9f2a` exists: confirmed
- `bot/package.json` NOT modified: confirmed
- `deploy/systemd/reputation-oracle@.service` NOT modified: confirmed
- `DEPLOY_ISSUES.md` NOT deleted: confirmed (constraint respected)
