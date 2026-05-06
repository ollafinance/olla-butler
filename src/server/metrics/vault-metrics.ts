/**
 * Vault-level metrics from OllaVault + stAztec.
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

export const initVaultMetrics = () => {
  const bufferedAssetsGauge = createObservableGauge("buffered_assets", {
    description: "Liquid assets held in the vault",
  });
  bufferedAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.bufferedAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  const pendingWithdrawalAssetsGauge = createObservableGauge("pending_withdrawal_assets", {
    description: "Pending withdrawal assets in queue",
  });
  pendingWithdrawalAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.pendingWithdrawalAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  const pendingWithdrawalSharesGauge = createObservableGauge("pending_withdrawal_shares", {
    description: "Pending withdrawal shares (burned, awaiting finalization)",
  });
  pendingWithdrawalSharesGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.pendingWithdrawalShares) / WEI_DIVISOR, { network });
      }
    }
  });

  const stAztecSupplyGauge = createObservableGauge("st_aztec_total_supply", {
    description: "Total supply of stAztec token",
  });
  stAztecSupplyGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.stAztecTotalSupply) / WEI_DIVISOR, { network });
      }
    }
  });

  const vaultCumulativeDepositsGauge = createObservableGauge("vault_cumulative_deposits", {
    description: "Cumulative deposits tracked by vault",
  });
  vaultCumulativeDepositsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.cumulativeDeposits) / WEI_DIVISOR, { network });
      }
    }
  });

  const vaultCumulativeWithdrawalsGauge = createObservableGauge("vault_cumulative_withdrawals", {
    description: "Cumulative withdrawals tracked by vault",
  });
  vaultCumulativeWithdrawalsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.cumulativeWithdrawals) / WEI_DIVISOR, { network });
      }
    }
  });

  const vaultDataAgeGauge = createObservableGauge("vault_data_age_seconds", {
    description: "Seconds since vault data was last scraped",
    unit: "seconds",
  });
  vaultDataAgeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const ageMs = Date.now() - state.vaultData.lastUpdated.getTime();
        result.observe(Math.floor(ageMs / 1000), { network });
      }
    }
  });

  // === Withdrawal queue (folded into vault) ===

  const nextRequestIdGauge = createObservableGauge("withdrawal_queue_next_request_id", {
    description: "Next withdrawal request ID to be assigned",
  });
  nextRequestIdGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.nextWithdrawalRequestId), { network });
      }
    }
  });

  const pendingAssetsGauge = createObservableGauge("withdrawal_queue_pending_assets", {
    description: "Total pending assets in withdrawal queue",
  });
  pendingAssetsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.pendingWithdrawalAssets) / WEI_DIVISOR, { network });
      }
    }
  });

  const pendingSharesGauge = createObservableGauge("withdrawal_queue_pending_shares", {
    description: "Total pending shares in withdrawal queue",
  });
  pendingSharesGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.pendingWithdrawalShares) / WEI_DIVISOR, { network });
      }
    }
  });

  const unfinalizedCountGauge = createObservableGauge("withdrawal_queue_unfinalized_count", {
    description: "Number of unfinalized withdrawal requests (nextWithdrawalRequestId - nextUnfinalizedWithdrawalRequestId)",
  });
  unfinalizedCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const count = state.vaultData.nextWithdrawalRequestId - state.vaultData.nextUnfinalizedWithdrawalRequestId;
        result.observe(Number(count), { network });
      }
    }
  });

  // Finalized-but-unclaimed: derived from per-event counters maintained by
  // the vault WS listener (the contract has no on-chain aggregate for
  // this). Only emitted on networks where the listener has backfilled and
  // is running — otherwise a 0 reading would be indistinguishable from
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
    description: "Total number of withdrawal requests ever created (nextWithdrawalRequestId - 1 since IDs start at 1)",
  });
  totalRequestCountGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const total = state.vaultData.nextWithdrawalRequestId - 1n;
        result.observe(Number(total >= 0n ? total : 0n), { network });
      }
    }
  });

  // Average size of finalized withdrawal requests. Numerator
  // (vault.cumulativeWithdrawals) accumulates only when a request finalizes,
  // so the denominator must be the count of finalized requests
  // (nextUnfinalizedWithdrawalRequestId - 1) — using nextWithdrawalRequestId
  // would dilute by the pending backlog and bias the average low.
  const avgRequestSizeGauge = createObservableGauge("withdrawal_queue_avg_request_size", {
    description: "Average finalized withdrawal request size (cumulative withdrawals / finalized requests, token units)",
  });
  avgRequestSizeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const finalizedRequests = state.vaultData.nextUnfinalizedWithdrawalRequestId - 1n;
        if (finalizedRequests > 0n) {
          const avg = Number(state.vaultData.cumulativeWithdrawals) / WEI_DIVISOR / Number(finalizedRequests);
          result.observe(avg, { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  const fulfillmentRatioGauge = createObservableGauge("withdrawal_queue_fulfillment_ratio_pct", {
    description: "Percentage of withdrawal requests that have been finalized ((nextUnfinalizedWithdrawalRequestId - 1) / (nextWithdrawalRequestId - 1) * 100)",
  });
  fulfillmentRatioGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        const total = state.vaultData.nextWithdrawalRequestId - 1n;
        if (total > 0n) {
          const finalized = state.vaultData.nextUnfinalizedWithdrawalRequestId - 1n;
          result.observe(Number(finalized * 10000n / total) / 100, { network });
        } else {
          result.observe(0, { network });
        }
      }
    }
  });

  console.log("Vault metrics initialized");
};
