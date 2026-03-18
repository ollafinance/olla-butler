import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateWithdrawalQueueData } from "../state/index.js";
import { formatEther } from "viem";

/**
 * Scrapes WithdrawalQueue for queue state:
 * nextRequestId, pending assets/shares, unfinalized requests
 */
export class WithdrawalQueueScraper extends AbstractScraper {
  readonly name = "withdrawal-queue";
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
      const data = await this.protocolClient.scrapeWithdrawalQueueData();
      updateWithdrawalQueueData(this.network, data);

      console.log(
        `[${this.name}/${this.network}] NextReqId: ${data.nextRequestId} | ` +
        `PendingAssets: ${formatEther(data.totalPendingAssets)} | ` +
        `PendingShares: ${formatEther(data.totalPendingShares)} | ` +
        `NextUnfinalized: ${data.nextUnfinalized}`,
      );
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}
