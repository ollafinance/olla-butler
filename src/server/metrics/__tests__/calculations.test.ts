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

  it("returns true when cooldown elapsed since last Rebalanced event and step is not Done", () => {
    // Last Rebalanced event was 2 hours ago, cooldown is 1 hour
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastRebalance = BigInt(nowSeconds - 7200);
    expect(isRebalanceOverdue(lastRebalance, 3600, RebalanceStep.Harvest)).toBe(true);
  });

  it("returns false when cooldown has not elapsed since last Rebalanced event", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastRebalance = BigInt(nowSeconds - 1800); // 30 min ago
    expect(isRebalanceOverdue(lastRebalance, 3600, RebalanceStep.Harvest)).toBe(false);
  });

  it("returns false when step is Done regardless of cooldown", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastRebalance = BigInt(nowSeconds - 7200);
    expect(isRebalanceOverdue(lastRebalance, 3600, RebalanceStep.Done)).toBe(false);
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
  const ETH = 10n ** 18n;

  it("computes deployed / deployable ratio", () => {
    // staked=80, buffer=10, accumulator=5, claimable=5 → 80/100 = 80%
    expect(capitalEfficiencyPct(80n * ETH, 10n * ETH, 5n * ETH, 5n * ETH)).toBe(80);
  });

  it("returns 0 when deployable pool is empty", () => {
    expect(capitalEfficiencyPct(0n, 0n, 0n, 0n)).toBe(0);
  });

  it("is 100% when nothing is idle", () => {
    expect(capitalEfficiencyPct(100n * ETH, 0n, 0n, 0n)).toBe(100);
  });

  it("is 0% when everything is idle in buffer", () => {
    expect(capitalEfficiencyPct(0n, 100n * ETH, 0n, 0n)).toBe(0);
  });

  it("counts unharvested accumulator balance as idle", () => {
    // staked=90, accumulator=10 → 90/100 = 90%
    expect(capitalEfficiencyPct(90n * ETH, 0n, 10n * ETH, 0n)).toBe(90);
  });

  it("counts unclaimed staking rewards as idle", () => {
    // staked=90, claimable=10 → 90/100 = 90%
    expect(capitalEfficiencyPct(90n * ETH, 0n, 0n, 10n * ETH)).toBe(90);
  });

  it("is bounded at 100% even with pending withdrawal backlog", () => {
    // The formula doesn't reference pendingWithdrawalAssets, so it cannot
    // exceed 100% the way the old `staked / totalAssets` form could.
    expect(capitalEfficiencyPct(100n * ETH, 50n * ETH, 0n, 0n)).toBeLessThanOrEqual(100);
  });
});

describe("rewardsAprPct", () => {
  const secondsInYear = Math.floor(365.25 * 24 * 3600);

  it("annualizes a year-long period to the raw ratio", () => {
    // 1 ETH on 100 ETH over a year = 1% APR
    const apr = rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, secondsInYear);
    expect(apr).toBeCloseTo(1.0, 1);
  });

  it("annualizes a short period proportionally", () => {
    // 1 ETH on 100 ETH over 1 day ≈ 365.25% APR
    expect(rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, 86400)).toBeCloseTo(365.25, 1);
  });

  it("is independent of wall-clock time since the report", () => {
    // The APR is determined by the closed period only — same period, same APR
    // regardless of how long ago the report was written.
    const periodSeconds = 86400; // 1 day
    const apr1 = rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, periodSeconds);
    const apr2 = rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, periodSeconds);
    expect(apr1).toBe(apr2);
  });

  it("returns 0 when principal is zero", () => {
    expect(rewardsAprPct(1n * 10n ** 18n, 0n, secondsInYear)).toBe(0);
  });

  it("returns 0 when period is too short (< 1 hour)", () => {
    expect(rewardsAprPct(1n * 10n ** 18n, 100n * 10n ** 18n, 1800)).toBe(0);
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
