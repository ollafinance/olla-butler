import { describe, it, expect, beforeEach } from "vitest";
import {
  recordScrapeSuccess,
  recordScrapeError,
  getAllScraperHealth,
  resetScraperHealth,
} from "../scraper-health.js";

describe("scraper-health", () => {
  beforeEach(() => {
    resetScraperHealth();
  });

  it("records success and resets consecutiveErrors", () => {
    recordScrapeError("core", "sepolia", 50);
    recordScrapeError("core", "sepolia", 60);
    recordScrapeSuccess("core", "sepolia", 100);

    const health = getAllScraperHealth().get("core:sepolia");
    expect(health).toBeDefined();
    expect(health!.successCount).toBe(1);
    expect(health!.errorCount).toBe(2);
    expect(health!.consecutiveErrors).toBe(0);
    expect(health!.lastScrapeSuccess).toBe(true);
    expect(health!.lastScrapeDurationMs).toBe(100);
  });

  it("increments error count and consecutive errors", () => {
    recordScrapeError("vault", "mainnet", 200);
    recordScrapeError("vault", "mainnet", 300);

    const health = getAllScraperHealth().get("vault:mainnet");
    expect(health).toBeDefined();
    expect(health!.errorCount).toBe(2);
    expect(health!.consecutiveErrors).toBe(2);
    expect(health!.lastScrapeSuccess).toBe(false);
  });

  it("records duration correctly", () => {
    recordScrapeSuccess("staking", "sepolia", 42.5);

    const health = getAllScraperHealth().get("staking:sepolia");
    expect(health).toBeDefined();
    expect(health!.lastScrapeDurationMs).toBe(42.5);
  });

  it("tracks different scrapers independently", () => {
    recordScrapeSuccess("core", "sepolia", 50);
    recordScrapeError("vault", "sepolia", 100);

    const coreHealth = getAllScraperHealth().get("core:sepolia");
    const vaultHealth = getAllScraperHealth().get("vault:sepolia");

    expect(coreHealth!.lastScrapeSuccess).toBe(true);
    expect(vaultHealth!.lastScrapeSuccess).toBe(false);
  });
});
