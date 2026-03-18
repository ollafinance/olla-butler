/**
 * Protocol-level metrics from OllaCore.
 * Exposes TVL, exchange rate, accounting state, rebalance progress, fees.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";
import { RebalanceStepNames } from "../../types/index.js";

const WEI_DIVISOR = 1e18;

export const initProtocolMetrics = () => {
  // TVL
  const totalAssetsGauge = createObservableGauge("total_assets", {
    description: "Total assets held by the protocol (in token units, 18 decimals divided)",
  });
  totalAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.totalAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  // Exchange rate
  const exchangeRateGauge = createObservableGauge("exchange_rate", {
    description: "stAztec/AZTEC exchange rate (18-decimal fixed point divided)",
  });
  exchangeRateGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.exchangeRate) / WEI_DIVISOR, { network });
      }
    }
  });

  // Staked principal
  const stakedPrincipalGauge = createObservableGauge("staked_principal", {
    description: "Total assets staked with validators",
  });
  stakedPrincipalGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.accountingState.stakedPrincipal) / WEI_DIVISOR, { network });
      }
    }
  });

  // Rewards accumulator balance
  const rewardsAccBalGauge = createObservableGauge("rewards_accumulator_balance", {
    description: "Current balance in rewards accumulator",
  });
  rewardsAccBalGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.accountingState.rewardsAccumulatorBalance) / WEI_DIVISOR, { network });
      }
    }
  });

  // Claimable rewards
  const claimableRewardsGauge = createObservableGauge("claimable_rewards", {
    description: "Rewards available for harvesting from rollup",
  });
  claimableRewardsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.accountingState.claimableRewards) / WEI_DIVISOR, { network });
      }
    }
  });

  // Cumulative rewards (lifetime)
  const cumulativeRewardsGauge = createObservableGauge("cumulative_rewards", {
    description: "Lifetime cumulative rewards accrued",
  });
  cumulativeRewardsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.accountingState.cumulativeRewards) / WEI_DIVISOR, { network });
      }
    }
  });

  // Slashing delta
  const slashingDeltaGauge = createObservableGauge("slashing_delta", {
    description: "Cumulative slashing delta",
  });
  slashingDeltaGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.accountingState.slashingDelta) / WEI_DIVISOR, { network });
      }
    }
  });

  // Protocol fee (basis points)
  const protocolFeeGauge = createObservableGauge("protocol_fee_bp", {
    description: "Protocol fee in basis points",
  });
  protocolFeeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.protocolFeeBP, { network });
      }
    }
  });

  // Treasury fee split (basis points)
  const treasurySplitGauge = createObservableGauge("treasury_fee_split_bp", {
    description: "Treasury fee split in basis points",
  });
  treasurySplitGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(state.coreData.treasuryFeeSplitBP, { network });
      }
    }
  });

  // Target buffered assets
  const targetBufferGauge = createObservableGauge("target_buffered_assets", {
    description: "Target liquid assets buffer",
  });
  targetBufferGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.targetBufferedAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  // Rebalance step
  const rebalanceStepGauge = createObservableGauge("rebalance_step", {
    description: "Current rebalance step (0=Harvest, 1=PullUnstaked, 2=FinalizeWithdrawals, 3=InitiateUnstake, 4=StakeSurplus, 5=Done)",
  });
  rebalanceStepGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const stepName = RebalanceStepNames[state.coreData.rebalanceProgress.step] ?? "Unknown";
        result.observe(state.coreData.rebalanceProgress.step, { network, step_name: stepName });
      }
    }
  });

  // Latest report timestamp
  const latestReportTimestampGauge = createObservableGauge("latest_report_timestamp", {
    description: "Unix timestamp of last accounting update",
    unit: "seconds",
  });
  latestReportTimestampGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.latestReport.timestamp), { network });
      }
    }
  });

  // Latest report gross rewards
  const grossRewardsGauge = createObservableGauge("latest_report_gross_rewards", {
    description: "Gross rewards from latest accounting report",
  });
  grossRewardsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.latestReport.grossRewards) / WEI_DIVISOR, { network });
      }
    }
  });

  // Cumulative deposits
  const cumulativeDepositsGauge = createObservableGauge("cumulative_deposits", {
    description: "Lifetime cumulative deposits",
  });
  cumulativeDepositsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.flowCounters.cumulativeDeposits) / WEI_DIVISOR, { network });
      }
    }
  });

  // Cumulative withdrawals
  const cumulativeWithdrawalsGauge = createObservableGauge("cumulative_withdrawals", {
    description: "Lifetime cumulative withdrawals",
  });
  cumulativeWithdrawalsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        result.observe(Number(state.coreData.flowCounters.cumulativeWithdrawals) / WEI_DIVISOR, { network });
      }
    }
  });

  // Data freshness
  const coreDataAgeGauge = createObservableGauge("core_data_age_seconds", {
    description: "Seconds since core data was last scraped",
    unit: "seconds",
  });
  coreDataAgeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.coreData) {
        const ageMs = Date.now() - state.coreData.lastUpdated.getTime();
        result.observe(Math.floor(ageMs / 1000), { network });
      }
    }
  });

  console.log("Protocol metrics initialized");
};
