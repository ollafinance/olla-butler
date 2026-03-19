/**
 * Accounting Update Task
 *
 * Periodically calls OllaCore.updateAccounting() when it hasn't been called recently.
 * Skips if accounting was updated within the staleness threshold (default: 4 hours).
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getCoreData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

/** Accounting staleness threshold: 4 hours in seconds */
const ACCOUNTING_STALENESS_THRESHOLD_S = 4 * 60 * 60;

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

  async scrape(): Promise<void> {
    const coreData = getCoreData(this.network);
    if (!coreData) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const lastReportTimestamp = Number(coreData.latestReport.timestamp);
    const staleness = now - lastReportTimestamp;

    if (staleness < ACCOUNTING_STALENESS_THRESHOLD_S) {
      return;
    }

    // Also check our own last execution to avoid double-sending during confirmation delay
    const timeSinceLastExecution = Date.now() - this.lastExecutionTime;
    if (timeSinceLastExecution < ACCOUNTING_STALENESS_THRESHOLD_S * 1000) {
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
