---
phase: 07-packaging
plan: "02"
subsystem: deploy
tags: [packaging, systemd, journald, hardening]
dependency_graph:
  requires: [tsx-in-prod-deps]
  provides: [systemd-service-template, systemd-timer-template, journald-drop-in]
  affects: [deploy/bootstrap.sh]
tech_stack:
  added: []
  patterns: [systemd-instance-units, oneshot-timer-pattern, journald-drop-in]
key_files:
  created:
    - deploy/systemd/reputation-oracle@.service
    - deploy/systemd/reputation-oracle@.timer
    - deploy/journald.conf.d/reputation-oracle.conf
  modified: []
decisions:
  - "Type=oneshot with no Restart= — timer is retry mechanism; Restart=on-failure would thrash on 429s (D-14, P1-03)"
  - "AccuracySec=30s per CONTEXT.md D-13 (authoritative over STACK.md which said 1s)"
  - "Exactly 4 hardening directives per D-15 — no speculative extras (MemoryMax, CPUQuota, ProtectHome)"
  - "No [Install] on service unit — timer owns WantedBy=timers.target; service is triggered, not enabled directly"
  - "EnvironmentFile= only for secrets — no inline Environment=KEY=val for sensitive values (T-07-02-01 mitigation)"
metrics:
  duration: "5m"
  completed: "2026-04-23"
  tasks_completed: 3
  files_changed: 3
---

# Phase 7 Plan 2: systemd Unit Files and journald Drop-in Summary

**One-liner:** Created instance-unit service template, timer template, and journald retention drop-in for VPS deployment — all three files ready for bootstrap.sh to install in Plan 07-03.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create deploy/systemd/ and service unit template | b77f21b | deploy/systemd/reputation-oracle@.service |
| 2 | Create timer unit template | 0b85fc0 | deploy/systemd/reputation-oracle@.timer |
| 3 | Create journald retention drop-in | 010b754 | deploy/journald.conf.d/reputation-oracle.conf |

## Verification Results

- Hardening directive count: 4 (ProtectSystem, PrivateTmp, NoNewPrivileges, TimeoutStartSec)
- Forbidden directives: none (Restart=, ProtectHome=, MemoryMax=, CPUQuota=, ReadWritePaths= absent)
- `%i` instance specifier present in: Description, EnvironmentFile, SyslogIdentifier (service); Description, Unit= (timer)
- Timer: OnUnitActiveSec=15min, RandomizedDelaySec=60, Persistent=true, AccuracySec=30s
- journald: [Journal] / SystemMaxUse=500M / SystemMaxFileSize=50M
- All automated grep checks from plan PASSED

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or code changes. Files are deployment configuration only.

Threat mitigations confirmed applied:
- T-07-02-01: No `Environment=KEY=secret` in unit files; EnvironmentFile= used exclusively
- T-07-02-02: User=oracle, Group=oracle explicit; NoNewPrivileges=true set
- T-07-02-04: TimeoutStartSec=300 set — hung bot killed after 5 min
- T-07-02-05: No Restart= directive — timer is the retry mechanism
- T-07-02-06: SystemMaxUse=500M cap in journald drop-in

## Self-Check: PASSED

- [x] `deploy/systemd/reputation-oracle@.service` exists — commit b77f21b
- [x] `deploy/systemd/reputation-oracle@.timer` exists — commit 0b85fc0
- [x] `deploy/journald.conf.d/reputation-oracle.conf` exists — commit 010b754
- [x] All three commits exist in git log
- [x] All verification checks from plan pass (hardening count=4, no forbidden directives, %i preserved throughout)
