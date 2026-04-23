# Pitfalls Research

**Domain:** v1.2 Deploy-to-Mainnet — VPS packaging, Betterstack observability, Ethereum Mainnet cutover
**Researched:** 2026-04-23
**Confidence:** HIGH (systemd/packaging and Ethereum patterns are well-established; Betterstack patterns derived from official docs + existing research)

---

## Category 1: Packaging / systemd / VPS

### P1-01: Running the bot as root

- **Symptom:** `systemctl show reputation-oracle` → `User=root`. Bot has access to all system files.
- **Impact:** blocker (security baseline violation)
- **Prevention:** `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`; `User=oracle` + `Group=oracle` in `[Service]`. Add `NoNewPrivileges=true`, `ProtectSystem=strict`. Unit file must not have `User=` missing (defaults to root).
- **Owning phase:** Packaging

---

### P1-02: `npm ci --omit=dev` silently breaks tsx execution

- **Symptom:** `systemctl start reputation-oracle` exits immediately; `journalctl -u reputation-oracle -n 5` shows `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'`.
- **Impact:** blocker (bot never runs)
- **Prevention:** tsx is currently a devDependency. Move it to `dependencies` in `package.json` before writing the bootstrap runbook. Verify with `npm ci --omit=dev && node --import tsx src/index.ts --dry-run` as the acceptance test.
- **Owning phase:** Packaging

---

### P1-03: `Restart=on-failure` thrashing a one-shot bot

- **Symptom:** Bot exits 1 (systemic failure); systemd immediately restarts; bot re-runs before root cause is resolved; 429 / rate-limit spiral on subgraph or RPC; logs flood; Betterstack quota exhausted.
- **Impact:** major (amplifies failures; kills free-tier quotas)
- **Prevention:** `Type=oneshot` + **no `Restart=` directive** (default is `Restart=no`). The timer, not systemd restart logic, is the retry mechanism. One-shot failures are detected by Betterstack heartbeat absence — not by systemd restart.
- **Owning phase:** Packaging

---

### P1-04: Missing `TimeoutStartSec` lets a hung bot block the timer indefinitely

- **Symptom:** Bot hangs (e.g. RPC call with no timeout, stuck Betterstack flush). systemd waits forever (default `TimeoutStartSec=infinity` for `Type=oneshot`). Next timer tick never fires because service is still "activating". Journald shows no new entries for hours.
- **Impact:** major (silent operational halt)
- **Prevention:** Add `TimeoutStartSec=300` (5 min) to `[Service]`. Bot normally completes in 5–30 seconds; 5 min is generous. When timeout is hit, systemd sends SIGKILL → service exits → timer re-fires at next interval.
- **Owning phase:** Packaging

---

### P1-05: `EnvironmentFile` wrong permissions leak secrets

- **Symptom:** `ls -la /etc/reputation-oracle/env` shows `-rw-r--r--` (world-readable) or `-rw-rw-r--` (group-readable). Any user on the VPS (e.g. a web process) can read `BOT_PRIVATE_KEY` and `PINATA_JWT`.
- **Impact:** blocker (secret exfiltration risk)
- **Prevention:** `install -m 0600 -o root -g root /dev/null /etc/reputation-oracle/sepolia.env`. Verify: `stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env` must print `600 root root`. Include this check in the bootstrap runbook acceptance step.
- **Owning phase:** Packaging

---

### P1-06: Inline `Environment=KEY=val` in unit file leaks secrets via `systemctl show`

- **Symptom:** `systemctl show reputation-oracle` prints all `Environment=` entries in cleartext. Any user with `sudo systemctl show` or `systemctl --user show` access can read secrets. Shell history also captures inline values if set via `systemctl set-property`.
- **Impact:** major (secret leak without file access)
- **Prevention:** Never put secret values in `Environment=` directives. Use `EnvironmentFile=/etc/reputation-oracle/sepolia.env` exclusively. Non-secret config (e.g. `LOG_LEVEL=info`) is safe as `Environment=`.
- **Owning phase:** Packaging

---

### P1-07: nvm-managed Node invisible to systemd

- **Symptom:** `ExecStart=/home/oracle/.nvm/versions/node/v22.1.0/bin/node ...` works manually but fails when systemd runs it: `No such file or directory`. Or node path changes after `nvm use` and unit file is stale.
- **Impact:** blocker (service never starts)
- **Prevention:** Install Node 22 via NodeSource apt (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`). Node lands at `/usr/bin/node` — a stable, system-wide path. Never use nvm on the VPS.
- **Owning phase:** Packaging

---

### P1-08: journald `SystemMaxUse` not set → silent log loss during incident

- **Symptom:** VPS disk fills up. journald silently drops new entries. `journalctl -u reputation-oracle` shows a gap or `-- Boot UUID ... --` with no entries in the incident window. Operator can't diagnose the failure.
- **Impact:** major (evidence loss during the incident you most need logs for)
- **Prevention:** Set in `/etc/systemd/journald.conf`: `SystemMaxUse=500M`, `SystemMaxFileSize=50M`. Restart journald: `systemctl restart systemd-journald`. At 15-min cadence this bot produces < 1 MB/day — 500 MB is years of retention.
- **Owning phase:** Packaging

---

### P1-09: Git pull mid-run races with active on-chain transactions

- **Symptom:** `git pull origin master` while the timer is mid-run; Node loads a half-updated module tree; partial tx submitted with old Router ABI but new bot logic; or worse, `node_modules` updated while module cache hot. Non-deterministic failure.
- **Impact:** major (unpredictable tx behavior; possible double-submit)
- **Prevention:** Atomic deploy pattern: `git fetch && git stash` → stop timer → `git merge` + `npm ci --omit=dev` → start timer. Runbook must include `systemctl stop reputation-oracle-sepolia.timer` as step 1. One skipped cycle (< 15 min) is acceptable — stateless bot catches up on next run.
- **Owning phase:** Packaging

---

### P1-10: VPS time skew causes subgraph timestamp drift

- **Symptom:** Subgraph query uses block timestamps. VPS clock drifts (NTP misconfigured or disabled). `Date.now()` in bot evidence CID drifts from real block time. Minor in practice but can cause evidence `timestamp` field to be hours off in Betterstack logs, making incident timelines unreadable.
- **Impact:** minor (evidence integrity, log correlation)
- **Prevention:** Ensure `systemd-timesyncd` or `chrony` is enabled: `timedatectl status` must show `NTP service: active` and `System clock synchronized: yes`. Add to bootstrap runbook as verification step.
- **Owning phase:** Packaging

---

### P1-11: Sepolia and Mainnet instances share timer interval → thundering herd on subgraph

- **Symptom:** Both timers fire at the same second. Two processes hit Goldsky subgraph simultaneously. If Goldsky rate-limits, one run returns partial data → wrong action list → extra tx or missed signal.
- **Impact:** minor (rate limit risk; wasted compute)
- **Prevention:** `RandomizedDelaySec=60` in both timer units gives up to 60s of jitter per fire — staggering is probabilistic but sufficient for two instances. Alternatively, set `OnBootSec=2min` in Sepolia and `OnBootSec=7min` in Mainnet to phase them deterministically.
- **Owning phase:** Packaging

---

### P1-12: Bash history captures secrets during manual secret setup

- **Symptom:** Operator types `echo "BOT_PRIVATE_KEY=0x..." >> /etc/reputation-oracle/env` in bash. Key is now in `~/.bash_history` in plaintext. Any future shell history leak (backup, forensic tool, log aggregator) exposes the key.
- **Impact:** major (irreversible key exposure if history is leaked)
- **Prevention:** Edit the env file directly with `sudo nano /etc/reputation-oracle/sepolia.env` (never via echo/heredoc). Or use `HISTCONTROL=ignorespace` and prefix the command with a space. Runbook must warn: "Never use echo or shell redirection to populate the env file."
- **Owning phase:** Packaging

---

## Category 2: Betterstack / Log Forwarding

### P2-01: Secret values appearing in log lines forwarded to Betterstack

- **Symptom:** zod config validation error log or startup debug log contains `PINATA_JWT`, `BOT_PRIVATE_KEY`, or `BETTERSTACK_SOURCE_TOKEN` values. These land in Betterstack Telemetry — a third-party system.
- **Impact:** blocker (secret exfiltration to external SaaS)
- **Prevention:** Existing pino redaction covers zod config serialization. New risk: `BETTERSTACK_SOURCE_TOKEN` itself must be in the redact list — it is a secret loaded from env, and any zod validation error that dumps `process.env` context would expose it. Ensure `config.ts` redacts `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_HEARTBEAT_TOKEN` alongside existing `BOT_PRIVATE_KEY` and `PINATA_JWT`.
- **Owning phase:** Observability

---

### P2-02: Log volume spike exhausts Betterstack free tier during incident

- **Symptom:** Bot retries gas estimation on transient errors (up to 3x per action). If 50 items have gas revert loops, a single run emits hundreds of log lines. At 15-min cadence, a 6-hour incident generates 3 GB of logs — exactly the free-tier monthly cap. Betterstack drops all subsequent logs.
- **Impact:** major (logs disappear precisely during the incident you need them most)
- **Prevention:** Per existing differentiated failure policy (CLAUDE.md), gas estimation retries are capped at 3. Per-item failures skip+continue rather than looping. Root mitigation: log at `warn` not `error` for expected per-item failures; use `level:fatal` only for systemic failures. Configure Betterstack log volume alert at 80% of monthly cap.
- **Owning phase:** Observability

---

### P2-03: Betterstack transport blocks bot exit when Betterstack endpoint is slow or down

- **Symptom:** `closeLogger(cb)` calls `transport.end(cb)`. `@logtail/pino` worker thread tries to drain its buffer to Betterstack. If Betterstack is down, the HTTP POST hangs. Bot never calls `process.exit`. systemd eventually hits `TimeoutStopSec` and sends SIGKILL. SIGTERM handler set `shutdown=true` but bot never reached `flushAndExit`.
- **Impact:** major (bot hangs; next timer cycle may be blocked; Betterstack outage cascades to oracle outage)
- **Prevention:** `@logtail/pino` respects HTTP timeouts in the transport options. Set `options: { endpoint: "...", fetchOptions: { signal: AbortSignal.timeout(5000) } }` or equivalent. Add `TimeoutStopSec=30` to the systemd unit — if bot doesn't exit in 30s after SIGTERM, systemd SIGKILL's it. Heartbeat ping failure is already non-fatal (STACK.md pattern); log transport failure must be treated the same way.
- **Owning phase:** Observability

---

### P2-04: Duplicate logs: journald and Betterstack both emit the same lines

- **Symptom:** Betterstack shows every log line twice — once from the `@logtail/pino` transport (direct) and once forwarded by a syslog/journald-to-Betterstack agent if one was installed separately.
- **Impact:** minor (2x log cost on paid tiers; confusion when correlating; free tier halved effectively)
- **Prevention:** Do not install `vector`, `fluent-bit`, `filebeat`, or any journald-forwarding agent alongside `@logtail/pino`. The pino transport is the sole forwarding mechanism. Bootstrap runbook must note: "Do not install log shippers — pino transport handles forwarding."
- **Owning phase:** Observability

---

### P2-05: Heartbeat false positive — ping succeeds when bot silently no-opped

- **Symptom:** Bot runs, fetches 0 items from subgraph (wrong `PGTCR_ADDRESS` or list not yet deployed), computes 0 actions, pings heartbeat with exit code 0. Betterstack shows "healthy". Zero reputation signals ever emitted. Operator doesn't notice for days.
- **Impact:** major (silent mis-configuration; oracle appears live but does nothing)
- **Prevention:** Run summary log line must include `itemsFetched`, `actionsComputed`, `txsSent`. First-run verification runbook step: inspect `itemsFetched > 0` after first run. Consider adding a Betterstack alert rule on `itemsFetched == 0` for more than N consecutive runs (log-derived metric from NDJSON parse).
- **Owning phase:** Observability

---

### P2-06: Heartbeat grace period shorter than timer interval → false-alarm alerts

- **Symptom:** Timer fires every 15 min. Bot takes 25 seconds. Grace period set to 10 min. Betterstack expects ping every 15 min + 10 min = 25 min. If two consecutive runs are slow (e.g. Pinata IPFS uploads stall at 10s each × 20 items = 200s), heartbeat arrives at 25-min mark — Betterstack already fired an alert. Alert is a false alarm but wakes the operator.
- **Impact:** minor (alert fatigue; reduces trust in monitoring)
- **Prevention:** Grace period = `timer_interval + 2× expected_max_run_time`. At 15-min interval and 5-min max run: grace = 20 min. Never set grace < timer interval. Document in the Betterstack UI configuration step of the runbook.
- **Owning phase:** Observability

---

### P2-07: Missing `runId` field → impossible to correlate log lines from a single run

- **Symptom:** Betterstack shows 200 log lines from 13 concurrent (but actually sequential) runs. Without `runId`, searching for "why did run at 14:15 fail" requires timestamp range filtering — fragile across timer jitter. `agentId`-scoped child loggers exist but don't thread the full run.
- **Impact:** minor (MTTR increase for incident investigation)
- **Prevention:** Generate `runId = crypto.randomUUID()` at process start in `index.ts`. Set as root logger child: `const log = logger.child({ runId, chainId: config.CHAIN_ID })`. Pass `log` down to all callers. Every log line inherits `runId`.
- **Owning phase:** Observability

---

### P2-08: PII / compliance exposure via third-party log sink

- **Symptom:** Betterstack receives: wallet addresses (`agentId`, submitter EOA), IPFS CIDs, Kleros dispute IDs, agent registry metadata. These are public blockchain data but now stored in a US-based SaaS (Betterstack/Logtail, owned by SolarWinds). GDPR implications if any metadata contains personal data.
- **Impact:** minor (compliance consideration; not a blocker for this project)
- **Prevention:** Document in runbook: "All data forwarded to Betterstack is derived from on-chain public sources and IPFS public CIDs. No off-chain PII is logged. GDPR lawful basis: public interest / legitimate interest." If future metadata contains off-chain identity data, revisit.
- **Owning phase:** Observability

---

### P2-09: Alert noise in the first week after cutover

- **Symptom:** First Mainnet timer fires. Betterstack has never seen a heartbeat. Grace period clock starts at timer enable — not at first successful ping. Any misconfiguration causing first-run failure triggers a false "first alert" before baseline is established.
- **Impact:** minor (noise; may cause alert fatigue before system is calibrated)
- **Prevention:** Disable Betterstack alerting until after the first 3 successful runs. In runbook: step "Enable Betterstack alerts" is after "Verify 3 consecutive successful heartbeats in Betterstack UI." Allow 7-day alert-tuning window before treating pager alerts as incidents.
- **Owning phase:** Observability

---

## Category 3: Ethereum Mainnet Cutover

### P3-01: Reusing Sepolia keypair on Mainnet

- **Symptom:** `BOT_PRIVATE_KEY` in `mainnet.env` is the same as in `sepolia.env`. If Sepolia key is ever exposed (testnet, public repo mistake, debug session), Mainnet funds and signing authority are also compromised.
- **Impact:** blocker (operational security; irreversible if funds lost)
- **Prevention:** Generate a fresh EOA for Mainnet bot wallet: `cast wallet new`. Fund with gas-only ETH (< 3 days of expected gas cost). Never reuse Sepolia private key. Runbook step 1: "Generate new Mainnet EOA. Do NOT copy from Sepolia env file."
- **Owning phase:** Mainnet

---

### P3-02: Hot wallet balance too high

- **Symptom:** Mainnet bot wallet funded with 1 ETH "to be safe." Bot is one-shot, ~50 actions/run max, 20 gwei gas, ~150k gas/tx → ~0.003 ETH/tx → ~0.15 ETH/run worst case. 1 ETH = 7 worst-case runs. But a compromised key drains 1 ETH instantly.
- **Impact:** major (unnecessary funds at risk)
- **Prevention:** Fund with 3 days of expected gas at current gas price. For a 15-min bot with 1–5 expected actions per run: 0.01–0.05 ETH is sufficient. Set up a Betterstack alert on `balance < 0.005 ETH` (log-derived from the balance check in `chain.ts`). Refill manually when alert fires.
- **Owning phase:** Mainnet

---

### P3-03: Wrong Kleros v1 Arbitrator address in Mainnet Router deployment

- **Symptom:** `forge script Deploy.s.sol --rpc-url $MAINNET_RPC_URL` deploys Router with `_arbitrator = 0x3162df...` (the Sepolia PGTCR address or wrong contract). Router is initialized with wrong arbitrator. All dispute outcomes mis-read. Only detectable via fork test or post-deploy verification.
- **Impact:** blocker (Router logic broken from day 1; requires redeploy = new proxy address = new Identity registration)
- **Prevention:** Mainnet KlerosLiquid v1: `0x988b3a538b618c7a603e1c11ab82cd16dbe28069`. Add to `Deploy.s.sol` as a named constant with a comment: `// KlerosLiquid v1 — https://docs.kleros.io/integrations/...`. Fork-test deployment against Mainnet fork: `forge script Deploy.s.sol --fork-url $MAINNET_RPC_URL` and assert `router.arbitrator() == EXPECTED_ADDRESS`.
- **Owning phase:** Mainnet

---

### P3-04: Wrong ERC-8004 registry addresses on Mainnet

- **Symptom:** `giveFeedback` call in Router reverts: `0x...` is not a contract, or is the wrong ReputationRegistry. On Mainnet, this wastes real ETH on gas estimation failures.
- **Impact:** blocker
- **Prevention:** Mainnet ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Mainnet IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. Verify on Etherscan before deploy. Add post-deploy assertion: `cast call $ROUTER_PROXY "reputationRegistry()(address)" --rpc-url $MAINNET_RPC_URL` must equal the expected address.
- **Owning phase:** Mainnet

---

### P3-05: Mainnet PGTCR list not yet deployed when bot runs

- **Symptom:** `PGTCR_ADDRESS` in `mainnet.env` points to a contract that hasn't been deployed yet. Subgraph returns 0 items. Bot pings heartbeat exit(0). Appears healthy. Zero reputation signals emitted.
- **Impact:** major (silent operational dependency; out-of-scope blocker that delays the milestone)
- **Prevention:** Milestone scope note: "Mainnet PGTCR list deployment is coordinated externally." Runbook gate: "Before enabling Mainnet timer, verify `PGTCR_ADDRESS` exists on Etherscan AND Goldsky Mainnet subgraph returns items for it." If list is not yet deployed: timer stays disabled; re-enable when list is live.
- **Owning phase:** Mainnet

---

### P3-06: Gas cost surprise — Sepolia gas ≠ free on Mainnet

- **Symptom:** During Sepolia development, gas cost was negligible. On Mainnet at 20 gwei, a 3-scenario run (revoke + giveFeedback) costs ~0.003–0.006 ETH. Unexpected if wallet was funded for Sepolia-equivalent "test runs."
- **Impact:** minor (operational surprise; wallet drains faster than expected)
- **Prevention:** Calculate expected cost before first Mainnet run: `expected_gas_per_tx × expected_actions × gas_price_gwei`. Fund accordingly. Document in runbook. Add `gasUsed` to run summary log line so Betterstack can surface per-run cost.
- **Owning phase:** Mainnet

---

### P3-07: UUPS upgrade key = single EOA = single point of failure

- **Symptom:** The deployer EOA (`DEPLOYER_PRIVATE_KEY`) is the only account that can call `upgradeToAndCall()` on the Router proxy. If that key is lost or compromised, the proxy is permanently stuck at the current implementation (no upgrades, no fixes).
- **Impact:** major (operational risk; recovery requires a new proxy deploy + Identity re-registration)
- **Prevention:** Document as a known risk in the Mainnet runbook. Recommended mitigation (deferred to v1.3 per project scope): transfer proxy ownership to a 2/3 multisig (Gnosis Safe) immediately after first deploy. For v1.2: store deployer key in a hardware wallet; never in a `.env` file that is backed up to cloud. Note in runbook: "Deployer key loss = proxy upgrade capability loss."
- **Owning phase:** Mainnet

---

### P3-08: No trial-mode / first-run verification → uncontrolled first Mainnet tx

- **Symptom:** Mainnet bot enabled without a `--dry-run` first. First timer fire submits 30 transactions because Mainnet PGTCR list has 30 items and none have Router feedback yet. Some txs may fail (wrong address, wrong gas) and waste ETH. No human review of intended actions.
- **Impact:** major (wasted real ETH; possible incorrect state if partial run succeeds)
- **Prevention:** Runbook mandatory gate: run `DRY_RUN=true node --import tsx src/index.ts` (or equivalent `--dry-run` flag) before enabling timer. Inspect stdout action list. Confirm `actionsComputed` matches expected list count. Only then enable timer. This gate must be in the runbook as a non-skippable step.
- **Owning phase:** Mainnet

---

### P3-09: Subgraph index lag on Mainnet causes bot to act on stale state

- **Symptom:** Mainnet subgraph is at block N-50 while chain is at block N. An item status changed at block N-30 (e.g. dispute resolved → Absent). Bot reads "RegistrationRequested" (stale), computes "giveFeedback" action, submits tx. Next run (15 min later) reads correct state and skips. Net result: one spurious `giveFeedback` followed by a correct `revokeFeedback` — correct eventual state, wasted ETH.
- **Impact:** minor (extra tx cost; self-correcting on next run due to stateless diff)
- **Prevention:** Mainnet subgraph (`v0.0.1`) is less battle-tested than Sepolia. Check `_meta { block { number } }` in subgraph queries and log `subgraphLag = chainHead - subgraphBlock`. If lag > 100 blocks (~20 min), log warn and skip actions. This guard is not in v1.1 — add to bot in Phase 9 or flag as a known risk.
- **Owning phase:** Mainnet

---

### P3-10: Fork tests pass but Mainnet-specific constructor args differ

- **Symptom:** `forge test --fork-url $MAINNET_RPC_URL` passes. But tests use a `Deploy.s.sol` that still has Sepolia addresses hardcoded. Tests pass because the fork overrides RPC but the constants in the script are Sepolia addresses — they exist on fork because Sepolia state isn't loaded (wrong chain fork). Silently validates wrong configuration.
- **Impact:** major (false confidence before first real deploy)
- **Prevention:** Parameterize `Deploy.s.sol` with chain-ID-based address selection (Option B in ARCHITECTURE.md). Fork tests against `$MAINNET_RPC_URL` will then use correct Mainnet addresses automatically. Post-fork-test assertion: `assert(router.reputationRegistry() == MAINNET_REPUTATION_REGISTRY)`.
- **Owning phase:** Mainnet

---

### P3-11: Free-tier RPC rate-limit (429) on Multicall batches

- **Symptom:** Bot uses Multicall3 to batch `hasFeedback()` reads. Alchemy free tier = 300M compute units/month ≈ 10M req/day. At 15-min cadence: 96 runs/day. If a run fetches 200 items and batches them in one Multicall3 call, that's 1 RPC call per run. Well within free tier. BUT: if viem splits the batch (e.g. due to response size), multiple calls per run → 429 on large lists.
- **Impact:** minor (read failure → bot exits without acting; self-healing next run)
- **Prevention:** `RPC_URL_FALLBACK` in env provides automatic failover via `viem.fallbackTransport`. Log `429` errors at `warn` level. Monitor via Betterstack for 429 frequency. If sustained: upgrade Alchemy plan or add a second provider.
- **Owning phase:** Mainnet

---

### P3-12: Goldsky Mainnet subgraph less battle-tested than Sepolia

- **Symptom:** Goldsky Mainnet subgraph (`v0.0.1`) may have indexing gaps, schema differences, or slower sync than the Sepolia subgraph (`v0.0.2`). Bot assumes field presence; a missing field causes zod parse failure → systemic error.
- **Impact:** major (bot cannot run at all if schema differs)
- **Prevention:** Before first Mainnet bot run, manually query the Mainnet subgraph endpoint and validate schema against the query in `subgraph.ts`. Check `items { id status metadata { key0 key2 } disputeOutcome }` returns expected fields. Add to first-run runbook as a pre-flight verification step.
- **Owning phase:** Mainnet

---

## Category 4: Cross-Cutting Interaction Pitfalls

### P4-01: Both chain bots forward to same Betterstack log source → unfiltered chain mixing

- **Symptom:** Betterstack shows log lines from Sepolia and Mainnet interleaved with no way to filter by chain. When Mainnet has an incident, operator searches and finds Sepolia noise. `agentId` values overlap (same PGTCR list, different chains) — impossible to tell which chain a specific agent belongs to.
- **Impact:** major (incident investigation paralysis)
- **Prevention:** Either (a) use two Betterstack log sources (two `BETTERSTACK_SOURCE_TOKEN` values — one per chain), or (b) ensure every log line includes `chainId` field (added to root logger child: `logger.child({ runId, chainId: config.CHAIN_ID })`). Option (b) is simpler and uses one source; Betterstack filters by `chainId:1` vs `chainId:11155111`. Implement option (b) — `chainId` in root logger child.
- **Owning phase:** Observability

---

### P4-02: Heartbeat fires from inside `flushAndExit` — failure ping races log flush

- **Symptom:** Bot detects systemic failure → calls `pingHeartbeat(fail)` → calls `closeLogger(cb)`. Betterstack Uptime receives "fail" signal. Betterstack Logs has not yet received the `level:fatal` log line (worker thread still draining). Operator opens Betterstack Logs to investigate — no fatal log found. Wrong order.
- **Impact:** minor (confusing investigation sequence; not a data loss issue — logs arrive seconds later)
- **Prevention:** Order in `index.ts`: (1) `logger.fatal(...)`, (2) `await pingHeartbeat(fail)`, (3) `closeLogger(cb)`. Logger writes are synchronous from main thread perspective; worker drains during `closeLogger`. Heartbeat ping fires after the fatal log is enqueued (but before it's flushed). Betterstack Logs will have the fatal line within seconds of the heartbeat alert — acceptable delay.
- **Owning phase:** Observability

---

### P4-03: Two systemd instance files with near-identical content drift over time

- **Symptom:** `reputation-oracle-sepolia.service` and `reputation-oracle-mainnet.service` start identical. Six months later, the Sepolia unit has `TimeoutStartSec=300` (added during an incident) but Mainnet doesn't. A Mainnet hang goes undetected for hours. Copy-paste drift is the primary source of ops inconsistency in multi-instance systemd setups.
- **Impact:** minor (operational inconsistency; degrades over time)
- **Prevention:** Use systemd instance units with `@` syntax: `reputation-oracle@.service` + `reputation-oracle@sepolia.timer`. Chain-specific values (EnvironmentFile path, SyslogIdentifier) parameterized via `%i` specifier. Both instances share one unit file — a change applies to both. Add to runbook: "Never edit sepolia.service and mainnet.service independently."
- **Owning phase:** Packaging

---

### P4-04: Mainnet cutover before observability is tuned → first failures hard to debug

- **Symptom:** Mainnet timer enabled. First run fails (wrong address, gas revert). Betterstack alerts fire. Operator opens Betterstack Logs — runId not in every line, chainId not in every line, no `level:fatal` before exit(1). Debugging requires `journalctl` SSH session. MTTR for first Mainnet failure is hours instead of minutes.
- **Impact:** major (MTTR on first real incident)
- **Prevention:** Phase ordering is critical. Packaging → Observability → Mainnet. Do not enable Mainnet timer until: (a) Betterstack Telemetry is receiving structured logs with `runId` and `chainId`, (b) Betterstack Uptime heartbeat is configured and has received 3 successful pings from Sepolia, (c) alert channels (email/Slack) are tested with a manual `pingHeartbeat(fail)` test run.
- **Owning phase:** Mainnet (gate on Observability completion)

---

## "Looks Done But Isn't" Checklist

- [ ] **tsx in dependencies:** `npm ci --omit=dev && node --import tsx src/index.ts --version` succeeds on VPS.
- [ ] **EnvironmentFile permissions:** `stat -c '%a %U %G' /etc/reputation-oracle/*.env` prints `600 root root`.
- [ ] **No inline Environment= secrets:** `systemctl show reputation-oracle-sepolia | grep PRIVATE_KEY` returns nothing.
- [ ] **journald retention set:** `journalctl --disk-usage` < 500M and config file has `SystemMaxUse=500M`.
- [ ] **TimeoutStartSec present:** `systemctl show reputation-oracle-sepolia | grep TimeoutStartSec` shows 300.
- [ ] **Heartbeat grace > timer interval:** Betterstack UI shows grace period ≥ 20 min.
- [ ] **runId in every log line:** `journalctl -u reputation-oracle-sepolia -n 1 -o json-pretty` shows `runId` field.
- [ ] **chainId in every log line:** same output shows `chainId` field.
- [ ] **Mainnet EOA is fresh:** deployer key and bot key are different; bot key not in any git history.
- [ ] **Registry addresses verified on Etherscan:** `cast call $ROUTER_PROXY "reputationRegistry()(address)"` matches expected Mainnet address.
- [ ] **First Mainnet run was dry-run:** Runbook sign-off step: operator name + timestamp after dry-run inspection.
- [ ] **Goldsky Mainnet subgraph schema validated:** manual curl to subgraph endpoint returns expected fields before first bot run.

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1-02: tsx devDep breaks production | Packaging | `npm ci --omit=dev && node --import tsx src/index.ts --dry-run` on VPS |
| P1-04: Missing TimeoutStartSec | Packaging | `systemctl show` grep |
| P1-05: EnvironmentFile permissions | Packaging | `stat -c '%a'` check in bootstrap runbook |
| P1-06: Inline secrets in unit file | Packaging | `systemctl show` grep for secret values |
| P1-07: nvm on VPS | Packaging | `which node` → `/usr/bin/node` |
| P1-08: journald unbounded | Packaging | `journald.conf` diff + `journalctl --disk-usage` |
| P1-09: Git pull mid-run | Packaging | Runbook atomic deploy procedure |
| P1-12: Bash history secrets | Packaging | Runbook warning + operator confirmation |
| P2-01: Secrets in Betterstack logs | Observability | Search Betterstack for `PINATA_JWT`, `BOT_PRIVATE_KEY`, `BETTERSTACK_SOURCE_TOKEN` after first run |
| P2-03: Transport blocks exit | Observability | Simulate Betterstack down: `TimeoutStopSec=30` ensures SIGKILL fallback |
| P2-05: Heartbeat false positive | Observability | Inspect `itemsFetched > 0` in first-run summary log |
| P2-06: Grace period mismatch | Observability | Betterstack UI shows grace ≥ 20 min |
| P2-07: Missing runId | Observability | `journalctl` output includes `runId` field |
| P4-01: Chain mixing in logs | Observability | Filter Betterstack by `chainId:1` — only Mainnet lines returned |
| P3-01: Sepolia key reuse | Mainnet | Two distinct EOA addresses in two env files |
| P3-03: Wrong arbitrator address | Mainnet | Fork test assertion + `cast call` post-deploy |
| P3-04: Wrong registry addresses | Mainnet | `cast call` post-deploy for `reputationRegistry()` |
| P3-07: UUPS key = single EOA | Mainnet | Documented risk; hardware wallet recommendation in runbook |
| P3-08: No trial-mode | Mainnet | Runbook gate: dry-run before timer enable |
| P3-12: Goldsky schema drift | Mainnet | Manual subgraph query pre-flight check in runbook |

---

## Sources

- Existing codebase + CLAUDE.md bot hardening patterns (Phase 5 baseline) — HIGH confidence
- `.planning/research/STACK.md` (v1.2) — systemd unit design, EnvironmentFile patterns, Betterstack transport notes
- `.planning/research/ARCHITECTURE.md` (v1.2) — tsx devDep issue, transport flush interaction, anti-patterns
- `.planning/research/FEATURES.md` (v1.2) — anti-features list, table stakes gaps
- General systemd operations knowledge — HIGH confidence (well-documented, stable API)
- Ethereum Mainnet operations best practices — HIGH confidence (established patterns)

---
*Pitfalls research for: Kleros Reputation Oracle v1.2 Deploy-to-Mainnet*
*Researched: 2026-04-23*
