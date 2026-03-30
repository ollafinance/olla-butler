/**
 * Executor Balance Scraper
 *
 * Periodically polls the native (ETH) balance of the butler executor address.
 * Exposes the balance via state for Prometheus metrics.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { updateExecutorData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

export class ExecutorBalanceScraper extends AbstractScraper {
  readonly name = "executor-balance";
  readonly network: string;

  private readonly executor: TransactionExecutor;

  constructor(network: string, executor: TransactionExecutor) {
    super();
    this.network = network;
    this.executor = executor;
  }

  async scrape(): Promise<void> {
    try {
      const balance = await this.executor.getBalance();
      updateExecutorData(this.network, {
        address: this.executor.getExecutorAddress(),
        balance,
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error(
        `[${this.name}/${this.network}] Failed to fetch executor balance:`,
        error,
      );
    }
  }
}
