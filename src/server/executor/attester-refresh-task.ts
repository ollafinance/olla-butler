/**
 * Attester Refresh Task
 *
 * Monitors attester state and calls refreshAttester() when attesters need updating.
 * Triggers on: rollup status change, slashing detection, exit events, zombie status.
 * State transitions are driven entirely by on-chain state detected by the attester scraper —
 * once the on-chain state changes, the scraper stops reporting the attester as stale.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getAttesterData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

/** All staleness reasons that warrant a refreshAttesterState call */
const REFRESH_REASONS = new Set([
  "slashing",
  "exit_undetected",
  "exit_exitable",
  "zombie",
  "fully_exited",
  "pending_activation",
  "queued",
]);

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

    const toRefresh = attesterData.staleAttesters.filter((sa) =>
      sa.reasons.some((r) => REFRESH_REASONS.has(r)),
    );

    if (toRefresh.length === 0) {
      return;
    }

    const now = Date.now();
    const batch = toRefresh.filter((stale) => {
      const lastRefresh = this.lastRefreshTime.get(stale.address) ?? 0;
      return now - lastRefresh >= PER_ATTESTER_COOLDOWN_MS;
    });

    if (batch.length === 0) {
      return;
    }

    try {
      for (const stale of batch) {
        console.log(
          `[${this.name}/${this.network}] Refreshing attester ${stale.address} | reasons: ${stale.reasons.join(", ")}`,
        );
      }

      await this.executor.refreshAttesters(batch.map((s) => s.address));

      for (const stale of batch) {
        this.lastRefreshTime.set(stale.address, now);
      }

      console.log(
        `[${this.name}/${this.network}] Successfully refreshed ${batch.length} attester(s)`,
      );
    } catch (error) {
      console.error(
        `[${this.name}/${this.network}] Failed to refresh ${batch.length} attester(s):`,
        error,
      );
    }
  }
}
