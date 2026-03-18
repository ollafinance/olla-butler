/**
 * Scraper health metrics — makes the butler itself observable.
 * Detects silent scraper failures and RPC connectivity issues.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllScraperHealth } from "../state/scraper-health.js";

function parseKey(key: string): { scraper: string; network: string } {
  const idx = key.indexOf(":");
  return {
    scraper: key.slice(0, idx),
    network: key.slice(idx + 1),
  };
}

export const initScraperHealthMetrics = () => {
  const durationGauge = createObservableGauge("scraper_duration_ms", {
    description: "Duration of last scrape in milliseconds",
    unit: "ms",
  });
  durationGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { scraper, network } = parseKey(key);
      result.observe(data.lastScrapeDurationMs, { scraper, network });
    }
  });

  const successTotalGauge = createObservableGauge("scraper_success_total", {
    description: "Cumulative successful scrapes",
  });
  successTotalGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { scraper, network } = parseKey(key);
      result.observe(data.successCount, { scraper, network });
    }
  });

  const errorTotalGauge = createObservableGauge("scraper_error_total", {
    description: "Cumulative scrape errors",
  });
  errorTotalGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { scraper, network } = parseKey(key);
      result.observe(data.errorCount, { scraper, network });
    }
  });

  const consecutiveErrorsGauge = createObservableGauge("scraper_consecutive_errors", {
    description: "Current consecutive error streak",
  });
  consecutiveErrorsGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { scraper, network } = parseKey(key);
      result.observe(data.consecutiveErrors, { scraper, network });
    }
  });

  const upGauge = createObservableGauge("scraper_up", {
    description: "1 if last scrape succeeded, 0 if failed",
  });
  upGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { scraper, network } = parseKey(key);
      result.observe(data.lastScrapeSuccess ? 1 : 0, { scraper, network });
    }
  });

  // rpc_reachable: per-network, 1 if any scraper succeeded recently
  const rpcReachableGauge = createObservableGauge("rpc_reachable", {
    description: "1 if any scraper for this network succeeded recently, 0 otherwise",
  });
  rpcReachableGauge.addCallback((result: ObservableResult<Attributes>) => {
    const networkStatus = new Map<string, boolean>();
    for (const [key, data] of getAllScraperHealth().entries()) {
      const { network } = parseKey(key);
      if (data.lastScrapeSuccess) {
        networkStatus.set(network, true);
      } else if (!networkStatus.has(network)) {
        networkStatus.set(network, false);
      }
    }
    for (const [network, reachable] of networkStatus.entries()) {
      result.observe(reachable ? 1 : 0, { network });
    }
  });

  console.log("Scraper health metrics initialized");
};
