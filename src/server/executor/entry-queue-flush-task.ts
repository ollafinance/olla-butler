/**
 * Entry Queue Flush Task
 *
 * Monitors for queued attesters (staked in Olla but not yet active on rollup).
 * When queued attesters are detected and the rollup epoch allows it,
 * calls flushEntryQueue() on the canonical rollup to process them into the active set.
 *
 * The rollup only allows one flush per epoch (~86 minutes on sepolia).
 * This task checks the epoch constraint before attempting a flush.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getAttesterData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";

export class EntryQueueFlushTask extends AbstractScraper {
  readonly name = "tx-entry-queue-flush";
  readonly network: string;

  private readonly executor: TransactionExecutor;
  private readonly protocolClient: OllaProtocolClient;
  /** Tracks which queued attesters we've already flushed for — reset when the set changes */
  private flushedForAddresses = new Set<string>();

  constructor(network: string, executor: TransactionExecutor, protocolClient: OllaProtocolClient) {
    super();
    this.network = network;
    this.executor = executor;
    this.protocolClient = protocolClient;
  }

  async scrape(): Promise<void> {
    const attesterData = getAttesterData(this.network);
    if (!attesterData || attesterData.rollupQueuedCount === 0) {
      this.flushedForAddresses.clear();
      return;
    }

    // Get current set of queued attester addresses
    const queuedAddresses = new Set(
      attesterData.staleAttesters
        .filter((s) => s.reasons.includes("queued"))
        .map((s) => s.address),
    );

    if (queuedAddresses.size === 0) {
      this.flushedForAddresses.clear();
      return;
    }

    // Check if there are NEW queued attesters we haven't flushed for yet
    const hasNew = [...queuedAddresses].some((addr) => !this.flushedForAddresses.has(addr));
    if (!hasNew) {
      return;
    }

    // Check if the rollup allows flushing this epoch
    try {
      const canFlush = await this.protocolClient.canFlushEntryQueue();
      if (!canFlush) {
        console.log(
          `[${this.name}/${this.network}] ${queuedAddresses.size} attester(s) queued but flush not available yet (epoch constraint)`,
        );
        return;
      }
    } catch (error) {
      console.error(
        `[${this.name}/${this.network}] Failed to check epoch flush eligibility:`,
        error,
      );
      return;
    }

    try {
      console.log(
        `[${this.name}/${this.network}] ${queuedAddresses.size} attester(s) in entry queue — flushing...`,
      );
      await this.executor.flushEntryQueue();

      // Mark all current queued attesters as flushed
      for (const addr of queuedAddresses) {
        this.flushedForAddresses.add(addr);
      }

      console.log(
        `[${this.name}/${this.network}] flushEntryQueue() executed successfully`,
      );
    } catch (error) {
      console.error(
        `[${this.name}/${this.network}] Failed to flush entry queue:`,
        error,
      );
    }
  }
}
