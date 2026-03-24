import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateStakingData } from "../state/index.js";
import { formatEther } from "viem";

/**
 * Scrapes StakingManager + StakingProviderRegistry for staking data:
 * totalStaked, attester counts, staking state, key queue length
 */
export class StakingScraper extends AbstractScraper {
  readonly name = "staking";
  readonly network: string;

  constructor(
    network: string,
    private protocolClient: OllaProtocolClient,
  ) {
    super();
    this.network = network;
  }

  async scrape(): Promise<void> {
    try {
      const data = await this.protocolClient.scrapeStakingData();
      updateStakingData(this.network, data);

      console.log(
        `[${this.name}/${this.network}] Staked: ${formatEther(data.totalStaked)} | ` +
        `ActiveAttesters: ${data.activatedAttesterCount} | ` +
        `PendingUnstake: ${data.pendingUnstakeCount} | ` +
        `KeyQueue: ${data.keyQueueLength} | ` +
        `FinalizedUnstakes: ${data.hasFinalizedUnstakes}`,
      );
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}
