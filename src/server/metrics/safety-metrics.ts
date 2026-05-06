/**
 * Safety module metrics.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

const WEI_DIVISOR = 1e18;

export const initSafetyMetrics = () => {
  const pausedGauge = createObservableGauge("safety_module_paused", {
    description: "Whether the safety module is paused (0/1)",
  });
  pausedGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(state.safetyModuleData.isPaused ? 1 : 0, { network });
      }
    }
  });

  const depositCapGauge = createObservableGauge("deposit_cap", {
    description: "Maximum total assets allowed by safety module",
  });
  depositCapGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.depositCap) / WEI_DIVISOR, { network });
      }
    }
  });

  // Deposit cap utilization (TVL / cap as percentage)
  const depositCapUtilGauge = createObservableGauge("deposit_cap_utilization_pct", {
    description: "Deposit cap utilization percentage (TVL / cap * 100)",
  });
  depositCapUtilGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData && state.coreData && state.safetyModuleData.depositCap > 0n) {
        const utilization =
          (Number(state.coreData.totalAssets) / Number(state.safetyModuleData.depositCap)) * 100;
        result.observe(utilization, { network });
      }
    }
  });

  // Withdrawal queue ratio — mirrors SafetyModule.checkQueueRatio: pending /
  // (pending + totalAssets). totalAssets() already subtracts pending, so the
  // gross denominator must add it back.
  //
  // Snapshot-stale vs. on-chain breaker: butler reads the stored
  // `pendingWithdrawalAssets`, while checkQueueRatio is fed a live
  // `_pricingPendingAssets()` recomputed from current rate. The two
  // reconcile at every accounting update and drift between updates by
  // ~yield_rate * staleness — sub-bps under typical conditions, bounded by
  // the protocol's accounting-liveness check. Use a margin from
  // maxQueueRatioBps when alerting.
  const queueRatioGauge = createObservableGauge("withdrawal_queue_ratio_pct", {
    description: "Withdrawal queue ratio percentage (pending / (pending + totalAssets) * 100, snapshot-stale)",
  });
  queueRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const gross = state.vaultData.pendingWithdrawalAssets + state.vaultData.totalAssets;
        if (gross > 0n) {
          const bps = (state.vaultData.pendingWithdrawalAssets * 10000n) / gross;
          result.observe(Number(bps) / 100, { network });
        }
      }
    }
  });

  // Accounting staleness
  const accountingStalenessGauge = createObservableGauge("accounting_staleness_seconds", {
    description: "Seconds since last accounting update on-chain",
    unit: "seconds",
  });
  accountingStalenessGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData && state.coreData.latestReport.timestamp > 0n) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const staleness = nowSeconds - Number(state.coreData.latestReport.timestamp);
        result.observe(staleness, { network });
      }
    }
  });

  console.log("Safety metrics initialized");
};
