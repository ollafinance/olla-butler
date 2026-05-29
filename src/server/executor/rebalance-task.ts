/**
 * Rebalance Task
 *
 * Calls OllaCore.rebalance() periodically. The contract enforces its own cooldown
 * via _lastRebalanceTimestamp — the butler simply attempts to call rebalance() and
 * handles expected reverts (cooldown, in-progress) gracefully.
 *
 * Rebalance is a multi-step process (Harvest → PullUnstaked → FinalizeWithdrawals →
 * InitiateUnstake → StakeSurplus → Done). The task calls rebalance() repeatedly
 * until the step reaches Done or an error occurs.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import {
  getCoreData,
  getVaultData,
  getStakingData,
  getAttesterData,
  getEventData,
  getSafetyModuleData,
} from "../state/index.js";
import { RebalanceStep, RebalanceStepNames, type CoreData } from "../../types/index.js";
import type { TransactionExecutor } from "./tx-executor.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";

/** Maximum steps to execute in a single run to prevent infinite loops */
const MAX_STEPS_PER_RUN = 10;

/** Minimum pending rewards (claimable + accumulator) that justifies a standalone harvest, in wei (10k tokens). */
const PENDING_REWARDS_THRESHOLD_WEI = 10_000n * 10n ** 18n;

/** Safety net — force a rebalance after this long even when no work signal triggers, to guard against missed signals. */
const FORCED_REBALANCE_INTERVAL_S = 48 * 60 * 60;

/**
 * Safety margin subtracted from on-chain maxAccountingDelay to decide when accounting is
 * "stale enough" that we should defer rebalancing until accounting is refreshed. Mirrors
 * AccountingUpdateTask's threshold so the two tasks agree on the boundary: once accounting
 * is stale enough for the accounting task to act, the rebalance task steps aside and lets it
 * go first (a rebalance can itself touch checkAccountingLiveness and trip the breaker).
 * Kept in sync with AccountingUpdateTask.SAFETY_MARGIN_S (2 hours).
 */
const ACCOUNTING_STALE_SAFETY_MARGIN_S = 2 * 60 * 60;

/** Fallback accounting staleness threshold when on-chain maxAccountingDelay is unavailable: 1 hour. */
const ACCOUNTING_STALE_FALLBACK_S = 60 * 60;

/** Known reverts that are expected operational conditions, not errors */
const KNOWN_REVERT_NAMES = new Set([
  "OllaCore__RebalanceInProgress",
  "OllaCore__RebalanceCooldownActive",
  "Rollup__RewardsNotClaimable",
]);

const KNOWN_REVERT_SIGNATURES: Record<string, string> = {
  "0x89d1a898": "RebalanceInProgress",
  "0x3712a06d": "RebalanceCooldownActive",
  "0xe8b9b951": "RewardsNotClaimable",
};

function getKnownRevertReason(error: unknown): string | undefined {
  if (error && typeof error === "object" && "cause" in error) {
    const cause = error.cause as { signature?: string; data?: { errorName?: string } };
    // Check decoded error name first (when ABI includes the error definition)
    if (cause?.data?.errorName && KNOWN_REVERT_NAMES.has(cause.data.errorName)) {
      return cause.data.errorName;
    }
    // Fallback to raw signature matching
    if (cause?.signature && cause.signature in KNOWN_REVERT_SIGNATURES) {
      return KNOWN_REVERT_SIGNATURES[cause.signature];
    }
  }
  return undefined;
}

export class RebalanceTask extends AbstractScraper {
  readonly name = "tx-rebalance";
  readonly network: string;

  private readonly executor: TransactionExecutor;
  private readonly protocolClient: OllaProtocolClient;
  private isRunning = false;

  constructor(network: string, executor: TransactionExecutor, protocolClient: OllaProtocolClient) {
    super();
    this.network = network;
    this.executor = executor;
    this.protocolClient = protocolClient;
  }

  async scrape(): Promise<void> {
    // Prevent concurrent runs (rebalance is multi-step and can take a while)
    if (this.isRunning) {
      return;
    }

    const coreData = getCoreData(this.network);
    if (!coreData) {
      return;
    }

    // Mid-cycle: always continue executing, the work was already committed on-chain.
    // Only the start-of-cycle case is subject to the cooldown + work-availability gates.
    const step = coreData.rebalanceProgress.step;
    if (step === RebalanceStep.Done && !this.shouldStartNewCycle(coreData)) {
      return;
    }

    this.isRunning = true;
    try {
      await this.executeRebalanceSteps(step);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Decide whether to kick off a new rebalance cycle (step === Done).
   * Gates, in order:
   *   0a. Paused — never start a new cycle while the SafetyModule circuit breaker is engaged.
   *   0b. Accounting stale — defer to the accounting task; let updateAccounting() land first.
   *   1. On-chain cooldown — skip if the contract would revert anyway.
   *   2. Forced fallback — past FORCED_REBALANCE_INTERVAL_S, run regardless of work to guard against missed signals.
   *   3. Work predicate — only run if at least one meaningful action is queued:
   *        - finalized unstakes ready to pull
   *        - pending withdrawals to finalize/back with an unstake
   *        - buffer (possibly after harvest) is large enough to fund another attester
   *        - pending rewards have grown past PENDING_REWARDS_THRESHOLD_WEI
   * If supporting state is incomplete (vault/staking/attester not yet scraped), default to running.
   */
  private shouldStartNewCycle(coreData: CoreData): boolean {
    const safetyData = getSafetyModuleData(this.network);

    // Gate 0a: don't start a new cycle while paused. The breaker is engaged; a rebalance
    // would either revert or be inappropriate until the underlying condition is resolved.
    if (safetyData?.isPaused) {
      console.log(`[${this.name}/${this.network}] Skipping — SafetyModule is paused`);
      return false;
    }

    // Gate 0b: if accounting is stale enough that the accounting task wants to update it,
    // step aside so updateAccounting() runs first. This both enforces ordering and avoids
    // a forced rebalance becoming a second path that trips the AccountingStale breaker.
    const accountingThreshold =
      safetyData && safetyData.maxAccountingDelay > 0n
        ? Math.max(
            Number(safetyData.maxAccountingDelay) - ACCOUNTING_STALE_SAFETY_MARGIN_S,
            Math.floor(Number(safetyData.maxAccountingDelay) / 2),
          )
        : ACCOUNTING_STALE_FALLBACK_S;
    const accountingStaleness =
      Math.floor(Date.now() / 1000) - Number(coreData.latestReport.timestamp);
    if (accountingStaleness >= accountingThreshold) {
      console.log(
        `[${this.name}/${this.network}] Skipping — accounting stale ` +
          `(${Math.floor(accountingStaleness / 3600)}h ${Math.floor((accountingStaleness % 3600) / 60)}m, ` +
          `threshold ${Math.floor(accountingThreshold / 3600)}h) — deferring to accounting update`,
      );
      return false;
    }

    const eventData = getEventData(this.network);

    if (eventData?.lastRebalanceTimestamp) {
      const lastRebalanceS = Math.floor(eventData.lastRebalanceTimestamp.getTime() / 1000);
      const elapsed = Math.floor(Date.now() / 1000) - lastRebalanceS;

      if (elapsed < coreData.rebalanceCooldown) {
        const remaining = coreData.rebalanceCooldown - elapsed;
        console.log(
          `[${this.name}/${this.network}] Skipping — cooldown active (${remaining}s remaining)`,
        );
        return false;
      }

      if (elapsed >= FORCED_REBALANCE_INTERVAL_S) {
        console.log(
          `[${this.name}/${this.network}] Forcing rebalance — last completion was ${Math.floor(elapsed / 3600)}h ago`,
        );
        return true;
      }
    }

    const vaultData = getVaultData(this.network);
    const stakingData = getStakingData(this.network);
    const attesterData = getAttesterData(this.network);

    if (!vaultData || !stakingData || !attesterData) {
      console.log(
        `[${this.name}/${this.network}] Proceeding — incomplete state (vault=${!!vaultData}, staking=${!!stakingData}, attester=${!!attesterData})`,
      );
      return true;
    }

    const { claimableRewards, rewardsAccumulatorBalance } = coreData.accountingState;
    const { bufferedAssets, pendingWithdrawalAssets } = vaultData;
    const { hasFinalizedUnstakes } = stakingData;
    const { activationThreshold } = attesterData;

    const pendingRewards = claimableRewards + rewardsAccumulatorBalance;
    const reasons: string[] = [];

    if (hasFinalizedUnstakes) reasons.push("finalized-unstakes");
    if (pendingWithdrawalAssets > 0n) reasons.push("pending-withdrawals");
    if (activationThreshold > 0n && bufferedAssets + pendingRewards >= activationThreshold) {
      reasons.push("can-stake-attester");
    }
    if (pendingRewards >= PENDING_REWARDS_THRESHOLD_WEI) reasons.push("pending-rewards-large");

    if (reasons.length === 0) {
      console.log(
        `[${this.name}/${this.network}] Skipping — no work ` +
          `(buffer=${this.fmt(bufferedAssets)}, pendingRewards=${this.fmt(pendingRewards)}, ` +
          `pendingWithdrawals=${this.fmt(pendingWithdrawalAssets)}, ` +
          `activationThreshold=${this.fmt(activationThreshold)})`,
      );
      return false;
    }

    console.log(
      `[${this.name}/${this.network}] Proceeding — work signals: [${reasons.join(", ")}]`,
    );
    return true;
  }

  /** Format a wei-denominated bigint as a 2-decimal token string (display only). */
  private fmt(wei: bigint): string {
    return (Number(wei) / 1e18).toFixed(2);
  }

  private async executeRebalanceSteps(currentStep: RebalanceStep): Promise<void> {
    let step = currentStep;
    let stepsExecuted = 0;

    // If step is Done, call rebalance() once to kick off a new cycle.
    // The contract enforces cooldown — if it hasn't elapsed, this will revert
    // with RebalanceCooldownActive and we'll try again next poll.
    if (step === RebalanceStep.Done) {
      try {
        await this.executor.rebalance();
        stepsExecuted++;
        const freshCoreData = await this.protocolClient.scrapeCoreData();
        step = freshCoreData.rebalanceProgress.step;
        if (step === RebalanceStep.Done) {
          console.log(
            `[${this.name}/${this.network}] Rebalance cycle completed immediately (nothing to do)`,
          );
          return;
        }
        console.log(
          `[${this.name}/${this.network}] New rebalance cycle started, now at step: ${RebalanceStepNames[step]}`,
        );
      } catch (error) {
        const reason = getKnownRevertReason(error);
        if (reason === "RebalanceInProgress" || reason === "OllaCore__RebalanceInProgress") {
          // Cached state said Done but on-chain is mid-cycle — re-read and continue
          console.log(
            `[${this.name}/${this.network}] Rebalance already in progress, reading current step from chain...`,
          );
          const freshCoreData = await this.protocolClient.scrapeCoreData();
          step = freshCoreData.rebalanceProgress.step;
          if (step === RebalanceStep.Done) {
            console.log(
              `[${this.name}/${this.network}] On-chain step is Done, will retry next poll`,
            );
            return;
          }
          // Fall through to the while loop to continue from the actual step
        } else if (reason) {
          console.log(
            `[${this.name}/${this.network}] Rebalance not ready: ${reason}`,
          );
          return;
        } else {
          console.error(
            `[${this.name}/${this.network}] Failed to initiate rebalance cycle:`,
            error,
          );
          return;
        }
      }
    }

    console.log(
      `[${this.name}/${this.network}] Starting rebalance from step: ${RebalanceStepNames[step]}`,
    );

    while (step !== RebalanceStep.Done && stepsExecuted < MAX_STEPS_PER_RUN) {
      try {
        console.log(
          `[${this.name}/${this.network}] Executing rebalance step ${stepsExecuted + 1}: ${RebalanceStepNames[step]}`,
        );
        await this.executor.rebalance();
        stepsExecuted++;

        // Read new step directly from chain (don't rely on scraper timing)
        const freshCoreData = await this.protocolClient.scrapeCoreData();
        const newStep = freshCoreData.rebalanceProgress.step;

        if (newStep === step) {
          console.warn(
            `[${this.name}/${this.network}] Rebalance step didn't advance (still ${RebalanceStepNames[step]}), stopping`,
          );
          break;
        }

        step = newStep;
      } catch (error) {
        console.error(
          `[${this.name}/${this.network}] Rebalance step failed at ${RebalanceStepNames[step]}:`,
          error,
        );
        break;
      }
    }

    if (step === RebalanceStep.Done) {
      console.log(
        `[${this.name}/${this.network}] Rebalance completed in ${stepsExecuted} step(s)`,
      );
    } else {
      console.log(
        `[${this.name}/${this.network}] Rebalance paused at step: ${RebalanceStepNames[step]} after ${stepsExecuted} step(s)`,
      );
    }
  }
}
