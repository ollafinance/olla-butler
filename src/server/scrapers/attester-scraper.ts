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
        // Publish an empty snapshot so prior counts (e.g. exiting=3 after a
        // batch refresh removed all tracked attesters) don't stick in metrics
        // and so lastUpdated keeps advancing for the data-staleness alert.
        const activationThreshold = await this.protocolClient.scrapeActivationThreshold();
        const stakingData = getStakingData(this.network);
        const empty = computeAttesterData(
          [],
          activationThreshold,
          stakingData?.stakingState.stakedAmount,
          new Map(),
        );
        updateAttesterData(this.network, empty);
        console.log(`[${this.name}/${this.network}] No attesters tracked`);
        return;
      }

      const [attesters, activationThreshold, internalStatuses] = await Promise.all([
        this.protocolClient.scrapeAttesterStates(attesterAddresses),
        this.protocolClient.scrapeActivationThreshold(),
        this.protocolClient.scrapeAttesterInternalStatuses(attesterAddresses),
      ]);

      const stakingData = getStakingData(this.network);
      const data = computeAttesterData(
        attesters,
        activationThreshold,
        stakingData?.stakingState.stakedAmount,
        internalStatuses,
      );
      updateAttesterData(this.network, data);

      const staleCount = data.staleAttesters.length;
      const slashedAttesters = data.staleAttesters.filter(
        (s) => s.slashingLoss > 0n,
      );

      console.log(
        `[${this.name}/${this.network}] Attesters: ${attesters.length} | ` +
        `Active: ${data.rollupActiveCount} | ` +
        `Queued: ${data.rollupQueuedCount} | ` +
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
 * Computes aggregate attester data and staleness detection.
 *
 * Compares rollup state (source of truth for on-chain status) against
 * StakingManager internal state (per-attester status from storage) to detect
 * attesters that need a refreshAttesterState() call.
 *
 * Staleness reasons:
 *  - zombie:              Rollup status is ZOMBIE (slashed and ejected)
 *  - slashing:            VALIDATING but effectiveBalance < activationThreshold
 *  - exit_undetected:     VALIDATING but rollup has an exit — Olla may not know
 *  - exit_exitable:       Exit delay has passed, ready to finalize
 *  - fully_exited:        NONE on rollup, no balance, no exit — attester is gone
 *  - queued:              NONE on rollup, but StakingManager has it staked — waiting for entry queue flush
 *  - activation_pending:  VALIDATING on rollup, but StakingManager still considers it Queued — needs refresh
 */
export function computeAttesterData(
  attesters: AttesterState[],
  activationThreshold: bigint,
  cachedStakedAmount?: bigint,
  internalStatuses?: Map<string, number>,
): AttesterData {
  let rollupTotalEffectiveBalance = 0n;
  let rollupActiveCount = 0;
  let rollupExitingCount = 0;
  let rollupZombieCount = 0;
  let rollupQueuedCount = 0;
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

    const reasons: AttesterStalenessReason[] = [];
    let slashingLoss = 0n;

    // ── Rollup-derived staleness ──

    if (attester.status === AztecAttesterStatus.ZOMBIE) {
      reasons.push("zombie");
      slashingLoss = attester.effectiveBalance < activationThreshold
        ? activationThreshold - attester.effectiveBalance
        : 0n;
    }

    if (
      attester.status === AztecAttesterStatus.VALIDATING &&
      attester.effectiveBalance < activationThreshold &&
      !attester.exit.exists
    ) {
      reasons.push("slashing");
      slashingLoss = activationThreshold - attester.effectiveBalance;
    }

    if (
      attester.status === AztecAttesterStatus.VALIDATING &&
      attester.exit.exists
    ) {
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
      reasons.push("fully_exited");
    }

    // ── StakingManager-derived staleness ──

    if (internalStatuses) {
      const internalStatus = internalStatuses.get(attester.address);

      // Queued in StakingManager but VALIDATING on rollup → needs refresh to promote
      if (
        internalStatus === InternalAttesterStatus.Queued &&
        attester.status === AztecAttesterStatus.VALIDATING
      ) {
        reasons.push("activation_pending");
      }

      // Queued in StakingManager and NONE on rollup → waiting for entry queue flush
      if (
        internalStatus === InternalAttesterStatus.Queued &&
        attester.status === AztecAttesterStatus.NONE
      ) {
        // Replace fully_exited with queued — this attester isn't gone, it's waiting
        const idx = reasons.indexOf("fully_exited");
        if (idx !== -1) {
          reasons[idx] = "queued";
        } else {
          reasons.push("queued");
        }
        rollupQueuedCount++;
      }
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

  return {
    attesters,
    rollupTotalEffectiveBalance,
    rollupActiveCount,
    rollupExitingCount,
    rollupZombieCount,
    rollupQueuedCount,
    activationThreshold,
    cachedVsRollupBalanceDrift,
    staleAttesters,
    exitableAttesterCount,
    lastUpdated: new Date(),
  };
}

/** StakingManager InternalAttesterStatus enum values (from contract storage) */
const InternalAttesterStatus = {
  Inactive: 0,
  Queued: 1,
  Active: 2,
  Exiting: 3,
} as const;

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}
