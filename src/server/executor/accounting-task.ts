/**
 * Accounting Update Task
 *
 * Periodically calls OllaCore.updateAccounting() when it hasn't been called recently.
 * Uses the on-chain maxAccountingDelay from the SafetyModule as the staleness threshold,
 * subtracting a safety margin to ensure we update well before the circuit breaker fires.
 * Falls back to 1 hour if on-chain value is unavailable.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getCoreData, getSafetyModuleData } from "../state/index.js";
import { RebalanceStep } from "../../types/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

/** Safety margin subtracted from on-chain maxAccountingDelay: 15 minutes */
const SAFETY_MARGIN_S = 15 * 60;

/** Fallback staleness threshold when on-chain value is unavailable: 1 hour */
const FALLBACK_STALENESS_THRESHOLD_S = 60 * 60;

export class AccountingUpdateTask extends AbstractScraper {
  readonly name = "tx-accounting-update";
  readonly network: string;

  private readonly executor: TransactionExecutor;
  private lastExecutionTime = 0;

  constructor(network: string, executor: TransactionExecutor) {
    super();
    this.network = network;
    this.executor = executor;
  }

  /**
   * Returns the staleness threshold in seconds.
   * Uses on-chain maxAccountingDelay minus a 15-minute safety margin.
   * E.g. if maxAccountingDelay = 7200s (2h), we trigger at 6300s (1h45m).
   * Falls back to FALLBACK_STALENESS_THRESHOLD_S if on-chain value is unavailable.
   */
  private getStalenessThreshold(): number {
    const safetyData = getSafetyModuleData(this.network);
    if (safetyData && safetyData.maxAccountingDelay > 0n) {
      const onChainDelay = Number(safetyData.maxAccountingDelay);
      return Math.max(onChainDelay - SAFETY_MARGIN_S, Math.floor(onChainDelay / 2));
    }
    return FALLBACK_STALENESS_THRESHOLD_S;
  }

  async scrape(): Promise<void> {
    const coreData = getCoreData(this.network);
    if (!coreData) {
      return;
    }

    // Skip if a rebalance is in progress — the contract reverts updateAccounting() during rebalance
    if (coreData.rebalanceProgress.step !== RebalanceStep.Done) {
      return;
    }

    const threshold = this.getStalenessThreshold();
    const now = Math.floor(Date.now() / 1000);
    const lastReportTimestamp = Number(coreData.latestReport.timestamp);
    const staleness = now - lastReportTimestamp;

    if (staleness < threshold) {
      return;
    }

    // Also check our own last execution to avoid double-sending during confirmation delay
    const timeSinceLastExecution = Date.now() - this.lastExecutionTime;
    if (timeSinceLastExecution < threshold * 1000) {
      console.log(
        `[${this.name}/${this.network}] Skipping — already sent updateAccounting ${Math.floor(timeSinceLastExecution / 60_000)}m ago`,
      );
      return;
    }

    try {
      console.log(
        `[${this.name}/${this.network}] Accounting is stale (${Math.floor(staleness / 3600)}h ${Math.floor((staleness % 3600) / 60)}m). Calling updateAccounting()...`,
      );
      await this.executor.updateAccounting();
      this.lastExecutionTime = Date.now();
      console.log(`[${this.name}/${this.network}] updateAccounting() executed successfully`);
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Failed to execute updateAccounting():`, error);
    }
  }
}
