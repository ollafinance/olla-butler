import { describe, it, expect, vi, afterEach } from "vitest";
import {
  exchangeRateChangeBps,
  isRebalanceOverdue,
  bufferUtilizationPct,
  capitalEfficiencyPct,
  rewardsAprPct,
  keyQueueToAttesterRatio,
} from "../calculations.js";
import { RebalanceStep } from "../../../types/index.js";

describe("exchangeRateChangeBps", () => {
  it("computes positive change correctly", () => {
    // 1.01e18 vs 1.00e18 = +100 bps (1%)
    const current = 1_010_000_000_000_000_000n;
    const previous = 1_000_000_000_000_000_000n;
    expect(exchangeRateChangeBps(current, previous)).toBe(100);
  });

  it("computes negative change (slashing)", () => {
    const current = 990_000_000_000_000_000n;
    const previous = 1_000_000_000_000_000_000n;
    expect(exchangeRateChangeBps(current, previous)).toBe(-100);
  });

  it("returns 0 when previous is null", () => {
    expect(exchangeRateChangeBps(1_000_000_000_000_000_000n, null)).toBe(0);
  });

  it("returns 0 when previous is zero", () => {
    expect(exchangeRateChangeBps(1_000_000_000_000_000_000n, 0n)).toBe(0);
  });

  it("returns 0 when no change", () => {
    const rate = 1_000_000_000_000_000_000n;
    expect(exchangeRateChangeBps(rate, rate)).toBe(0);
  });
});

describe("isRebalanceOverdue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when cooldown elapsed and step is not Done", () => {
    // Report was 2 hours ago, cooldown is 1 hour
    const nowSeconds = Math.floor(Date.now() / 1000);
    const reportTimestamp = BigInt(nowSeconds - 7200);
    expect(isRebalanceOverdue(reportTimestamp, 3600, RebalanceStep.Harvest)).toBe(true);
  });

  it("returns false when cooldown has not elapsed", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const reportTimestamp = BigInt(nowSeconds - 1800); // 30 min ago
    expect(isRebalanceOverdue(reportTimestamp, 3600, RebalanceStep.Harvest)).toBe(false);
  });

  it("returns false when step is Done regardless of cooldown", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const reportTimestamp = BigInt(nowSeconds - 7200);
    expect(isRebalanceOverdue(reportTimestamp, 3600, RebalanceStep.Done)).toBe(false);
  });
});

describe("bufferUtilizationPct", () => {
  it("computes normal ratio", () => {
    // 50 / 100 = 50%
    expect(bufferUtilizationPct(50n * 10n ** 18n, 100n * 10n ** 18n)).toBe(50);
  });

  it("returns 0 when target is zero", () => {
    expect(bufferUtilizationPct(50n * 10n ** 18n, 0n)).toBe(0);
  });

  it("handles over-buffered case", () => {
    expect(bufferUtilizationPct(150n * 10n ** 18n, 100n * 10n ** 18n)).toBe(150);
  });
});

describe("capitalEfficiencyPct", () => {
  it("computes normal ratio", () => {
    // 80 / 100 = 80%
    expect(capitalEfficiencyPct(80n * 10n ** 18n, 100n * 10n ** 18n)).toBe(80);
  });

  it("returns 0 when totalAssets is zero", () => {
    expect(capitalEfficiencyPct(80n * 10n ** 18n, 0n)).toBe(0);
  });
});

describe("rewardsAprPct", () => {
  it("computes reasonable APR", () => {
    // 1 ETH reward on 100 ETH principal over ~365.25 days = ~1% APR
    const grossRewards = 1n * 10n ** 18n;
    const stakedPrincipal = 100n * 10n ** 18n;
    const secondsInYear = Math.floor(365.25 * 24 * 3600);
    const reportTimestamp = BigInt(Math.floor(Date.now() / 1000) - secondsInYear);
    const nowSeconds = Math.floor(Date.now() / 1000);

    const apr = rewardsAprPct(grossRewards, stakedPrincipal, reportTimestamp, nowSeconds);
    expect(apr).toBeCloseTo(1.0, 1);
  });

  it("returns 0 when principal is zero", () => {
    expect(rewardsAprPct(1n * 10n ** 18n, 0n, 0n, 100000)).toBe(0);
  });

  it("returns 0 when report is very fresh (< 1 hour)", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const reportTimestamp = BigInt(nowSeconds - 1800); // 30 min ago
    expect(rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, reportTimestamp, nowSeconds)).toBe(0);
  });
});

describe("keyQueueToAttesterRatio", () => {
  it("computes normal ratio", () => {
    expect(keyQueueToAttesterRatio(10n, 5n)).toBe(2);
  });

  it("returns 0 when attester count is zero", () => {
    expect(keyQueueToAttesterRatio(10n, 0n)).toBe(0);
  });

  it("handles fractional ratio", () => {
    expect(keyQueueToAttesterRatio(3n, 10n)).toBeCloseTo(0.3);
  });
});
