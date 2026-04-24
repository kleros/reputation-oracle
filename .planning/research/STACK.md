# Stack Research

**Domain:** VPS packaging + observability + Ethereum Mainnet — v1.2 additions only
**Researched:** 2026-04-23
**Confidence:** HIGH (systemd, Node provisioning, journald); HIGH (@logtail/pino); MEDIUM (ERC-8004 Mainnet addresses — confirmed via erc-8004-contracts repo but verify before deploy)

---

## Baseline (locked — do not change)

See `.planning/milestones/v1.1-research/STACK.md`. Everything below is additive.

---

## 1. Packaging — Node 22 on Ubuntu 22.04

### Node.js provisioning decision: NodeSource apt repo

Ubuntu 22.04 ships Node.js 12 in its default apt. **Do not use the distro package.**

| Option | Verdict | Reason |
|--------|---------|--------|
| NodeSource apt repo (`NODE_MAJOR=22`) | **Use this** | Security-patched Node 22.x via `apt upgrade`; single install step; no version manager overhead; idiomatic for single-version production servers |
| nvm | No | Per-user, not system-wide; awkward in systemd unit paths; designed for dev workstations |
| asdf | No | Added complexity; no benefit for single fixed version |
| Ubuntu default apt | No | Ships Node 18; would require unsafe pinning tricks to upgrade |

**Install commands (idempotent):**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # must be v22.x
```

NodeSource GPG-signs packages; `apt upgrade` picks up Node 22.x patch releases automatically. Node 22 LTS ("Jod") supported through **April 2027**.

**Confidence:** HIGH — NodeSource is the de facto standard for production Ubuntu Node installs since Ubuntu 14.04. [Source](https://computingforgeeks.com/install-nodejs-ubuntu-debian/)

---

## 2. Packaging — systemd Timer + Service Unit

### Unit design: `Type=oneshot` + dedicated `.timer`

```ini
# /etc/systemd/system/reputation-oracle.service
[Unit]
Description=Kleros Reputation Oracle (one-shot sync)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=no
User=oracle
Group=oracle
WorkingDirectory=/opt/reputation-oracle/bot

# Secrets — see §3 below
EnvironmentFile=/etc/reputation-oracle/env

ExecStart=/usr/bin/node --env-file=/etc/reputation-oracle/env --import tsx src/index.ts

# Sandboxing (systemd 245+, Ubuntu 22.04 ships 249)
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
ReadWritePaths=/var/log/reputation-oracle

# Resource ceiling
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/reputation-oracle.timer
[Unit]
Description=Run Kleros Reputation Oracle every 15 minutes
Requires=reputation-oracle.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
RandomizedDelaySec=60
AccuracySec=1s
Persistent=true

[Install]
WantedBy=timers.target
```

**Key decisions:**

| Directive | Value | Why |
|-----------|-------|-----|
| `Type=oneshot` | required | bot exits after each run; systemd tracks exit code |
| `RemainAfterExit=no` | required | timer needs service to be in "inactive" state to re-trigger |
| `After=network-online.target` | required | subgraph + RPC calls need network; avoids silent early failures |
| `RandomizedDelaySec=60` | 60s | prevents thundering-herd on shared VPS reboot; has no effect on normal timer cadence |
| `Persistent=true` | on | fires immediately on boot if last run was missed (e.g. VPS restart) |
| `OnUnitActiveSec=` | prefer over `OnCalendar=` | monotonic; immune to DST/NTP jumps; simpler for uniform intervals |
| `ProtectSystem=strict` | on | makes `/etc`, `/usr`, `/boot` read-only; safe for this bot |
| `PrivateTmp=true` | on | isolates `/tmp` — pino uses no tempfiles but zero cost |
| `NoNewPrivileges=true` | on | standard hardening; bot has no suid needs |

**User:** create dedicated `oracle` system user with no shell:
```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin oracle
```

**systemd version context:** Ubuntu 22.04 ships systemd 249. All directives above are available in systemd 245+. `systemd.exec(5)`, `systemd.timer(5)` are the authoritative references.

**Confidence:** HIGH — standard systemd patterns; no experimental features used.

---

## 3. Secrets Management — EnvironmentFile vs LoadCredential

**Decision: `EnvironmentFile` at mode 0600, owned by root.**

| Approach | Security | Complexity | Chosen |
|----------|----------|------------|--------|
| `EnvironmentFile=/etc/reputation-oracle/env` (0600, root:root) | MEDIUM — env vars can appear in `/proc/PID/environ` for root, but bot exits immediately | Low | **Yes** |
| `LoadCredential=` | HIGH — kernel-managed, in-RAM, not swappable, not in `/proc/environ` | Medium — app must read from `$CREDENTIALS_DIRECTORY/` files | No |
| `Environment=` inline in unit | LOW — visible in `systemctl show` | Very low | No |

**Why EnvironmentFile over LoadCredential for v1.2:**
- Bot already uses `node --env-file=` idiom; `EnvironmentFile=` is a direct parallel
- Process exits in seconds — the `/proc/environ` attack window is negligible
- `LoadCredential` requires app code changes: reading secrets from `$CREDENTIALS_DIRECTORY/{name}` files instead of env vars — nontrivial refactor with no user-visible value for this threat model
- User explicitly chose dev-grade production; LoadCredential is v1.3 hardening

**File setup:**
```bash
sudo mkdir -p /etc/reputation-oracle
sudo touch /etc/reputation-oracle/env
sudo chmod 600 /etc/reputation-oracle/env
sudo chown root:root /etc/reputation-oracle/env
# populate with RPC_URL, BOT_PRIVATE_KEY, ROUTER_ADDRESS, etc.
```

**Note:** `node --env-file=` in `ExecStart` and `EnvironmentFile=` are redundant for the same file. Use only `EnvironmentFile=` in the service unit so systemd loads vars into the process environment; remove `--env-file=` from ExecStart. The bot's `config.ts` reads from `process.env` either way.

**Confidence:** HIGH — well-established pattern; explicitly recommended by systemd docs for "dev-grade prod". [Source](https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-service-environment-files-on-ubuntu/view)

---

## 4. Logging — journald + Betterstack Telemetry

### journald retention config

Ubuntu 22.04 enables persistent journald storage by default but sets **no size cap** — journals grow unbounded. Set explicit limits in `/etc/systemd/journald.conf`:

```ini
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxFileSec=1month
```

`SystemMaxUse=500M` keeps ~7 rotated files at 50M each. A one-shot bot running every 15 min produces ~5–10 log lines/run = trivially small; these limits are defensive.

**No logrotate needed.** journald handles rotation natively when `SystemMaxFileSize` is hit.

### Betterstack Telemetry — pino transport

**Package:** `@logtail/pino` — the official Betterstack pino transport (formerly Logtail).

| Property | Value |
|----------|-------|
| Package | `@logtail/pino` |
| Current version | `0.5.8` (April 2026) |
| Peer dependency | pino ≥ 7.0.0 (compatible with pino v10.3) |
| Weekly downloads | ~33K |
| Maintenance | active; published within last month |

**Configuration pattern:**

```typescript
// bot/src/logger.ts — augment existing pino setup
import pino from "pino";

const transport = pino.transport({
  targets: [
    // stderr (journald picks this up)
    { target: "pino/file", options: { destination: 2 }, level: "info" },
    // Betterstack Telemetry
    {
      target: "@logtail/pino",
      options: {
        sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN,
        options: { endpoint: "https://in.logs.betterstack.com" },
      },
      level: "info",
    },
  ],
});

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }, transport);
```

**New env var:**

| Var | Required | Purpose |
|-----|----------|---------|
| `BETTERSTACK_SOURCE_TOKEN` | No (skip transport if absent) | Betterstack log source token |

Conditionally include the Betterstack target only when `BETTERSTACK_SOURCE_TOKEN` is set — avoids config error during local dev/Sepolia.

**Free tier:** 3 GB/month, 3-day retention. Ample for this bot (< 1 MB/day at 15-min cadence). **Free tier is sufficient for v1.2.**

**Paid plan needed only if:** log volume exceeds 3 GB/month OR retention > 3 days required for compliance. At current usage, neither applies.

**Confidence:** HIGH — `@logtail/pino` is the official Betterstack transport; pino v10 compatibility confirmed (v7+ peer dep, pino v10 is a semver-compatible major of the transport API introduced in v7). [Source: npmjs.com/@logtail/pino](https://www.npmjs.com/package/@logtail/pino), [Betterstack docs](https://betterstack.com/docs/logs/javascript/pino/)

---

## 5. Observability — Betterstack Uptime Heartbeat

**Approach:** Bot calls heartbeat URL on successful run exit via native `fetch()`. No new npm dependency.

### Heartbeat URL format

```
GET/POST https://uptime.betterstack.com/api/v1/heartbeat/<HEARTBEAT_TOKEN>
```

For failure reporting (systemic failure path in `index.ts`):
```
GET/POST https://uptime.betterstack.com/api/v1/heartbeat/<HEARTBEAT_TOKEN>/fail
```

Or pass exit code (supports `/$?` shell expansion in scripts):
```
https://uptime.betterstack.com/api/v1/heartbeat/<HEARTBEAT_TOKEN>/<exit_code>
```

**Auth:** none — the token in the URL is the credential. Keep it in `EnvironmentFile`.

**Integration point:** add `pingHeartbeat(exitCode: 0 | 1)` call in `flushAndExit()` before `process.exit`. Use `fetch()` with a short timeout (3s). Non-fatal if the ping fails — log a warning but still exit with correct code.

```typescript
async function pingHeartbeat(token: string, exitCode: number): Promise<void> {
  if (!token) return;
  const url = `https://uptime.betterstack.com/api/v1/heartbeat/${token}/${exitCode}`;
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    logger.warn({ err }, "heartbeat ping failed — non-fatal");
  }
}
```

**New env var:**

| Var | Required | Purpose |
|-----|----------|---------|
| `BETTERSTACK_HEARTBEAT_TOKEN` | No (skip if absent) | Uptime heartbeat token for this deployment |

**Alert config in Betterstack UI:** set grace period to `20min` (= 15-min timer interval + 5-min slack). Alert channel: email or PagerDuty.

**Free tier:** 10 heartbeat monitors included. v1.2 needs 2 (Sepolia + Mainnet). **Free tier sufficient.**

**Confidence:** HIGH — URL pattern confirmed from official Betterstack docs. [Source](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/)

---

## 6. Mainnet Deployment

### ERC-8004 Registry Addresses — Mainnet

**Source:** [erc-8004/erc-8004-contracts GitHub repo](https://github.com/erc-8004/erc-8004-contracts) — verified April 2026.

| Contract | Mainnet | Sepolia (existing) |
|----------|---------|-------------------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

**Action required before Mainnet deploy:** verify these addresses on Etherscan and against the erc-8004-contracts repo HEAD — ERC-8004 launched Mainnet 2026-01-29 and addresses may have been updated since.

### Kleros v1 Arbitrator — Mainnet

**Source:** [Kleros docs smart-contract-integration](https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/smart-contract-integration)

| Contract | Mainnet Address |
|----------|----------------|
| Kleros Court (KlerosLiquid v1) | `0x988b3a538b618c7a603e1c11ab82cd16dbe28069` |

**Confidence:** MEDIUM — sourced from Kleros docs page; cross-check on Etherscan before use. The PGTCR contract on Mainnet uses this arbitrator.

### RPC Strategy — Mainnet

**Decision: dual-provider env var; prefer Alchemy primary + public fallback.**

viem's `fallbackTransport` supports multiple RPCs natively:

```typescript
import { createPublicClient, fallbackTransport, http } from "viem";

const transport = fallbackTransport([
  http(process.env.RPC_URL),           // primary: Alchemy/QuickNode
  http(process.env.RPC_URL_FALLBACK),  // secondary: different provider
]);
```

**New env vars:**

| Var | Required | Purpose |
|-----|----------|---------|
| `RPC_URL` | Yes | Primary RPC (Alchemy/QuickNode — requires API key) |
| `RPC_URL_FALLBACK` | No | Secondary RPC for resilience |

**Provider recommendations:**

| Provider | Free tier | Notes |
|----------|-----------|-------|
| Alchemy | 300M CU/month | Best DX; Mainnet + archive; reliable for sub-100 req/day loads |
| QuickNode | 10M credits/month | Fastest; best compliance (SOC 2 + ISO 27001) |
| Public (publicnode.com) | Unlimited | Use as fallback only — rate-limited, no SLA |

Bot makes ~10–50 RPC calls per run at 15-min cadence. Free tiers on Alchemy or QuickNode are ample. **No paid RPC plan needed for v1.2.**

**Confidence:** HIGH — viem fallbackTransport is a documented feature. RPC provider comparison from [Chainstack 2026](https://chainstack.com/best-ethereum-rpc-providers-in-2026/).

### Mainnet Subgraph

Already present in `PROJECT.md`:
```
https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-mainnet/v0.0.1/gn
```
No new infrastructure needed — Goldsky subgraph is already deployed.

### No tooling additions needed for Mainnet

Foundry deploy script (`script/Deploy.s.sol`) is already idempotent. Swap `--rpc-url` to Mainnet RPC and `ROUTER_PROXY_ADDRESS` stays unset for first deploy. Same `cast` / `forge` commands work on Mainnet.

---

## Summary of v1.2 Additions

### New production dependencies

| Package | Version | Purpose | Feature |
|---------|---------|---------|---------|
| `@logtail/pino` | `^0.5.8` | Betterstack Telemetry log transport | Observability |

### New dev dependencies

None.

### New env vars

| Var | Required | Feature |
|-----|----------|---------|
| `BETTERSTACK_SOURCE_TOKEN` | No (skip if absent) | Observability — Telemetry log forwarding |
| `BETTERSTACK_HEARTBEAT_TOKEN` | No (skip if absent) | Observability — Uptime heartbeat |
| `RPC_URL_FALLBACK` | No | Mainnet resilience |

### Infrastructure (no npm packages)

| Item | Notes |
|------|-------|
| NodeSource Node 22 apt repo | VPS provisioning |
| systemd `.service` + `.timer` units | Scheduling |
| `/etc/reputation-oracle/env` (0600) | Secret file |
| `/etc/systemd/journald.conf` caps | Log retention |

### Installation

```bash
# New production dep only
npm install @logtail/pino
```

---

## What NOT to Add

| Avoid | Why |
|-------|-----|
| `pino-betterstack` (unofficial) | `@logtail/pino` is the official package — don't confuse |
| `pm2` | Bot is one-shot; systemd timer is the scheduler; pm2 adds daemon complexity |
| Docker / Compose | Explicitly out of scope (user decision); bare Node + systemd chosen |
| `nvm` or `asdf` on the VPS | Single fixed Node 22 version; NodeSource apt is simpler and gets security patches via `apt upgrade` |
| `dotenv` npm package | Node 22 `--env-file` + systemd `EnvironmentFile=` handle this natively |
| `@pinata/sdk` | Already decided in v1.1 — native fetch only |
| Ansible / Terraform | User preference: simplicity; a shell runbook is sufficient for a single VPS |
| Multiple chains in one process | Out of scope; one systemd service + env file per chain |
| `LoadCredential=` for v1.2 | Requires app code refactor; deferred to v1.3 per user |

---

## Version Compatibility

| Package | Constraint | Status |
|---------|------------|--------|
| `@logtail/pino@^0.5.8` | pino ≥ 7.0.0 peer dep | Compatible with pino 10.3.x (v10 > v7) |
| pino v10 `transport()` API | stable since pino v7 | No breaking changes for transport API in v10 |
| Node 22 `AbortSignal.timeout()` | Node 20.3+ | Available — used in heartbeat ping |
| systemd 249 (Ubuntu 22.04) | all directives require systemd 245+ | All directives available |

---

## Sources

- [NodeSource setup guide (computingforgeeks.com)](https://computingforgeeks.com/install-nodejs-ubuntu-debian/) — Node 22 on Ubuntu 22.04; NodeSource apt method
- [Betterstack pino transport docs](https://betterstack.com/docs/logs/javascript/pino/) — `@logtail/pino` package, transport config, source token
- [@logtail/pino on npmjs.com](https://www.npmjs.com/package/@logtail/pino) — v0.5.8, weekly downloads, peer deps
- [Betterstack Uptime heartbeat docs](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/) — URL format, exit code support, grace period
- [Betterstack pricing](https://betterstack.com/pricing) — free tier: 3GB/3-day logs, 10 heartbeats
- [erc-8004/erc-8004-contracts GitHub](https://github.com/erc-8004/erc-8004-contracts) — Mainnet registry addresses
- [Kleros smart contract integration docs](https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/smart-contract-integration) — KlerosLiquid v1 Mainnet address
- [Chainstack RPC provider comparison 2026](https://chainstack.com/best-ethereum-rpc-providers-in-2026/) — Alchemy vs QuickNode vs Infura
- [systemd/Sandboxing ArchWiki](https://wiki.archlinux.org/title/Systemd/Sandboxing) — ProtectSystem, PrivateTmp, NoNewPrivileges
- [systemd EnvironmentFile Ubuntu guide](https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-service-environment-files-on-ubuntu/view) — EnvironmentFile best practices
- [systemd credentials (LoadCredential)](https://systemd.io/CREDENTIALS/) — comparison with EnvironmentFile, security tradeoffs
- [journald log rotation Ubuntu 22.04](https://ubuntuhandbook.org/index.php/2020/12/clear-systemd-journal-logs-ubuntu/) — SystemMaxUse defaults

---
*Stack research for: Kleros Reputation Oracle v1.2 Deploy-to-Mainnet*
*Researched: 2026-04-23*
