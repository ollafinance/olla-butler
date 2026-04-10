import { describe, it, expect } from "vitest";
import { computeAttesterData } from "../attester-scraper.js";
import { AztecAttesterStatus, type AttesterState } from "../../../types/index.js";

const THRESHOLD = 100n * 10n ** 18n; // 100 tokens

/** StakingManager InternalAttesterStatus enum values */
const IS = { Inactive: 0, Queued: 1, Active: 2, Exiting: 3 } as const;

function makeAttester(overrides: Partial<AttesterState> & { address: string }): AttesterState {
  return {
    status: AztecAttesterStatus.VALIDATING,
    effectiveBalance: THRESHOLD,
    exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
    ...overrides,
  };
}

/** Build an internal status map from [address, status] pairs */
function statuses(...entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

describe("computeAttesterData", () => {
  it("computes correct aggregates for healthy attesters", () => {
    const attesters = [
      makeAttester({ address: "0x01" }),
      makeAttester({ address: "0x02" }),
      makeAttester({ address: "0x03" }),
    ];
    const sm = statuses(["0x01", IS.Active], ["0x02", IS.Active], ["0x03", IS.Active]);

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD * 3n, sm);

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

  it("detects fully exited attester (no internal statuses)", () => {
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

  it("detects queued attester via internal status (NONE on rollup, Queued in SM)", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];
    const sm = statuses(["0x01", IS.Queued]);

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD, sm);

    expect(result.rollupQueuedCount).toBe(1);
    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("queued");
    expect(result.staleAttesters[0]!.reasons).not.toContain("fully_exited");
  });

  it("does not detect queued without internal statuses (fully_exited stays)", () => {
    const attesters = [
      makeAttester({
        address: "0x01",
        status: AztecAttesterStatus.NONE,
        effectiveBalance: 0n,
        exit: { exists: false, amount: 0n, exitableAt: 0n, isExitable: false },
      }),
    ];

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD);

    expect(result.rollupQueuedCount).toBe(0);
    expect(result.staleAttesters).toHaveLength(1);
    expect(result.staleAttesters[0]!.reasons).toContain("fully_exited");
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

  it("does not flag activation_pending when SM status is Active", () => {
    const attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
      makeAttester({ address: "0x02", status: AztecAttesterStatus.VALIDATING }),
    ];
    const sm = statuses(["0x01", IS.Active], ["0x02", IS.Active]);

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD * 2n, sm);

    expect(result.staleAttesters).toHaveLength(0);
  });

  it("does not flag activation_pending when no internal statuses provided", () => {
    const attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
    ];
    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD);

    expect(result.staleAttesters).toHaveLength(0);
  });

  it("slashing is only detected without an exit", () => {
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

  // ── activation_pending tests ──

  it("detects activation_pending only for Queued attesters that are VALIDATING", () => {
    const attesters = [
      makeAttester({ address: "0x01" }), // VALIDATING
      makeAttester({ address: "0x02" }), // VALIDATING
      makeAttester({ address: "0x03" }), // VALIDATING
    ];
    const sm = statuses(["0x01", IS.Active], ["0x02", IS.Queued], ["0x03", IS.Queued]);

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD * 3n, sm);

    expect(result.staleAttesters).toHaveLength(2);
    const addresses = result.staleAttesters.map((s) => s.address);
    expect(addresses).toContain("0x02");
    expect(addresses).toContain("0x03");
    for (const stale of result.staleAttesters) {
      expect(stale.reasons).toEqual(["activation_pending"]);
      expect(stale.slashingLoss).toBe(0n);
    }
  });

  it("activation_pending does not apply to non-VALIDATING attesters", () => {
    const attesters = [
      makeAttester({ address: "0x01", status: AztecAttesterStatus.VALIDATING }),
      makeAttester({
        address: "0x02",
        status: AztecAttesterStatus.EXITING,
        exit: { exists: true, amount: THRESHOLD, exitableAt: 999n, isExitable: false },
      }),
    ];
    const sm = statuses(["0x01", IS.Queued], ["0x02", IS.Queued]);

    const result = computeAttesterData(attesters, THRESHOLD, THRESHOLD * 2n, sm);

    const stale01 = result.staleAttesters.find((s) => s.address === "0x01")!;
    expect(stale01.reasons).toContain("activation_pending");

    // EXITING attester should NOT get activation_pending even if Queued in SM
    const stale02 = result.staleAttesters.find((s) => s.address === "0x02");
    expect(stale02).toBeUndefined();
  });

  it("reproduces the sepolia bug: equal balances, only Queued attesters are tagged", () => {
    // 5 attesters VALIDATING on rollup, cachedStakedAmount == rollupTotalEffectiveBalance,
    // but 2 are still Queued in StakingManager.
    const attesters = [
      makeAttester({ address: "0x01" }),
      makeAttester({ address: "0x02" }),
      makeAttester({ address: "0x03" }),
      makeAttester({ address: "0x04" }),
      makeAttester({ address: "0x05" }),
    ];
    const totalBalance = THRESHOLD * 5n;
    const sm = statuses(
      ["0x01", IS.Active], ["0x02", IS.Active], ["0x03", IS.Active],
      ["0x04", IS.Queued], ["0x05", IS.Queued],
    );

    const result = computeAttesterData(attesters, THRESHOLD, totalBalance, sm);

    expect(result.cachedVsRollupBalanceDrift).toBe(0n);
    // Only the 2 Queued attesters should be tagged — not all 5
    expect(result.staleAttesters).toHaveLength(2);
    const addresses = result.staleAttesters.map((s) => s.address);
    expect(addresses).toContain("0x04");
    expect(addresses).toContain("0x05");
    for (const stale of result.staleAttesters) {
      expect(stale.reasons).toEqual(["activation_pending"]);
    }
  });
});
