/**
 * Withdrawal queue metrics.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

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

  const unclaimedCountGauge = createObservableGauge("withdrawal_queue_unclaimed_count", {
    description: "Number of finalized but unclaimed requests (nextUnfinalized - nextPendingId)",
  });
  unclaimedCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        const count = state.withdrawalQueueData.nextUnfinalized - state.withdrawalQueueData.nextPendingId;
        if (count >= 0n) {
          result.observe(Number(count), { network });
        }
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

  const avgRequestSizeGauge = createObservableGauge("withdrawal_queue_avg_request_size", {
    description: "Average withdrawal request size (cumulative withdrawals / total requests, token units)",
  });
  avgRequestSizeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData && state.vaultData) {
        const totalRequests = state.withdrawalQueueData.nextRequestId - 1n;
        if (totalRequests > 0n) {
          const avg = Number(state.vaultData.cumulativeWithdrawals) / WEI_DIVISOR / Number(totalRequests);
          result.observe(avg, { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  const fulfillmentRatioGauge = createObservableGauge("withdrawal_queue_fulfillment_ratio_pct", {
    description: "Percentage of withdrawal requests that have been finalized (nextPendingId / nextRequestId * 100)",
  });
  fulfillmentRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.withdrawalQueueData) {
        const total = state.withdrawalQueueData.nextRequestId - 1n;
        if (total > 0n) {
          // nextPendingId points to the first unclaimed request, so all before it are claimed
          const claimed = state.withdrawalQueueData.nextPendingId - 1n;
          result.observe(Number(claimed * 100n / total), { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  console.log("Withdrawal queue metrics initialized");
};
