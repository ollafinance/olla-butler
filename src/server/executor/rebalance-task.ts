/**
 * Rebalance Task
 *
 * Calls OllaCore.rebalance() daily, respecting the on-chain rebalance cooldown.
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

    // Check if rebalance is already done and cooldown hasn't elapsed
    const now = Date.now();
    if (coreData.rebalanceProgress.step === RebalanceStep.Done) {
      // Check on-chain cooldown
      const lastReportTimestamp = Number(coreData.latestReport.timestamp) * 1000;
      const cooldownMs = coreData.rebalanceCooldown * 1000;
      const cooldownElapsed = now - lastReportTimestamp >= cooldownMs;

      if (!cooldownElapsed) {
        return;
      }
    }

    // If step is not Done, we have an in-progress rebalance — continue it
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
