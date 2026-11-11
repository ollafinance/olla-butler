/**
 * Exit readiness.
 *
 * An Aztec exit has two independent locks:
 *   1. The rollup's own exit delay (`exit.exitableAt`).
 *   2. The governance withdrawal lock (`withdrawal.unlocksAt`), created when the
 *      GSE withdraws the stake and paid out by `Governance.finalizeWithdraw`.
 *
 * Olla's StakingManager only finalizes an exit once BOTH have elapsed (see
 * `StakingManager._isExitFinalizable`). The butler must use the same predicate:
 * if it only checks `exitableAt`, it will keep calling `refreshAttesterState`
 * every cooldown window while the governance lock is still pending, even though
 * each call is a no-op.
 */

/** Governance `Withdrawal` record as returned by `getWithdrawal(uint256)`. */
export interface GovernanceWithdrawal {
  amount: bigint;
  unlocksAt: bigint;
  recipient: string;
  claimed: boolean;
}

export interface ExitReadinessInput {
  exists: boolean;
  exitableAt: bigint;
  isRecipient: boolean;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Returns true when a `refreshAttesterState` call can make progress on an exit.
 *
 * Mirrors StakingManager._isExitFinalizable for exits that already name a
 * recipient. For slashing-induced exits that still point at the withdrawer
 * (`isRecipient === false`), a refresh is useful as soon as the rollup delay has
 * elapsed because StakingManager first calls `initiateWithdraw` to claim it.
 */
export function isExitFinalizable(args: {
  exit: ExitReadinessInput;
  withdrawal: GovernanceWithdrawal | undefined;
  nowSeconds: bigint;
}): boolean {
  const { exit, withdrawal, nowSeconds } = args;

  if (!exit.exists) {
    return false;
  }
  if (exit.exitableAt > nowSeconds) {
    return false;
  }

  // Slashing exit still owned by the withdrawer; refresh claims it by calling
  // initiateWithdraw. Finalization (a later refresh) still waits on governance.
  if (!exit.isRecipient) {
    return true;
  }

  if (!withdrawal) {
    return false;
  }
  if (withdrawal.claimed) {
    return true;
  }

  return (
    withdrawal.recipient.toLowerCase() !== ZERO_ADDRESS &&
    withdrawal.unlocksAt <= nowSeconds
  );
}
