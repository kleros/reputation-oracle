---
phase: 07-packaging
plan: "01"
subsystem: bot
tags: [packaging, npm, tsx, dependencies]
dependency_graph:
  requires: []
  provides: [tsx-in-prod-deps]
  affects: [deploy/bootstrap.sh, systemd-npm-ci]
tech_stack:
  added: []
  patterns: [npm-ci-omit-dev, node-import-tsx]
key_files:
  created: []
  modified:
    - bot/package.json
    - bot/package-lock.json
decisions:
  - "tsx promoted to dependencies (not devDependencies) — npm ci --omit=dev would silently drop it otherwise (P1-02, D-04)"
metrics:
  duration: "5m"
  completed: "2026-04-23"
  tasks_completed: 2
  files_changed: 2
---

# Phase 7 Plan 1: tsx Dependency Promotion Summary

**One-liner:** Promoted `tsx@^4.21.0` from `devDependencies` to `dependencies` so `npm ci --omit=dev` includes it for VPS production installs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Move tsx from devDependencies to dependencies | 24c380c | bot/package.json, bot/package-lock.json |
| 2 | Verify production install succeeds with tsx resolvable | (no commit — transient verification) | bot/node_modules (restored) |

## Verification Results

- `npm ci --omit=dev` completed without error
- `bot/node_modules/tsx/package.json` exists after `--omit=dev` install
- `node --import tsx src/index.ts --dry-run` emits zod config error (no env vars), NOT `ERR_MODULE_NOT_FOUND`
- Dev install restored with `npm install`
- All 81 vitest tests pass (0 failures)
- Biome lint: 0 findings (no bot src changes)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — changes are confined to package.json dependency placement. No new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- [x] `bot/package.json` has tsx in dependencies, not devDependencies
- [x] `bot/package-lock.json` updated (4 lockfile entries for tsx)
- [x] Commit 24c380c exists in git log
- [x] All 81 tests pass
