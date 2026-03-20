/**
 * Attester Refresh Task
 *
 * Monitors attester state and calls refreshAttester() when attesters need updating.
 * Triggers on: rollup status change, slashing detection, exit events, zombie status.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getAttesterData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

/** Reasons that warrant a refreshAttester call */
const REFRESH_REASONS = new Set(["slashing", "exit_undetected", "exit_exitable", "zombie", "fully_exited", "pending_activation"]);

/** Cooldown per attester to avoid spamming refresh (5 minutes) */
const PER_ATTESTER_COOLDOWN_MS = 5 * 60 * 1000;

export class AttesterRefreshTask extends AbstractScraper {
  readonly name = "tx-attester-refresh";
  readonly network: string;

  private readonly executor: TransactionExecutor;
  private lastRefreshTime = new Map<string, number>();

  constructor(network: string, executor: TransactionExecutor) {
    super();
    this.network = network;
    this.executor = executor;
  }

  async scrape(): Promise<void> {
    const attesterData = getAttesterData(this.network);
    if (!attesterData) {
      return;
    }

    const staleAttesters = attesterData.staleAttesters.filter((sa) =>
      sa.reasons.some((r) => REFRESH_REASONS.has(r)),
    );

    if (staleAttesters.length === 0) {
      return;
    }

    const now = Date.now();
    for (const stale of staleAttesters) {
      const lastRefresh = this.lastRefreshTime.get(stale.address) ?? 0;
      if (now - lastRefresh < PER_ATTESTER_COOLDOWN_MS) {
        continue;
      }

      try {
        console.log(
          `[${this.name}/${this.network}] Refreshing attester ${stale.address} | reasons: ${stale.reasons.join(", ")}`,
        );
        await this.executor.refreshAttester(stale.address);
        this.lastRefreshTime.set(stale.address, now);
        console.log(
          `[${this.name}/${this.network}] Successfully refreshed attester ${stale.address}`,
        );
      } catch (error) {
        console.error(
          `[${this.name}/${this.network}] Failed to refresh attester ${stale.address}:`,
          error,
        );
      }
    }
  }
}
