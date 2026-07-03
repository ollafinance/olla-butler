/**
 * Operator Balance Scraper
 *
 * Periodically polls the native (ETH) balance of a configured public Olla
 * operator wallet address. This does not require or touch any private key.
 */

import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import { updateOperatorWalletData } from "../state/index.js";
import { AbstractScraper } from "./base-scraper.js";

export class OperatorBalanceScraper extends AbstractScraper {
  readonly name = "operator-balance";
  readonly network: string;

  private readonly publicClient: PublicClient;
  private readonly address: Address;

  constructor(network: string, publicClient: PublicClient, address: string) {
    super();
    this.network = network;
    this.publicClient = publicClient;
    this.address = getAddress(address);
  }

  async scrape(): Promise<void> {
    try {
      const balance = await this.publicClient.getBalance({ address: this.address });
      updateOperatorWalletData(this.network, {
        address: this.address,
        balance,
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error(
        `[${this.name}/${this.network}] Failed to fetch operator wallet balance:`,
        error,
      );
    }
  }
}
