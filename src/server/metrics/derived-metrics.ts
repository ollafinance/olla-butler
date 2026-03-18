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

  // Rebalance overdue flag
  const rebalanceOverdueGauge = createObservableGauge("rebalance_overdue", {
    description: "1 if rebalance cooldown has elapsed and step is not Done, 0 otherwise",
  });
  rebalanceOverdueGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const overdue = isRebalanceOverdue(
          state.coreData.latestReport.timestamp,
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

  // Capital efficiency
  const capitalEfficiencyGauge = createObservableGauge("capital_efficiency_pct", {
    description: "Percentage of TVL earning yield (stakedPrincipal / totalAssets)",
  });
  capitalEfficiencyGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const pct = capitalEfficiencyPct(
          state.coreData.accountingState.stakedPrincipal,
          state.coreData.totalAssets,
        );
        result.observe(pct, { network });
      }
    }
  });

  // Rewards APR
  const rewardsAprGauge = createObservableGauge("rewards_apr_pct", {
    description: "Annualized yield percentage based on latest report",
  });
  rewardsAprGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const apr = rewardsAprPct(
          state.coreData.latestReport.grossRewards,
          state.coreData.accountingState.stakedPrincipal,
          state.coreData.latestReport.timestamp,
          Math.floor(Date.now() / 1000),
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
