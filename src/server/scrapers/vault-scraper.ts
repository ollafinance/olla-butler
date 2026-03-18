import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateVaultData } from "../state/index.js";
import { formatEther } from "viem";

/**
 * Scrapes OllaVault + stAztec for vault-level data:
 * bufferedAssets, pendingWithdrawals, cumulativeDeposits/Withdrawals, stAztec supply
 */
export class VaultScraper extends AbstractScraper {
  readonly name = "vault";
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
      const data = await this.protocolClient.scrapeVaultData();
      updateVaultData(this.network, data);

      console.log(
        `[${this.name}/${this.network}] Buffered: ${formatEther(data.bufferedAssets)} | ` +
        `PendingWd: ${formatEther(data.pendingWithdrawalAssets)} | ` +
        `stAztec supply: ${formatEther(data.stAztecTotalSupply)} | ` +
        `InstantRedeemAvail: ${formatEther(data.availableForInstantRedemption)}`,
      );
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}
