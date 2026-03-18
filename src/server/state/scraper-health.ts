/**
 * Scraper health tracking — records success/failure and timing for each scraper.
 */

export type ScraperHealthData = {
  lastScrapeDurationMs: number;
  successCount: number;
  errorCount: number;
  consecutiveErrors: number;
  lastScrapeSuccess: boolean;
};

const healthMap = new Map<string, ScraperHealthData>();

function key(name: string, network: string): string {
  return `${name}:${network}`;
}

function getOrCreate(name: string, network: string): ScraperHealthData {
  const k = key(name, network);
  let data = healthMap.get(k);
  if (!data) {
    data = {
      lastScrapeDurationMs: 0,
      successCount: 0,
      errorCount: 0,
      consecutiveErrors: 0,
      lastScrapeSuccess: true,
    };
    healthMap.set(k, data);
  }
  return data;
}

export function recordScrapeSuccess(name: string, network: string, durationMs: number): void {
  const data = getOrCreate(name, network);
  data.lastScrapeDurationMs = durationMs;
  data.successCount++;
  data.consecutiveErrors = 0;
  data.lastScrapeSuccess = true;
}

export function recordScrapeError(name: string, network: string, durationMs: number): void {
  const data = getOrCreate(name, network);
  data.lastScrapeDurationMs = durationMs;
  data.errorCount++;
  data.consecutiveErrors++;
  data.lastScrapeSuccess = false;
}

export function getAllScraperHealth(): ReadonlyMap<string, ScraperHealthData> {
  return healthMap;
}

/** Reset all health data — useful for testing. */
export function resetScraperHealth(): void {
  healthMap.clear();
}
