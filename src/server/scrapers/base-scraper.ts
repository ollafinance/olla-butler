/**
 * Base interface for all scrapers.
 * Scrapers are responsible for fetching data from various sources
 * (RPC, contracts) to populate metrics and state.
 */
export interface BaseScraper {
  readonly name: string;
  readonly network: string;
  init(): Promise<void>;
  scrape(): Promise<void>;
  shutdown(): Promise<void>;
}

export abstract class AbstractScraper implements BaseScraper {
  abstract readonly name: string;
  abstract readonly network: string;

  async init(): Promise<void> {
    // Default: no-op
  }

  abstract scrape(): Promise<void>;

  async shutdown(): Promise<void> {
    // Default: no-op
  }
}
