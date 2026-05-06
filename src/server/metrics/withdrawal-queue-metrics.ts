/**
 * Withdrawal queue metrics.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";
import {
  getUnclaimedAssets,
  getUnclaimedCount,
  isUnclaimedRegistryInitialized,
} from "../state/withdrawal-queue-registry.js";

const WEI_DIVISOR = 1e18;

export const initWithdrawalQueueMetrics = () => {
  const nextRequestIdGauge = createObservableGauge("withdrawal_queue_next_request_id", {
    description: "Next withdrawal request ID to be assigned",
  });
  nextRequestIdGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        result.observe(Number(state.withdrawalQueueData.nextRequestId), { network });
      }
    }
  });

  const pendingAssetsGauge = createObservableGauge("withdrawal_queue_pending_assets", {
    description: "Total pending assets in withdrawal queue",
  });
  pendingAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        result.observe(Number(state.withdrawalQueueData.totalPendingAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  const pendingSharesGauge = createObservableGauge("withdrawal_queue_pending_shares", {
    description: "Total pending shares in withdrawal queue",
  });
  pendingSharesGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        result.observe(Number(state.withdrawalQueueData.totalPendingShares) / WEI_DIVISOR, { network });
      }
    }
  });

  const unfinalizedCountGauge = createObservableGauge("withdrawal_queue_unfinalized_count", {
    description: "Number of unfinalized withdrawal requests (nextRequestId - nextUnfinalized)",
  });
  unfinalizedCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        const count = state.withdrawalQueueData.nextRequestId - state.withdrawalQueueData.nextUnfinalized;
        result.observe(Number(count), { network });
      }
    }
  });

  // Finalized-but-unclaimed: derived from per-event counters maintained by
  // the WithdrawalQueue WS listener (the contract has no on-chain aggregate
  // for this). Only emitted on networks where the listener has backfilled
  // and is running — otherwise a 0 reading would be indistinguishable from
  // "no listener configured".
  const unclaimedCountGauge = createObservableGauge("withdrawal_queue_unclaimed_count", {
    description: "Number of finalized but unclaimed withdrawal requests",
  });
  unclaimedCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network] of getAllNetworkStates().entries()) {
      if (isUnclaimedRegistryInitialized(network)) {
        result.observe(getUnclaimedCount(network), { network });
      }
    }
  });

  const unclaimedAssetsGauge = createObservableGauge("withdrawal_queue_unclaimed_assets", {
    description: "Total assets in finalized but unclaimed withdrawal requests",
  });
  unclaimedAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network] of getAllNetworkStates().entries()) {
      if (isUnclaimedRegistryInitialized(network)) {
        result.observe(Number(getUnclaimedAssets(network)) / WEI_DIVISOR, { network });
      }
    }
  });

  const totalRequestCountGauge = createObservableGauge("withdrawal_queue_total_request_count", {
    description: "Total number of withdrawal requests ever created (nextRequestId - 1 since IDs start at 1)",
  });
  totalRequestCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        // nextRequestId is the next ID to be assigned, so total requests = nextRequestId - 1 (IDs start at 1)
        const total = state.withdrawalQueueData.nextRequestId - 1n;
        result.observe(Number(total >= 0n ? total : 0n), { network });
      }
    }
  });

  // Average size of finalized withdrawal requests. Numerator
  // (vault.cumulativeWithdrawals) accumulates only when a request finalizes,
  // so the denominator must be the count of finalized requests
  // (nextPendingId - 1) — using nextRequestId would dilute by the pending
  // backlog and bias the average low.
  const avgRequestSizeGauge = createObservableGauge("withdrawal_queue_avg_request_size", {
    description: "Average finalized withdrawal request size (cumulative withdrawals / finalized requests, token units)",
  });
  avgRequestSizeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData && state.vaultData) {
        const finalizedRequests = state.withdrawalQueueData.nextPendingId - 1n;
        if (finalizedRequests > 0n) {
          const avg = Number(state.vaultData.cumulativeWithdrawals) / WEI_DIVISOR / Number(finalizedRequests);
          result.observe(avg, { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  // WithdrawalQueue.nextUnfinalized() aliases nextPendingId; both pointers
  // advance on finalization, so this measures the finalized fraction.
  const fulfillmentRatioGauge = createObservableGauge("withdrawal_queue_fulfillment_ratio_pct", {
    description: "Percentage of withdrawal requests that have been finalized ((nextPendingId - 1) / (nextRequestId - 1) * 100)",
  });
  fulfillmentRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        const total = state.withdrawalQueueData.nextRequestId - 1n;
        if (total > 0n) {
          const finalized = state.withdrawalQueueData.nextPendingId - 1n;
          result.observe(Number(finalized * 10000n / total) / 100, { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  console.log("Withdrawal queue metrics initialized");
};
