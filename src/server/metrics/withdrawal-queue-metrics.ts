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

  console.log("Withdrawal queue metrics initialized");
};
