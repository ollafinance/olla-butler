import { describe, it, expect } from "vitest";
import { isExitFinalizable, type GovernanceWithdrawal } from "../exit-readiness.js";

const NOW = 1_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000";
const RECIPIENT = "0x69f8432e33038a539f067bb6a34e4f1e8d3e269a";

function withdrawal(overrides: Partial<GovernanceWithdrawal> = {}): GovernanceWithdrawal {
  return {
    amount: 200_000n * 10n ** 18n,
    unlocksAt: NOW - 1n,
    recipient: RECIPIENT,
    claimed: false,
    ...overrides,
  };
}

describe("isExitFinalizable", () => {
  it("is false without an exit", () => {
    expect(
      isExitFinalizable({
        exit: { exists: false, exitableAt: 0n, isRecipient: true },
        withdrawal: withdrawal(),
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it("is false while the rollup exit delay is still running", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW + 1n, isRecipient: true },
        withdrawal: withdrawal(),
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it("is false while the governance withdrawal is still locked", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: true },
        withdrawal: withdrawal({ unlocksAt: NOW + 1n }),
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it("waits for the governance recipient to be set", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: true },
        withdrawal: withdrawal({ recipient: ZERO }),
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it("is true once both locks have elapsed", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: true },
        withdrawal: withdrawal({ unlocksAt: NOW }),
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it("is true when the governance withdrawal was already claimed", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: true },
        withdrawal: withdrawal({ claimed: true, unlocksAt: NOW + 1n }),
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it("is true for a slashing exit that still needs its withdrawer claimed", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: false },
        withdrawal: withdrawal({ unlocksAt: NOW + 1n }),
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it("is false when the withdrawal record is unavailable", () => {
    expect(
      isExitFinalizable({
        exit: { exists: true, exitableAt: NOW - 1n, isRecipient: true },
        withdrawal: undefined,
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });
});
