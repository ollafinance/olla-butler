import { describe, it, expect } from "vitest";
import { computeAttesterData } from "../attester-scraper.js";
import { AztecAttesterStatus, type AttesterState } from "../../../types/index.js";

const THRESHOLD = 100n * 10n ** 18n; // 100 tokens

function makeAttester(overrides: Partial<AttesterState> & { address: string }): AttesterState {
  return {
    status: AztecAttesterStatus.VALIDATING,
    effectiveBalance: THRESHOLD,
    exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
    ...overrides,
  };
}

describe("computeAttesterData", () => {
  it("computes correct aggregates for healthy attesters", () => {
    const attesters = [
      makeAttester({ address: "0x01" }),
      makeAttester({ address: "0x02" }),
      makeAttester({ address: "0x03" }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD * 3n);

    expect(result.rollupActiveCount).toBe(3);
    expect(result.rollupExitingCount).toBe(0);
    expect(result.rollupZombieCount).toBe(0);
    expect(result.rollupQueuedCount).toBe(0);
    expect(result.rollupTotalEffectiveBalance).toBe(THRESHOLD * 3n);
    expect(result.cachedVsRollupBalanceDrift).toBe(0n);
    expect(result.staleAttesters).toHaveLength(0);
    expect(result.exitableAttesterCount).toBe(0);
  });

  it("detects partial slashing (validating, balance below threshold)", () => {
    const slashedBalance = THRESHOLD - 10n * 10n ** 18n; // 90 tokens
    const attesters = [
      makeAttester({ address: "0x01" }),
      makeAttester({ address: "0x02", effectiveBalance: slashedBalance }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.address).toBe("0x02");
    expect(result.staleAttesters[0]!.reasons).toContain("slashing");
    expect(result.staleAttesters[0]!.slashingLoss).toBe(10n * 10n ** 18n);
  });

  it("detects zombie attester", () => {
    const attesters = [
      makeAttester({ address: "0x01" }),
      makeAttester({
        address: "0x02",
        status: AztecAttesterStatus.ZOMBIE,
        effectiveBalance: 50n * 10n ** 18n,
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.rollupZombieCount).toBe(1);
    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("zombie");
    expect(result.staleAttesters[0]!.slashingLoss).toBe(50n * 10n ** 18n);
  });

  it("detects undetected exit on validating attester", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.VALIDATING,
        exit: { exists: true, amount: THRESHOLD, exitableAt: 999999999999n, isExitable: false },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("exit_undetected");
  });

  it("detects exitable exits", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.EXITING,
        exit: { exists: true, amount: THRESHOLD, exitableAt: 0n, isExitable: true },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.exitableAttesterCount).toBe(1);
    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("exit_exitable");
  });

  it("detects fully exited attester", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("fully_exited");
  });

  it("computes cached vs rollup drift", () => {
    const attesters = [
      makeAttester({ address: "0x01", effectiveBalance: 90n * 10n ** 18n }),
    ];
    const cachedAmount = 100n * 10n ** 18n;

    const result = computeAttesterData(attesters, THRESHOLD, cachedAmount);

    expect(result.cachedVsRollupBalanceDrift).toBe(10n * 10n ** 18n);
  });

  it("handles zero drift when no cached amount provided", () => {
    const attesters = [makeAttester({ address: "0x01" })];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.cachedVsRollupBalanceDrift).toBe(0n);
  });

  it("detects queued attester (NONE on rollup, cached stake exceeds rollup balance)", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];
    // Olla has staked more than the rollup shows — attester is queued
    const cachedAmount = THRESHOLD;

    const result = computeAttesterData(attesters, THRESHOLD, cachedAmount);

    expect(result.rollupQueuedCount).toBe(1);
    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("queued");
    expect(result.staleAttesters[0]!.reasons).not.toContain("fully_exited");
  });

  it("counts status types correctly with mixed attesters", () => {
    const attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
      makeAttester({ address: "0x02", status: AztecAttesterStatus.VALIDATING }),
      makeAttester({ address: "0x03", status: AztecAttesterStatus.EXITING, exit: { exists: true, amount: THRESHOLD, exitableAt: 999n, isExitable: false } }),
      makeAttester({ address: "0x04", status: AztecAttesterStatus.ZOMBIE, effectiveBalance: 0n }),
      makeAttester({ address: "0x05", status: AztecAttesterStatus.NONE, effectiveBalance: 0n }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.rollupActiveCount).toBe(2);
    expect(result.rollupExitingCount).toBe(1);
    expect(result.rollupZombieCount).toBe(1);
  });

  it("attester can have multiple staleness reasons", () => {
    // Validating attester with an undetected exit that is already exitable
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.VALIDATING,
        effectiveBalance: THRESHOLD,
        exit: { exists: true, amount: THRESHOLD, exitableAt: 0n, isExitable: true },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(1);
    const stale = result.staleAttesters[0]!;
    expect(stale.reasons).toContain("exit_undetected");
    expect(stale.reasons).toContain("exit_exitable");
    expect(stale.reasons).toHaveLength(2);
  });

  it("keeps queued attester stale when it transitions to VALIDATING on rollup", () => {
    // Previous scrape: attester was queued (NONE on rollup, Olla has staked)
    const previousAttesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];
    const previousData = computeAttesterData(previousAttesters, THRESHOLD, THRESHOLD);
    expect(previousData.staleAttesters[0]!.reasons).toContain("queued");

    // Current scrape: attester is now VALIDATING on rollup — still needs refresh to sync StakingManager
    const currentAttesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const result = computeAttesterData(currentAttesters, THRESHOLD, THRESHOLD, previousData);

    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("queued");
  });

  it("queued persists across cycles until refresh fires", () => {
    // Cycle 1: attester queued (NONE on rollup)
    const cycle1Attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];
    const cycle1 = computeAttesterData(cycle1Attesters, THRESHOLD, THRESHOLD);

    // Cycle 2: attester now VALIDATING — still queued (needs refresh)
    const cycle2Attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const cycle2 = computeAttesterData(cycle2Attesters, THRESHOLD, THRESHOLD, cycle1);
    expect(cycle2.staleAttesters[0]!.reasons).toContain("queued");

    // Cycle 3: still VALIDATING — queued persists from previous cycle
    const cycle3 = computeAttesterData(cycle2Attesters, THRESHOLD, THRESHOLD, cycle2);
    expect(cycle3.staleAttesters).toHaveLength(1);
    expect(cycle3.staleAttesters[0]!.reasons).toContain("queued");
  });

  it("does not flag queued for attesters that were not previously queued", () => {
    // Previous scrape: attester was active (not queued)
    const previousAttesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const previousData = computeAttesterData(previousAttesters, THRESHOLD, THRESHOLD);

    // Current scrape: still active — no stale reason
    const currentAttesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const result = computeAttesterData(currentAttesters, THRESHOLD, THRESHOLD, previousData);

    expect(result.staleAttesters).toHaveLength(0);
  });

  it("does not flag queued transition when no previous data is available", () => {
    const attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(0);
  });

  it("slashing is only detected without an exit", () => {
    // Partial slashing: balance below threshold, no exit
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.VALIDATING,
        effectiveBalance: 50n * 10n ** 18n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(1);
    const stale = result.staleAttesters[0]!;
    expect(stale.reasons).toContain("slashing");
    expect(stale.reasons).toHaveLength(1);
    expect(stale.slashingLoss).toBe(50n * 10n ** 18n);
  });
});
