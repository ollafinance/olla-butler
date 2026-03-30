/**
 * Attester-level metrics from Aztec rollup state.
 *
 * Aggregate metrics (no per-attester labels) for general monitoring.
 * Per-attester labels only for slashing loss and staleness to keep cardinality bounded.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

const WEI_DIVISOR = 1e18;

export const initAttesterMetrics = () => {
  // -- Aggregate metrics (no per-attester labels) --

  const rollupAttesterActiveGauge = createObservableGauge("rollup_attester_active_count", {
    description: "Number of attesters in VALIDATING status on rollup",
  });
  rollupAttesterActiveGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.rollupActiveCount, { network });
      }
    }
  });

  const rollupAttesterExitingGauge = createObservableGauge("rollup_attester_exiting_count", {
    description: "Number of attesters in EXITING status on rollup",
  });
  rollupAttesterExitingGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.rollupExitingCount, { network });
      }
    }
  });

  const rollupAttesterQueuedGauge = createObservableGauge("rollup_attester_queued_count", {
    description: "Number of attesters in Queued status (deposited on rollup, pending activation)",
  });
  rollupAttesterQueuedGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.rollupQueuedCount, { network });
      }
    }
  });

  const rollupAttesterZombieGauge = createObservableGauge("rollup_attester_zombie_count", {
    description: "Number of attesters in ZOMBIE (slashed) status on rollup",
  });
  rollupAttesterZombieGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.rollupZombieCount, { network });
      }
    }
  });

  const rollupTotalEffectiveBalanceGauge = createObservableGauge("rollup_total_effective_balance", {
    description: "Sum of effectiveBalance for all attesters on rollup",
  });
  rollupTotalEffectiveBalanceGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(Number(state.attesterData.rollupTotalEffectiveBalance) / WEI_DIVISOR, { network });
      }
    }
  });

  const rollupActivationThresholdGauge = createObservableGauge("rollup_activation_threshold", {
    description: "Current stake threshold per attester on rollup",
  });
  rollupActivationThresholdGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(Number(state.attesterData.activationThreshold) / WEI_DIVISOR, { network });
      }
    }
  });

  const cachedVsRollupDriftGauge = createObservableGauge("attester_cached_vs_rollup_drift", {
    description: "Absolute balance drift between StakingManager cache and rollup truth",
  });
  cachedVsRollupDriftGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(Number(state.attesterData.cachedVsRollupBalanceDrift) / WEI_DIVISOR, { network });
      }
    }
  });

  const refreshNeededCountGauge = createObservableGauge("attester_refresh_needed_count", {
    description: "Number of attesters with stale cached state needing refreshAttesterState()",
  });
  refreshNeededCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.staleAttesters.length, { network });
      }
    }
  });

  const exitableCountGauge = createObservableGauge("attester_exitable_count", {
    description: "Number of attesters with exits past delay period, ready to finalize",
  });
  exitableCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.exitableAttesterCount, { network });
      }
    }
  });

  const attesterTrackedCountGauge = createObservableGauge("attester_tracked_count", {
    description: "Total number of attesters tracked in the registry",
  });
  attesterTrackedCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        result.observe(state.attesterData.attesters.length, { network });
      }
    }
  });

  const attesterDataAgeGauge = createObservableGauge("attester_data_age_seconds", {
    description: "Seconds since attester data was last scraped",
    unit: "seconds",
  });
  attesterDataAgeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        const ageMs = Date.now() - state.attesterData.lastUpdated.getTime();
        result.observe(Math.floor(ageMs / 1000), { network });
      }
    }
  });

  // -- Per-attester metrics (only for slashing and staleness) --

  const attesterSlashingLossGauge = createObservableGauge("attester_slashing_loss", {
    description: "Slashing loss for individual attesters (per-attester label, only when > 0)",
  });
  attesterSlashingLossGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        for (const stale of state.attesterData.staleAttesters) {
          if (stale.slashingLoss > 0n) {
            result.observe(Number(stale.slashingLoss) / WEI_DIVISOR, {
              network,
              attester: stale.address,
            });
          }
        }
      }
    }
  });

  const attesterStaleGauge = createObservableGauge("attester_stale", {
    description: "Staleness indicator per attester and reason (1 = stale)",
  });
  attesterStaleGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.attesterData) {
        for (const stale of state.attesterData.staleAttesters) {
          for (const reason of stale.reasons) {
            result.observe(1, {
              network,
              attester: stale.address,
              reason,
            });
          }
        }
      }
    }
  });

  console.log("Attester metrics initialized");
};
