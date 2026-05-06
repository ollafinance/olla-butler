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

  // Withdrawal queue ratio (pending withdrawals / vault TVL) — mirrors the
  // SafetyModule's maxQueueRatioBps circuit breaker, which compares pending
  // against the vault's totalAssets, not core's.
  const queueRatioGauge = createObservableGauge("withdrawal_queue_ratio_pct", {
    description: "Withdrawal queue ratio percentage (vault.pendingWithdrawalAssets / vault.totalAssets * 100)",
  });
  queueRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData && state.vaultData.totalAssets > 0n) {
        const bps = (state.vaultData.pendingWithdrawalAssets * 10000n) / state.vaultData.totalAssets;
        result.observe(Number(bps) / 100, { network });
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
