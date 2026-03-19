# Olla Butler

Autonomous monitoring and operations bot for the [Olla](https://olla.finance) liquid staking protocol on Aztec.

Butler continuously scrapes on-chain protocol state, publishes Prometheus metrics, and automatically executes critical operator actions (accounting updates, rebalancing, attester state refresh).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Olla Butler                         │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Scrapers    │  │  Executor    │  │  Metrics     │  │
│  │              │  │              │  │              │  │
│  │  Core  30s   │  │  Accounting  │  │  Prometheus  │  │
│  │  Vault 30s   │  │  Rebalance   │  │  /metrics    │  │
│  │  Staking 60s │  │  Attester    │  │  /health     │  │
│  │  Safety  60s │  │  Refresh     │  │              │  │
│  │  WQ     30s  │  │              │  │              │  │
│  │  Events 12s  │  │              │  │              │  │
│  │  Attester60s │  │              │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         ▼                 ▼                 ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              In-Memory State                     │   │
│  └──────────────────────────────────────────────────┘   │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐                                       │
│  │ OllaProtocol │◄── Discovers all contracts from       │
│  │ Client       │    OllaCore on startup                │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   ┌───────────┐                      ┌──────────────┐
   │ Ethereum  │                      │  Prometheus  │
   │ RPC       │                      │  / Grafana   │
   └───────────┘                      └──────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 22
- An Ethereum RPC endpoint (Sepolia testnet or mainnet)
- The deployed OllaCore contract address

### Install & Build

```bash
npm install
npm run build
```

### Configure

Create a network config file at `~/.config/olla-butler/{network}-base.env`:

```env
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_NODE_URL=https://your-rpc-endpoint.com
OLLA_CORE_ADDRESS=0x...

# Optional: metrics auth
METRICS_PORT=9470
METRICS_BEARER_TOKEN=your-secret-token

# Optional: attester monitoring (set to the block where staking events begin)
ATTESTER_SCAN_START_BLOCK=1234567

# Optional: automated operations (requires a funded wallet)
TX_EXECUTOR_ENABLED=true
BUTLER_PRIVATE_KEY=0x...
```

Multiple networks are supported — create one file per network (e.g., `testnet-base.env`, `mainnet-base.env`).

Comma-separated RPC URLs are supported for automatic failover:

```env
ETHEREUM_NODE_URL=https://primary-rpc.com,https://fallback-rpc.com
```

### Run

```bash
# Development (with type-checking)
npm run dev:serve

# Development (specific network)
npm run dev:serve -- testnet

# Production
npm run start:serve
```

## Monitoring

### Prometheus Metrics

All metrics are prefixed with `olla_butler_` and include a `network` label.

| Category | Key Metrics |
|----------|-------------|
| **Protocol** | `total_assets`, `exchange_rate`, `staked_principal`, `cumulative_rewards`, `slashing_delta` |
| **Vault** | `buffered_assets`, `pending_withdrawal_assets`, `stAztec_total_supply` |
| **Staking** | `total_staked`, `active_attester_count`, `key_queue_length` |
| **Safety** | `safety_module_paused`, `deposit_cap` |
| **Withdrawal Queue** | `withdrawal_queue_pending_assets`, `withdrawal_queue_unfinalized_count` |
| **Events** | `circuit_breaker_triggered_count`, `deposit_count`, `deposit_volume` |
| **Derived** | `exchange_rate_change_bps`, `buffer_utilization_pct`, `capital_efficiency_pct`, `rewards_apr_pct`, `accounting_staleness_seconds` |
| **Attester** | `rollup_attester_active_count`, `attester_slashing_loss`, `attester_cached_vs_rollup_drift` |
| **Health** | `scraper_up`, `scraper_consecutive_errors`, `rpc_reachable` |

### Alerting Rules

Prometheus alerting rules are provided in [`monitoring/alerts.yml`](monitoring/alerts.yml).

**Critical alerts** (immediate attention):
- Circuit breaker triggered
- Slashing / negative rewards detected
- Safety module paused
- Exchange rate drop > 10 bps
- Attester slashed or in zombie state

**Warning alerts** (investigate soon):
- Rebalance overdue (cooldown elapsed, step not Done)
- Accounting stale (> 24h since last update)
- Buffer utilization below 20%
- Scraper failures / RPC unreachable
- Attester state drift or stale attesters

### Health Endpoint

`GET /health` or `/healthz` returns `{"status":"ok"}` — no auth required. Use for k8s liveness/readiness probes.

## Automated Operations

When `TX_EXECUTOR_ENABLED=true` and `BUTLER_PRIVATE_KEY` is set, butler automatically:

| Task | Check Interval | Trigger Condition |
|------|---------------|-------------------|
| **Accounting Update** | 5 min | Last accounting report > 4 hours old |
| **Rebalance** | 30 min | On-chain cooldown elapsed (24h default). Executes multi-step: Harvest -> PullUnstaked -> FinalizeWithdrawals -> InitiateUnstake -> StakeSurplus -> Done |
| **Attester Refresh** | 60s | Stale attesters detected (slashing, undetected exit, exitable exit, zombie). 5-min cooldown per attester. |

## Project Structure

```
src/
├── core/
│   ├── components/
│   │   ├── OllaProtocolClient.ts  # On-chain state queries, contract discovery
│   │   └── transport.ts           # RPC transport with fallback support
│   └── config/
│       └── index.ts               # Env-based configuration with Zod validation
├── server/
│   ├── scrapers/                  # Periodic data collection
│   │   ├── base-scraper.ts        # Scraper interface
│   │   ├── scraper-manager.ts     # Lifecycle management
│   │   ├── core-scraper.ts        # TVL, exchange rate, accounting
│   │   ├── vault-scraper.ts       # Buffer, withdrawals, stAztec supply
│   │   ├── staking-scraper.ts     # Attester counts, staking state
│   │   ├── safety-module-scraper.ts
│   │   ├── withdrawal-queue-scraper.ts
│   │   ├── event-watcher.ts       # On-chain event polling
│   │   └── attester-scraper.ts    # Aztec rollup attester state
│   ├── executor/                  # Automated transactions
│   │   ├── tx-executor.ts         # Low-level tx sending
│   │   ├── accounting-task.ts     # updateAccounting() automation
│   │   ├── rebalance-task.ts      # Multi-step rebalance automation
│   │   └── attester-refresh-task.ts
│   ├── metrics/                   # Prometheus metric definitions
│   │   ├── registry.ts            # OpenTelemetry setup + HTTP server
│   │   ├── protocol-metrics.ts
│   │   ├── derived-metrics.ts     # Computed metrics (APR, buffer %, staleness)
│   │   ├── attester-metrics.ts
│   │   └── scraper-health-metrics.ts
│   ├── state/                     # In-memory state store
│   │   ├── index.ts               # Per-network state container
│   │   ├── attester-registry.ts   # Tracked attester addresses
│   │   └── scraper-health.ts      # Success/error tracking
│   └── index.ts                   # Server bootstrap
├── types/
│   ├── protocol-state.ts          # Core data types
│   ├── olla-abis.ts               # Contract ABIs (read)
│   ├── write-abis.ts              # Contract ABIs (write)
│   ├── event-abis.ts              # Event ABIs
│   └── aztec-abis.ts              # Aztec rollup ABIs
└── index.ts                       # CLI entry point
```

## Development

```bash
# Type-check
npm run type-check

# Lint
npm run lint
npm run lint:fix

# Test
npm run test
npm run test:watch

# Watch mode (auto-rebuild)
npm run dev:watch
```

## How It Works

1. **Startup**: Loads all network configs, initializes Prometheus metrics, discovers all Olla contract addresses from OllaCore.

2. **Scraping**: Each scraper runs on its own interval, fetching state via `OllaProtocolClient`. Failed scrapers are tracked but don't block others. The event watcher persists its last processed block to disk so events aren't lost on restart.

3. **Metrics**: Scraped state is stored in-memory and exposed as Prometheus observable gauges. Derived metrics (APR, buffer utilization, exchange rate delta) are computed lazily on each Prometheus scrape.

4. **Execution**: Executor tasks check trigger conditions on each interval tick. Transactions are sent via a wallet client, receipts are awaited, and reverted transactions throw errors so failures are visible.

5. **Multi-network**: A single butler instance monitors multiple networks. All metrics include a `network` label for filtering in Grafana.

6. **Rollup awareness**: The attester scraper handles Aztec rollup upgrades by checking historical rollup versions for exiting attesters that are no longer visible on the canonical rollup.
