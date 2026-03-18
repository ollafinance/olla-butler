# Olla-Butler Monitoring

## Loading Alerting Rules

Add `monitoring/alerts.yml` to your Prometheus configuration:

```yaml
# prometheus.yml
rule_files:
  - "/path/to/olla-butler/monitoring/alerts.yml"
```

Then reload Prometheus:

```bash
# Signal reload
kill -HUP $(pidof prometheus)
# Or via API (if --web.enable-lifecycle is set)
curl -X POST http://localhost:9090/-/reload
```

Validate rules before deploying:

```bash
promtool check rules monitoring/alerts.yml
```

## Alert Descriptions

### Critical

| Alert | Trigger | Response |
|-------|---------|----------|
| **OllaCircuitBreakerTriggered** | Circuit breaker event detected | Check `circuit_breaker_*_count` metrics for reason. Investigate whether rate drop, queue ratio, or accounting staleness caused the trigger. Safety module may have auto-paused. |
| **OllaSlashingDetected** | NegativeRewardsPeriod event | Validator slashing detected. Check validator health on the rollup. Review `slashing_delta` and `staking_state_slashing_delta` metrics. |
| **OllaSafetyModulePaused** | `safety_module_paused == 1` | Deposits are blocked. Determine if pause was from circuit breaker or manual. Unpause via governance multisig when root cause is resolved. |
| **OllaExchangeRateDrop** | Exchange rate dropped >10 bps | May indicate slashing or accounting error. Compare with `latest_report_gross_rewards` and `negative_rewards_period_count`. |

### Warning

| Alert | Trigger | Response |
|-------|---------|----------|
| **OllaRebalanceOverdue** | Cooldown elapsed, step != Done for 10m | Check rebalancer bot status. Review `rebalance_step` and `rebalance_event_count`. May need manual rebalance trigger. |
| **OllaAccountingStale** | No accounting update in 24h | Check accounting bot / rebalancer. The `accounting_update_event_count` should be incrementing. |
| **OllaBufferLow** | Buffer utilization < 20% for 10m | Liquidity buffer is low. Instant redemptions may fail. A rebalance should replenish the buffer. |
| **OllaScraperDown** | Last scrape failed for 5m+ | Check butler logs. Verify RPC URL is accessible. May indicate RPC rate limiting or contract issues. |
| **OllaScraperErrors** | >5 consecutive scrape failures | Similar to ScraperDown but triggers faster. Check `scraper_duration_ms` for timeout patterns. |
| **OllaRpcUnreachable** | No scraper succeeded for 2m | All scrapers for a network are failing. Check RPC provider status. All metrics for this network are stale. |
| **OllaKeyQueueLow** | Key queue / attester ratio < 0.5 for 30m | Running low on attester keys. Provision new keys via the staking provider registry before the queue empties. |

## Metric Reference

All metrics are prefixed with `olla_butler_` and include a `network` label.

Scraper health metrics additionally include a `scraper` label (e.g., `core`, `vault`, `staking`, `safety-module`, `withdrawal-queue`, `event-watcher`).
