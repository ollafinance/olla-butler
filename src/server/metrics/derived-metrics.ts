/**
 * Derived metrics computed from existing scraped state.
 * These provide actionable signals for operational alerting.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";
import {
  exchangeRateChangeBps,
  isRebalanceOverdue,
  bufferUtilizationPct,
  capitalEfficiencyPct,
  rewardsAprPct,
  keyQueueToAttesterRatio,
} from "./calculations.js";

const WEI_DIVISOR = 1e18;

export const initDerivedMetrics = () => {
  // Exchange rate change in basis points
  const exchangeRateChangeBpsGauge = createObservableGauge("exchange_rate_change_bps", {
    description: "Exchange rate change since last scrape in basis points",
  });
  exchangeRateChangeBpsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const bps = exchangeRateChangeBps(
          state.coreData.exchangeRate,
          state.previousExchangeRate,
        );
        result.observe(bps, { network });
      }
    }
  });

  // Rebalance overdue flag — measured from the last Rebalanced event, not
  // the accounting-report timestamp. Skipped until the event listener has
  // observed at least one rebalance, otherwise we'd report a 0 reading
  // indistinguishable from "no listener configured".
  const rebalanceOverdueGauge = createObservableGauge("rebalance_overdue", {
    description: "1 if rebalance cooldown has elapsed since last Rebalanced event and step is not Done, 0 otherwise",
  });
  rebalanceOverdueGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData && state.eventData?.lastRebalanceTimestamp) {
        const lastRebalanceSeconds = BigInt(
          Math.floor(state.eventData.lastRebalanceTimestamp.getTime() / 1000),
        );
        const overdue = isRebalanceOverdue(
          lastRebalanceSeconds,
          state.coreData.rebalanceCooldown,
          state.coreData.rebalanceProgress.step,
        );
        result.observe(overdue ? 1 : 0, { network });
      }
    }
  });

  // Buffer utilization percentage
  const bufferUtilizationGauge = createObservableGauge("buffer_utilization_pct", {
    description: "Buffered assets as percentage of target buffer",
  });
  bufferUtilizationGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData && state.vaultData) {
        const pct = bufferUtilizationPct(
          state.vaultData.bufferedAssets,
          state.coreData.targetBufferedAssets,
        );
        result.observe(pct, { network });
      }
    }
  });

  // Capital efficiency: staked / (staked + buffer + rewardsAccumulator + claimableRewards).
  // Denominator is the idle pool the rebalancer can address; pending
  // withdrawals/unstakes are excluded as they aren't operationally redeployable.
  const capitalEfficiencyGauge = createObservableGauge("capital_efficiency_pct", {
    description: "Percentage of operationally-deployable capital that is staked (staked / (staked + buffer + rewardsAccumulator + claimableRewards))",
  });
  capitalEfficiencyGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData && state.vaultData) {
        const pct = capitalEfficiencyPct(
          state.coreData.accountingState.stakedPrincipal,
          state.vaultData.bufferedAssets,
          state.coreData.accountingState.rewardsAccumulatorBalance,
          state.coreData.accountingState.claimableRewards,
        );
        result.observe(pct, { network });
      }
    }
  });

  // Rewards APR — annualized over the closed report period
  // (current report timestamp − previous report timestamp). Skipped until a
  // second report has been observed so the period boundary is known.
  const rewardsAprGauge = createObservableGauge("rewards_apr_pct", {
    description: "Annualized yield percentage from the most recent closed accounting period",
  });
  rewardsAprGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData && state.previousReportTimestamp !== null) {
        const periodSeconds = Number(
          state.coreData.latestReport.timestamp - state.previousReportTimestamp,
        );
        const apr = rewardsAprPct(
          state.coreData.latestReport.grossRewards,
          state.coreData.accountingState.stakedPrincipal,
          periodSeconds,
        );
        result.observe(apr, { network });
      }
    }
  });

  // Key queue to attester ratio
  const keyQueueRatioGauge = createObservableGauge("key_queue_to_attester_ratio", {
    description: "Key queue length divided by active attester count",
  });
  keyQueueRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        const ratio = keyQueueToAttesterRatio(
          state.stakingData.keyQueueLength,
          state.stakingData.activatedAttesterCount,
        );
        result.observe(ratio, { network });
      }
    }
  });

  // accounting_staleness_seconds is registered by safety-metrics.ts.

  // Time since last rebalance
  const rebalanceTimeSinceGauge = createObservableGauge("rebalance_time_since_seconds", {
    description: "Seconds since the last Rebalanced event",
    unit: "seconds",
  });
  rebalanceTimeSinceGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.eventData?.lastRebalanceTimestamp) {
        const ageMs = Date.now() - state.eventData.lastRebalanceTimestamp.getTime();
        result.observe(Math.floor(ageMs / 1000), { network });
      }
    }
  });

  // Net flow since last report
  const netFlowSinceReportGauge = createObservableGauge("net_flow_since_report", {
    description: "Net deposits minus withdrawals since last accounting update (token units)",
  });
  netFlowSinceReportGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const fc = state.coreData.flowCounters;
        const depositsSinceReport = fc.cumulativeDeposits - fc.latestReportCumulativeDeposits;
        const withdrawalsSinceReport = fc.cumulativeWithdrawals - fc.latestReportCumulativeWithdrawals;
        const netFlow = depositsSinceReport - withdrawalsSinceReport;
        result.observe(Number(netFlow) / WEI_DIVISOR, { network });
      }
    }
  });

  console.log("Derived metrics initialized");
};
