import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateCoreData } from "../state/index.js";
import { RebalanceStepNames } from "../../types/index.js";
import { formatEther } from "viem";

/**
 * Scrapes OllaCore contract for protocol-level data:
 * totalAssets, exchangeRate, accountingState, latestReport, rebalanceProgress, flowCounters
 */
export class CoreScraper extends AbstractScraper {
  readonly name = "core";
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
      const data = await this.protocolClient.scrapeCoreData();
      updateCoreData(this.network, data);

      const stepName = RebalanceStepNames[data.rebalanceProgress.step] ?? "Unknown";
      console.log(
        `[${this.name}/${this.network}] TVL: ${formatEther(data.totalAssets)} | ` +
        `Rate: ${formatEther(data.exchangeRate)} | ` +
        `Staked: ${formatEther(data.accountingState.stakedPrincipal)} | ` +
        `Rebalance: ${stepName} | ` +
        `Fee: ${data.protocolFeeBP}bp`,
      );
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}
