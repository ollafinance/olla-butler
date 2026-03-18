/**
 * Pure calculation functions for derived metrics.
 * All functions are stateless and testable in isolation.
 */

import { RebalanceStep } from "../../types/index.js";

/**
 * Compute exchange rate change in basis points.
 * Returns 0 if previous rate is null or zero.
 */
export function exchangeRateChangeBps(current: bigint, previous: bigint | null): number {
  if (previous === null || previous === 0n) return 0;
  const deltaBps = ((current - previous) * 10000n) / previous;
  return Number(deltaBps);
}

/**
 * Check if rebalance is overdue: cooldown elapsed AND step is not Done.
 */
export function isRebalanceOverdue(
  reportTimestamp: bigint,
  cooldownSeconds: number,
  step: RebalanceStep,
): boolean {
  if (step === RebalanceStep.Done) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const elapsed = nowSeconds - Number(reportTimestamp);
  return elapsed > cooldownSeconds;
}

/**
 * Buffer utilization as a percentage: bufferedAssets / targetBufferedAssets * 100.
 * Returns 0 if target is zero.
 */
export function bufferUtilizationPct(buffered: bigint, target: bigint): number {
  if (target === 0n) return 0;
  return Number((buffered * 10000n) / target) / 100;
}

/**
 * Capital efficiency: stakedPrincipal / totalAssets * 100.
 * Returns 0 if totalAssets is zero.
 */
export function capitalEfficiencyPct(stakedPrincipal: bigint, totalAssets: bigint): number {
  if (totalAssets === 0n) return 0;
  return Number((stakedPrincipal * 10000n) / totalAssets) / 100;
}

/**
 * Annualized yield percentage.
 * Returns 0 if stakedPrincipal is zero or report is very recent (< 1 hour).
 */
export function rewardsAprPct(
  grossRewards: bigint,
  stakedPrincipal: bigint,
  reportTimestamp: bigint,
  nowSeconds: number,
): number {
  if (stakedPrincipal === 0n) return 0;
  const elapsed = nowSeconds - Number(reportTimestamp);
  if (elapsed < 3600) return 0;
  const secondsPerYear = 365.25 * 24 * 3600;
  const rewardRatio = Number(grossRewards) / Number(stakedPrincipal);
  return rewardRatio * (secondsPerYear / elapsed) * 100;
}

/**
 * Key queue health: keyQueueLength / attesterCount.
 * Returns 0 if attesterCount is zero.
 */
export function keyQueueToAttesterRatio(keyQueueLength: bigint, attesterCount: bigint): number {
  if (attesterCount === 0n) return 0;
  return Number(keyQueueLength) / Number(attesterCount);
}
