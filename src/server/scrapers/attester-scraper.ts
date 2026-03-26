import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateAttesterData } from "../state/index.js";
import { getStakingData } from "../state/index.js";
import { getAttesters } from "../state/attester-registry.js";
import { pushEvent } from "../state/event-log.js";
import { pushGovernanceEvent } from "../state/governance-log.js";
import {
  AztecAttesterStatus,
  type AttesterData,
  type AttesterState,
  type StaleAttester,
  type AttesterStalenessReason,
} from "../../types/index.js";
import { formatEther } from "viem";

/**
 * Scrapes Aztec rollup attester state for all known attesters.
 * Compares rollup state (source of truth) against Olla's cached state
 * to detect drift, slashing, and stale attesters needing refresh.
 */
export class AttesterScraper extends AbstractScraper {
  readonly name = "attester";
  readonly network: string;

  constructor(
    network: string,
    private protocolClient: OllaProtocolClient,
  ) {
    super();
    this.network = network;
  }

  async scrape(): Promise<void> {
    try {
      // Refresh canonical rollup in case of upgrade
      const rollupChange = await this.protocolClient.refreshCanonicalRollup();
      if (rollupChange) {
        const now = new Date();
        // Emit as regular event (externally triggered, belongs in main log)
        pushEvent(this.network, {
          eventName: "CanonicalRollupUpgraded",
          contract: "RollupRegistry",
          blockNumber: 0n, // detected via polling, no specific block
          transactionHash: "",
          timestamp: now,
          args: {
            oldRollup: rollupChange.oldAddress,
            newRollup: rollupChange.newAddress,
          },
        });
        // Also emit as governance event for the governance log
        pushGovernanceEvent(this.network, {
          eventName: "CanonicalRollupUpgraded",
          contract: "RollupRegistry",
          blockNumber: 0n,
          transactionHash: "",
          timestamp: now,
          parameter: "canonicalRollup",
          oldValue: rollupChange.oldAddress,
          newValue: rollupChange.newAddress,
          category: "rollup_upgrade",
        });
        console.warn(
          `[${this.name}/${this.network}] ROLLUP UPGRADE: ${rollupChange.oldAddress} → ${rollupChange.newAddress}`,
        );
      }

      const attesterAddresses = getAttesters(this.network);
      if (attesterAddresses.length === 0) {
        console.log(`[${this.name}/${this.network}] No attesters tracked`);
        return;
      }

      const [attesters, activationThreshold] = await Promise.all([
        this.protocolClient.scrapeAttesterStates(attesterAddresses),
        this.protocolClient.scrapeActivationThreshold(),
      ]);

      const stakingData = getStakingData(this.network);
      const data = computeAttesterData(attesters, activationThreshold, stakingData?.stakingState.stakedAmount);
      updateAttesterData(this.network, data);

      const staleCount = data.staleAttesters.length;
      const slashedAttesters = data.staleAttesters.filter(
        (s) => s.slashingLoss > 0n,
      );

      console.log(
        `[${this.name}/${this.network}] Attesters: ${attesters.length} | ` +
        `Active: ${data.rollupActiveCount} | ` +
        `Exiting: ${data.rollupExitingCount} | ` +
        `Zombie: ${data.rollupZombieCount} | ` +
        `Exitable: ${data.exitableAttesterCount} | ` +
        `Stale: ${staleCount} | ` +
        `RollupBalance: ${formatEther(data.rollupTotalEffectiveBalance)} | ` +
        `Drift: ${formatEther(data.cachedVsRollupBalanceDrift)}`,
      );

      if (slashedAttesters.length > 0) {
        for (const sa of slashedAttesters) {
          console.warn(
            `[${this.name}/${this.network}] WARNING: Attester ${sa.address} slashing loss: ${formatEther(sa.slashingLoss)}`,
          );
        }
      }

      if (data.exitableAttesterCount > 0) {
        console.warn(
          `[${this.name}/${this.network}] WARNING: ${data.exitableAttesterCount} attester(s) have exitable exits pending finalization`,
        );
      }
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}

/**
 * Computes aggregate attester data and staleness detection from rollup state.
 */
export function computeAttesterData(
  attesters: AttesterState[],
  activationThreshold: bigint,
  cachedStakedAmount?: bigint,
): AttesterData {
  let rollupTotalEffectiveBalance = 0n;
  let rollupActiveCount = 0;
  let rollupExitingCount = 0;
  let rollupZombieCount = 0;
  let exitableAttesterCount = 0;
  const staleAttesters: StaleAttester[] = [];

  for (const attester of attesters) {
    rollupTotalEffectiveBalance += attester.effectiveBalance;

    switch (attester.status) {
      case AztecAttesterStatus.VALIDATING:
        rollupActiveCount++;
        break;
      case AztecAttesterStatus.EXITING:
        rollupExitingCount++;
        break;
      case AztecAttesterStatus.ZOMBIE:
        rollupZombieCount++;
        break;
    }

    if (attester.exit.isExitable) {
      exitableAttesterCount++;
    }

    // Detect staleness reasons
    const reasons: AttesterStalenessReason[] = [];
    let slashingLoss = 0n;

    if (attester.status === AztecAttesterStatus.ZOMBIE) {
      reasons.push("zombie");
      // Zombie with remaining balance: loss = threshold - effectiveBalance
      slashingLoss = attester.effectiveBalance < activationThreshold
        ? activationThreshold - attester.effectiveBalance
        : 0n;
    }

    if (
      attester.status === AztecAttesterStatus.VALIDATING &&
      attester.effectiveBalance < activationThreshold &&
      !attester.exit.exists
    ) {
      // Partial slashing: balance reduced below threshold, not exiting
      reasons.push("slashing");
      slashingLoss = activationThreshold - attester.effectiveBalance;
    }

    if (
      attester.status === AztecAttesterStatus.VALIDATING &&
      attester.exit.exists
    ) {
      // Rollup has exit, but Olla may not know about it
      reasons.push("exit_undetected");
    }

    if (attester.exit.isExitable) {
      reasons.push("exit_exitable");
    }

    if (
      attester.status === AztecAttesterStatus.NONE &&
      attester.effectiveBalance === 0n &&
      !attester.exit.exists
    ) {
      // Attester is NONE on rollup but still in our registry — tagged after loop
      reasons.push("fully_exited");
    }

    if (reasons.length > 0) {
      staleAttesters.push({
        address: attester.address,
        reasons,
        slashingLoss,
      });
    }
  }

  const cachedVsRollupBalanceDrift = cachedStakedAmount !== undefined
    ? absDiff(cachedStakedAmount, rollupTotalEffectiveBalance)
    : 0n;

  // Reclassify fully_exited → pending_activation when Olla has more staked than rollup shows
  if (cachedStakedAmount !== undefined && cachedStakedAmount > rollupTotalEffectiveBalance) {
    for (const stale of staleAttesters) {
      const idx = stale.reasons.indexOf("fully_exited");
      if (idx !== -1) {
        stale.reasons[idx] = "pending_activation";
      }
    }
  }

  return {
    attesters,
    rollupTotalEffectiveBalance,
    rollupActiveCount,
    rollupExitingCount,
    rollupZombieCount,
    activationThreshold,
    cachedVsRollupBalanceDrift,
    staleAttesters,
    exitableAttesterCount,
    lastUpdated: new Date(),
  };
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}
