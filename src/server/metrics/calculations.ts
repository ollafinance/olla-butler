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
 * Check if rebalance is overdue: cooldown elapsed since the last completed
 * Rebalanced event AND a rebalance is currently in progress (step != Done).
 *
 * `lastRebalanceTimestamp` is the on-chain time of the last `Rebalanced`
 * event (i.e. last successful completion). The accounting-report timestamp
 * is NOT a substitute — it advances on every accounting update, including
 * those not tied to a rebalance, and would mask stuck rebalances.
 */
export function isRebalanceOverdue(
  lastRebalanceTimestamp: bigint,
  cooldownSeconds: number,
  step: RebalanceStep,
): boolean {
  if (step === RebalanceStep.Done) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const elapsed = nowSeconds - Number(lastRebalanceTimestamp);
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
 * Capital efficiency: deployed / deployable capital, in percent.
 *
 * Numerator is the staked principal (productive). Denominator is the pool the
 * rebalancer directly addresses:
 *   - staked principal       (deployed and earning)
 *   - buffered assets        (idle in the vault, awaiting stake)
 *   - rewardsAccumulator     (idle yield, awaiting harvest+restake)
 *   - claimableRewards       (idle yield at the staking layer, awaiting pull)
 *
 * Pending withdrawals, pending unstakes and other in-flight balances are
 * excluded — they aren't under operational control between rebalances.
 *
 * Bounded [0, 100] by construction since the numerator is an addend of the
 * denominator. Returns 0 when the deployable pool is empty.
 */
export function capitalEfficiencyPct(
  stakedPrincipal: bigint,
  bufferedAssets: bigint,
  rewardsAccumulatorBalance: bigint,
  claimableRewards: bigint,
): number {
  const deployable =
    stakedPrincipal + bufferedAssets + rewardsAccumulatorBalance + claimableRewards;
  if (deployable === 0n) return 0;
  return Number((stakedPrincipal * 10000n) / deployable) / 100;
}

/**
 * Annualized yield percentage from a closed accounting period.
 * `grossRewards` is the rewards accrued over `periodSeconds` (the duration of
 * the report period that just closed), so APR = (grossRewards / principal) *
 * (year / periodSeconds). Returns 0 if principal is zero or the period is
 * too short to be informative (< 1 hour).
 */
export function rewardsAprPct(
  grossRewards: bigint,
  stakedPrincipal: bigint,
  periodSeconds: number,
): number {
  if (stakedPrincipal === 0n) return 0;
  if (periodSeconds < 3600) return 0;
  const secondsPerYear = 365.25 * 24 * 3600;
  const rewardRatio = Number(grossRewards) / Number(stakedPrincipal);
  return rewardRatio * (secondsPerYear / periodSeconds) * 100;
}

/**
 * Key queue health: keyQueueLength / attesterCount.
 * Returns 0 if attesterCount is zero.
 */
export function keyQueueToAttesterRatio(keyQueueLength: bigint, attesterCount: bigint): number {
  if (attesterCount === 0n) return 0;
  return Number(keyQueueLength) / Number(attesterCount);
}
