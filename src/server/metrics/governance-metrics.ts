/**
 * Governance-configurable parameter metrics.
 * Exposes all on-chain settings that can be changed by governance,
 * enabling dashboards and alerts for parameter changes.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

const WEI_DIVISOR = 1e18;

export const initGovernanceMetrics = () => {
  // === OllaCore governance params ===

  const rebalanceCooldownGauge = createObservableGauge("gov_rebalance_cooldown_seconds", {
    description: "On-chain rebalance cooldown in seconds (governance-settable)",
    unit: "seconds",
  });
  rebalanceCooldownGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.rebalanceCooldown, { network });
      }
    }
  });

  const rebalanceGasThresholdGauge = createObservableGauge("gov_rebalance_gas_threshold", {
    description: "Gas threshold for rebalance step gating (governance-settable)",
  });
  rebalanceGasThresholdGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.rebalanceGasThreshold, { network });
      }
    }
  });

  const targetBufferGauge = createObservableGauge("gov_target_buffered_assets", {
    description: "Target liquid assets buffer (governance-settable)",
  });
  targetBufferGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.targetBufferedAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  const protocolFeeGauge = createObservableGauge("gov_protocol_fee_bp", {
    description: "Protocol fee in basis points (governance-settable)",
  });
  protocolFeeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.protocolFeeBP, { network });
      }
    }
  });

  const treasurySplitGauge = createObservableGauge("gov_treasury_fee_split_bp", {
    description: "Treasury fee split in basis points (governance-settable)",
  });
  treasurySplitGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.treasuryFeeSplitBP, { network });
      }
    }
  });

  // === SafetyModule governance params ===

  const depositCapGauge = createObservableGauge("gov_deposit_cap", {
    description: "Maximum total assets allowed by safety module (governance-settable)",
  });
  depositCapGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.depositCap) / WEI_DIVISOR, { network });
      }
    }
  });

  const minRateDropBpsGauge = createObservableGauge("gov_min_rate_drop_bps", {
    description: "Exchange rate drop threshold for circuit breaker in basis points (governance-settable)",
  });
  minRateDropBpsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.minRateDropBps), { network });
      }
    }
  });

  const maxQueueRatioBpsGauge = createObservableGauge("gov_max_queue_ratio_bps", {
    description: "Withdrawal queue ratio threshold for circuit breaker in basis points (governance-settable)",
  });
  maxQueueRatioBpsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.maxQueueRatioBps), { network });
      }
    }
  });

  const maxAccountingDelayGauge = createObservableGauge("gov_max_accounting_delay_seconds", {
    description: "Max accounting staleness before circuit breaker in seconds (governance-settable)",
    unit: "seconds",
  });
  maxAccountingDelayGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.maxAccountingDelay), { network });
      }
    }
  });

  const withdrawalMinimumGauge = createObservableGauge("gov_withdrawal_minimum", {
    description: "Minimum withdrawal amount in shares (governance-settable)",
  });
  withdrawalMinimumGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.safetyModuleData) {
        result.observe(Number(state.safetyModuleData.withdrawalMinimum) / WEI_DIVISOR, { network });
      }
    }
  });

  // === Vault governance params ===

  const instantRedemptionFeeGauge = createObservableGauge("gov_instant_redemption_fee_bp", {
    description: "Instant redemption fee in basis points (governance-settable)",
  });
  instantRedemptionFeeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.instantRedemptionFeeBP), { network });
      }
    }
  });

  // === WithdrawalQueue governance params ===

  const wqGasThresholdGauge = createObservableGauge("gov_withdrawal_queue_gas_threshold", {
    description: "Gas threshold for withdrawal queue finalization (governance-settable)",
  });
  wqGasThresholdGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        result.observe(state.withdrawalQueueData.gasThreshold, { network });
      }
    }
  });

  console.log("Governance metrics initialized");
};
