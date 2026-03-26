/**
 * Event-based metrics from on-chain event monitoring.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";
import type { EventData } from "../../types/index.js";

const WEI_DIVISOR = 1e18;

const eventGauge = (
  name: string,
  description: string,
  getValue: (data: EventData) => number,
) => {
  const gauge = createObservableGauge(name, { description });
  gauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.eventData) {
        result.observe(getValue(state.eventData), { network });
      }
    }
  });
};

export const initEventMetrics = () => {
  // -- Critical safety --
  eventGauge(
    "circuit_breaker_triggered_count",
    "Total CircuitBreakerTriggered events since butler start",
    (d) => d.circuitBreakerTriggeredCount,
  );
  eventGauge(
    "circuit_breaker_rate_drop_count",
    "CircuitBreakerTriggered events with RateDrop reason",
    (d) => d.circuitBreakerByReason.rateDrop,
  );
  eventGauge(
    "circuit_breaker_queue_ratio_count",
    "CircuitBreakerTriggered events with QueueRatio reason",
    (d) => d.circuitBreakerByReason.queueRatio,
  );
  eventGauge(
    "circuit_breaker_accounting_stale_count",
    "CircuitBreakerTriggered events with AccountingStale reason",
    (d) => d.circuitBreakerByReason.accountingStale,
  );
  eventGauge(
    "negative_rewards_period_count",
    "Total NegativeRewardsPeriod events (slashing detected)",
    (d) => d.negativeRewardsPeriodCount,
  );
  eventGauge(
    "safety_paused_event_count",
    "Total SafetyModule Paused events",
    (d) => d.safetyPausedCount,
  );
  eventGauge(
    "safety_unpaused_event_count",
    "Total SafetyModule Unpaused events",
    (d) => d.safetyUnpausedCount,
  );

  // -- User flows --
  eventGauge("deposit_event_count", "Total Deposit events", (d) => d.depositCount);
  eventGauge(
    "deposit_event_volume",
    "Cumulative deposit volume from events (token units)",
    (d) => Number(d.depositVolume) / WEI_DIVISOR,
  );
  eventGauge("redeem_request_event_count", "Total RedeemRequest events", (d) => d.redeemRequestCount);
  eventGauge(
    "redeem_request_event_volume",
    "Cumulative redeem request volume (token units)",
    (d) => Number(d.redeemRequestVolume) / WEI_DIVISOR,
  );
  eventGauge(
    "instant_redemption_event_count",
    "Total InstantRedemption events",
    (d) => d.instantRedemptionCount,
  );
  eventGauge(
    "instant_redemption_event_volume",
    "Cumulative instant redemption gross volume (token units)",
    (d) => Number(d.instantRedemptionVolume) / WEI_DIVISOR,
  );
  eventGauge(
    "instant_redemption_fees_volume",
    "Cumulative instant redemption fees (token units)",
    (d) => Number(d.instantRedemptionFees) / WEI_DIVISOR,
  );
  eventGauge(
    "withdrawal_claim_event_count",
    "Total WithdrawalClaimed events",
    (d) => d.withdrawalClaimCount,
  );
  eventGauge(
    "withdrawal_claim_event_volume",
    "Cumulative withdrawal claim volume (token units)",
    (d) => Number(d.withdrawalClaimVolume) / WEI_DIVISOR,
  );

  // -- Operations --
  eventGauge("rebalance_event_count", "Total Rebalanced events", (d) => d.rebalanceCount);
  eventGauge(
    "accounting_update_event_count",
    "Total AccountingUpdated events",
    (d) => d.accountingUpdateCount,
  );
  eventGauge(
    "rewards_harvested_volume",
    "Cumulative rewards harvested (token units)",
    (d) => Number(d.rewardsHarvestedVolume) / WEI_DIVISOR,
  );

  // -- Staking --
  eventGauge("stake_event_count", "Total StakedWithProvider events", (d) => d.stakedCount);
  eventGauge(
    "stake_event_volume",
    "Cumulative staked volume (token units)",
    (d) => Number(d.stakedVolume) / WEI_DIVISOR,
  );
  eventGauge(
    "unstake_initiated_event_count",
    "Total UnstakeInitiated events",
    (d) => d.unstakeInitiatedCount,
  );
  eventGauge(
    "unstake_initiated_event_volume",
    "Cumulative unstake initiated volume (token units)",
    (d) => Number(d.unstakeInitiatedVolume) / WEI_DIVISOR,
  );
  eventGauge(
    "unstake_finalized_event_count",
    "Total UnstakeFinalized events",
    (d) => d.unstakeFinalizedCount,
  );
  eventGauge(
    "unstake_finalized_event_volume",
    "Cumulative unstake finalized volume (token units)",
    (d) => Number(d.unstakeFinalizedVolume) / WEI_DIVISOR,
  );

  // -- Withdrawal queue --
  eventGauge(
    "withdrawal_requested_event_count",
    "Total WithdrawalRequested events",
    (d) => d.withdrawalRequestedCount,
  );
  eventGauge(
    "withdrawal_requested_event_volume",
    "Cumulative withdrawal requested volume (token units)",
    (d) => Number(d.withdrawalRequestedVolume) / WEI_DIVISOR,
  );
  eventGauge(
    "withdrawal_finalized_event_count",
    "Total WithdrawalFinalized events",
    (d) => d.withdrawalFinalizedCount,
  );
  eventGauge(
    "withdrawal_finalized_event_volume",
    "Cumulative withdrawal finalized volume (token units)",
    (d) => Number(d.withdrawalFinalizedVolume) / WEI_DIVISOR,
  );

  // -- Other --
  eventGauge(
    "withdrawal_adjusted_event_count",
    "Total WithdrawalAdjusted events (slashing adjustments)",
    (d) => d.withdrawalAdjustedCount,
  );
  eventGauge(
    "config_change_event_count",
    "Total protocol configuration change events",
    (d) => d.configChangeCount,
  );
  eventGauge(
    "implementation_upgrade_event_count",
    "Total UUPS implementation upgrade events",
    (d) => d.implementationUpgradeCount,
  );

  // -- Watcher health --
  eventGauge(
    "event_watcher_last_block",
    "Last block number processed by event watcher",
    (d) => Number(d.lastProcessedBlock),
  );
  eventGauge("event_watcher_data_age_seconds", "Seconds since last event watcher poll", (d) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastUpdatedSeconds = Math.floor(d.lastUpdated.getTime() / 1000);
    return nowSeconds - lastUpdatedSeconds;
  });

  console.log("Event metrics initialized");
};
