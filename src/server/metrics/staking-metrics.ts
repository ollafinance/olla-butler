/**
 * Staking-level metrics from StakingManager + StakingProviderRegistry.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

const WEI_DIVISOR = 1e18;

export const initStakingMetrics = () => {
  const totalStakedGauge = createObservableGauge("total_staked", {
    description: "Total assets staked with validators",
  });
  totalStakedGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.totalStaked) / WEI_DIVISOR, { network });
      }
    }
  });

  const pendingUnstakesGauge = createObservableGauge("pending_unstakes", {
    description: "Total pending unstake amount",
  });
  pendingUnstakesGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.pendingUnstakes) / WEI_DIVISOR, { network });
      }
    }
  });

  const activeAttesterCountGauge = createObservableGauge("activated_attester_count", {
    description: "Number of active attesters",
  });
  activeAttesterCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.activatedAttesterCount), { network });
      }
    }
  });

  const pendingUnstakeCountGauge = createObservableGauge("pending_unstake_count", {
    description: "Number of attesters pending unstake (exiting)",
  });
  pendingUnstakeCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.pendingUnstakeCount), { network });
      }
    }
  });

  const hasFinalizedUnstakesGauge = createObservableGauge("has_finalized_unstakes", {
    description: "Whether there are finalized unstakes ready to exit (0/1)",
  });
  hasFinalizedUnstakesGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(state.stakingData.hasFinalizedUnstakes ? 1 : 0, { network });
      }
    }
  });

  // Staking state breakdown
  const stakingStateStakedGauge = createObservableGauge("staking_state_staked_amount", {
    description: "Staking state: total amount in VALIDATING status",
  });
  stakingStateStakedGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.stakingState.stakedAmount) / WEI_DIVISOR, { network });
      }
    }
  });

  const stakingStatePendingGauge = createObservableGauge("staking_state_pending_unstake_amount", {
    description: "Staking state: total in exit state, not yet exitable",
  });
  stakingStatePendingGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.stakingState.pendingUnstakeAmount) / WEI_DIVISOR, { network });
      }
    }
  });

  const stakingStateSlashingGauge = createObservableGauge("staking_state_slashing_delta", {
    description: "Staking state: cumulative slashing delta from rollup",
  });
  stakingStateSlashingGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.stakingState.slashingDelta) / WEI_DIVISOR, { network });
      }
    }
  });

  const keyQueueLengthGauge = createObservableGauge("key_queue_length", {
    description: "Number of available attester keys in provider registry queue",
  });
  keyQueueLengthGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        result.observe(Number(state.stakingData.keyQueueLength), { network });
      }
    }
  });

  const stakingDataAgeGauge = createObservableGauge("staking_data_age_seconds", {
    description: "Seconds since staking data was last scraped",
    unit: "seconds",
  });
  stakingDataAgeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.stakingData) {
        const ageMs = Date.now() - state.stakingData.lastUpdated.getTime();
        result.observe(Math.floor(ageMs / 1000), { network });
      }
    }
  });

  console.log("Staking metrics initialized");
};
