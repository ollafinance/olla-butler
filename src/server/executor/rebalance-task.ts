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
import { getCoreData } from "../state/index.js";
import { RebalanceStep, RebalanceStepNames } from "../../types/index.js";
import type { TransactionExecutor } from "./tx-executor.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";

/** Maximum steps to execute in a single run to prevent infinite loops */
const MAX_STEPS_PER_RUN = 10;

/** Known revert signatures that are expected operational conditions, not errors */
const KNOWN_REVERT_SIGNATURES: Record<string, string> = {
  "0xe8b9b951": "RebalanceInProgress",
  "0x4c55e7e4": "RebalanceCooldownActive",
};

function getKnownRevertReason(error: unknown): string | undefined {
  if (error && typeof error === "object" && "cause" in error) {
    const cause = error.cause as { signature?: string };
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

    this.isRunning = true;
    try {
      await this.executeRebalanceSteps(coreData.rebalanceProgress.step);
    } finally {
      this.isRunning = false;
    }
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
        if (reason === "RebalanceInProgress") {
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
