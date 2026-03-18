/**
 * Vault-level metrics from OllaVault + stAztec.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

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

  const instantRedemptionFeeGauge = createObservableGauge("instant_redemption_fee_bp", {
    description: "Instant redemption fee in basis points",
  });
  instantRedemptionFeeGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.instantRedemptionFeeBP), { network });
      }
    }
  });

  const instantRedemptionAvailableGauge = createObservableGauge("available_for_instant_redemption", {
    description: "Assets available for instant redemption",
  });
  instantRedemptionAvailableGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.vaultData) {
        result.observe(Number(state.vaultData.availableForInstantRedemption) / WEI_DIVISOR, { network });
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

  console.log("Vault metrics initialized");
};
