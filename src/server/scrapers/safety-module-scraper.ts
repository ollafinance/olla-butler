import { AbstractScraper } from "./base-scraper.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import { updateSafetyModuleData } from "../state/index.js";
import { formatEther } from "viem";

/**
 * Scrapes SafetyModule for risk parameters:
 * isPaused, depositCap
 */
export class SafetyModuleScraper extends AbstractScraper {
  readonly name = "safety-module";
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
      const data = await this.protocolClient.scrapeSafetyModuleData();
      updateSafetyModuleData(this.network, data);

      console.log(
        `[${this.name}/${this.network}] Paused: ${data.isPaused} | ` +
        `DepositCap: ${formatEther(data.depositCap)}`,
      );
    } catch (error) {
      console.error(`[${this.name}/${this.network}] Error during scrape:`, error);
      throw error;
    }
  }
}
