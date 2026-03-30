/**
 * Attester Refresh Task
 *
 * Monitors attester state and calls refreshAttester() when attesters need updating.
 * Triggers on: rollup status change, slashing detection, exit events, zombie status.
 */

import { AbstractScraper } from "../scrapers/base-scraper.js";
import { getAttesterData } from "../state/index.js";
import type { TransactionExecutor } from "./tx-executor.js";

/** Reasons that warrant a refreshAttester call on each polling cycle (with cooldown) */
const REFRESH_REASONS = new Set(["slashing", "exit_undetected", "exit_exitable", "zombie", "fully_exited", "pending_activation"]);

/** Cooldown per attester to avoid spamming refresh (5 minutes) */
const PER_ATTESTER_COOLDOWN_MS = 5 * 60 * 1000;

export class AttesterRefreshTask extends AbstractScraper {
  readonly name = "tx-attester-refresh";
  readonly network: string;

  private readonly executor: TransactionExecutor;
  private lastRefreshTime = new Map<string, number>();
  /** Tracks queued attesters that have already been refreshed once (fire-once) */
  private refreshedQueued = new Set<string>();

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

    // Clean up refreshedQueued: remove entries for attesters no longer queued
    for (const addr of this.refreshedQueued) {
      const still = attesterData.staleAttesters.find(
        (s) => s.address === addr && s.reasons.includes("queued"),
      );
      if (!still) {
        this.refreshedQueued.delete(addr);
      }
    }

    // Collect attesters needing refresh: standard reasons OR first-time queued
    const toRefresh = attesterData.staleAttesters.filter((sa) => {
      if (sa.reasons.some((r) => REFRESH_REASONS.has(r))) return true;
      if (sa.reasons.includes("queued") && !this.refreshedQueued.has(sa.address)) return true;
      return false;
    });

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
        if (stale.reasons.includes("queued")) {
          this.refreshedQueued.add(stale.address);
        }
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
