import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionExecutor, TX_GAS_CAP } from "../tx-executor.js";
import { OllaCoreWriteAbi } from "../../../types/write-abis.js";
import { RebalanceStep, type ContractAddresses } from "../../../types/index.js";

const core = "0x0000000000000000000000000000000000000001";
const vault = "0x0000000000000000000000000000000000000002";
const stakingManager = "0x0000000000000000000000000000000000000003";
const hash = `0x${"a".repeat(64)}`;
const zero = [0n, 0n, 0n, 100n] as const;
const stake = [0n, 0n, 50n, 50n] as const;

function setup(results: unknown[], estimate = 13_000_000n, pending = 0n, minimumStake = 50n) {
  const executor = new TransactionExecutor({
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1,
    privateKey: `0x${"1".repeat(64)}`,
    addresses: { core, vault, stakingManager } as ContractAddresses,
  });
  const progress = { step: RebalanceStep.StakeSurplus, stakeRemaining: 100n, unstakeRemaining: 0n };
  const readContract = vi.fn().mockImplementation(({ functionName, args }: { functionName: string; args?: bigint[] }) => {
    if (functionName === "rebalanceProgress") return Promise.resolve({ ...progress });
    if (functionName === "bufferedAssets") return Promise.resolve(100n);
    if (functionName === "pendingWithdrawalAssets") return Promise.resolve(pending);
    if (functionName === "canStake") return Promise.resolve((args?.[0] ?? 0n) >= minimumStake);
    throw new Error("unexpected read");
  });
  const simulateContract = vi.fn().mockImplementation(async () => ({ result: results.shift() ?? zero }));
  const writeContract = vi.fn().mockResolvedValue(hash);
  const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success", blockNumber: 1n, gasUsed: 100n });
  (executor as any).publicClient = {
    estimateContractGas: vi.fn().mockResolvedValue(estimate),
    readContract, simulateContract, waitForTransactionReceipt,
  };
  (executor as any).walletClient = { writeContract };
  return { executor, progress, readContract, simulateContract, writeContract, waitForTransactionReceipt };
}

describe("rebalance semantic gas gate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("simulates the original buffered/capped policy limit as the caller, then sends exactly once", async () => {
    const t = setup([stake], 10_000_000n);
    expect(await t.executor.rebalance()).toBe(hash);
    expect(t.simulateContract).toHaveBeenCalledTimes(1);
    expect(t.simulateContract.mock.calls[0]![0]).toMatchObject({
      gas: 13_000_000n, address: core, functionName: "rebalance", abi: OllaCoreWriteAbi,
      account: expect.objectContaining({ address: t.executor.getExecutorAddress() }),
    });
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 13_000_000n }));
    expect(t.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("rejects a cap false-Done and picks a productive lower limit without retrying the send", async () => {
    const t = setup([zero, stake]);
    await t.executor.rebalance();
    expect(t.simulateContract.mock.calls.map(([request]) => request.gas)).toEqual([
      TX_GAS_CAP, 13_000_000n,
    ]);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 13_000_000n }));
  });

  it("searches broad nonmonotonic ranges rather than assuming the next lower limit succeeds", async () => {
    const t = setup([zero, zero, stake]);
    await t.executor.rebalance();
    expect(t.simulateContract.mock.calls.map(([request]) => request.gas)).toEqual([
      TX_GAS_CAP, 13_000_000n, 9_750_000n,
    ]);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 9_750_000n }));
  });

  it("allows a useful partial amount when work remains resumable", async () => {
    const t = setup([[0n, 0n, 1n, 99n]]);
    await t.executor.rebalance();
    expect(t.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not mistake rewards alone for completing an actionable StakeSurplus", async () => {
    const t = setup([[1n, 0n, 0n, 100n], stake]);
    await t.executor.rebalance();
    expect(t.simulateContract).toHaveBeenCalledTimes(2);
    expect(t.writeContract).toHaveBeenCalledTimes(1);
  });

  it("accepts useful withdrawal finalization when the simulated buffer cannot stake", async () => {
    const t = setup([[0n, 75n, 0n, 25n]], 13_000_000n, 80n);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    await t.executor.rebalance();
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: TX_GAS_CAP }));
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: stakingManager, functionName: "canStake", args: [20n],
    }));
    expect(t.readContract.mock.calls.filter(([request]) => request.functionName === "canStake" && request.args?.[0] === 20n)).toHaveLength(2);
  });

  it("rejects finalized-only when pre-state pending hides post-finalization actionable stake", async () => {
    // Using before.pending (60) would test 90-60=30 (not stakeable). Finalizing
    // 40 leaves only 20 reserved, so the actual candidate amount is 70.
    const t = setup([[0n, 40n, 0n, 90n], stake], 13_000_000n, 60n);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    await t.executor.rebalance();
    expect(t.simulateContract).toHaveBeenCalledTimes(2);
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: stakingManager, functionName: "canStake", args: [70n],
    }));
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 13_000_000n }));
  });

  it("uses stakeRemaining or net buffer and actual canStake, not a rollup threshold", async () => {
    const t = setup([stake], 13_000_000n, 75n);
    t.progress.stakeRemaining = 0n;
    await t.executor.rebalance();
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: stakingManager, functionName: "canStake", args: [25n],
    }));
    expect(t.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "getActivationThreshold" }));
  });

  it("uses nonzero stakeRemaining for preflight even when net buffer is smaller", async () => {
    const t = setup([stake], 13_000_000n, 75n);
    await t.executor.rebalance();
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: stakingManager, functionName: "canStake", args: [100n],
    }));
  });

  it("rejects all zero progress, including canStake, without broadcasting", async () => {
    const t = setup([zero, zero, zero, zero]);
    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");
    expect(t.simulateContract).toHaveBeenCalledTimes(4);
    expect(t.simulateContract.mock.calls.map(([request]) => request.gas)).toEqual([
      TX_GAS_CAP, 13_000_000n, 9_750_000n, 6_500_000n,
    ]);
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("canStake=true"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no transaction sent"));
  });

  it("completes StakeSurplus on dust when canStake(residual) is false", async () => {
    // stakeRemaining is dust (1 wei), canStake(1) == false, simulation returns all-zero but the
    // contract advances StakeSurplus -> Done. One simulation, one send, no stake.
    const t = setup([zero], 750_000n, 0n, 50n);
    t.progress.stakeRemaining = 1n;
    await t.executor.rebalance();
    expect(t.simulateContract).toHaveBeenCalledTimes(1);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 975_000n }));
    expect(t.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("rejects stored stakeRemaining=0 when the net buffer is still actionable", async () => {
    // stored stakeRemaining is zero, so readRebalanceContext falls back to net spendable buffer
    // (100 - 0 = 100) and canStake(100) == true. The contract would stake, so an all-zero outcome
    // is false progress: reject all candidates and do not broadcast.
    const t = setup([zero, zero, zero, zero], 13_000_000n, 0n, 50n);
    t.progress.stakeRemaining = 0n;
    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");
    expect(t.simulateContract).toHaveBeenCalledTimes(4);
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("completes StakeSurplus when no keys are configured (canStake always false)", async () => {
    // canStake returns false for any amount (no keys). stakeRemaining is nonzero but not actionable,
    // so the all-zero simulation is the StakeSurplus -> Done completion.
    const t = setup([zero], 13_000_000n, 0n, 50n);
    const original = t.readContract.getMockImplementation()!;
    t.readContract.mockImplementation((request: { functionName: string; args?: bigint[] }) => {
      if (request.functionName === "canStake") return Promise.resolve(false);
      return original(request);
    });
    await t.executor.rebalance();
    expect(t.simulateContract).toHaveBeenCalledTimes(1);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: TX_GAS_CAP }));
    expect(t.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("fails closed on simulation RPC failure or invalid return tuple", async () => {
    const failed = setup([]);
    failed.simulateContract.mockRejectedValueOnce(new Error("RPC disagreement"));
    await expect(failed.executor.rebalance()).rejects.toThrow("simulation RPC failed");
    expect(failed.writeContract).not.toHaveBeenCalled();
    const malformed = setup([[1n, 2n]]);
    await expect(malformed.executor.rebalance()).rejects.toThrow("invalid rebalance return tuple");
    expect(malformed.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed if live context changes between simulation and broadcast", async () => {
    const t = setup([stake]);
    t.readContract.mockImplementation(({ functionName, args }: { functionName: string; args?: bigint[] }) => {
      if (functionName === "rebalanceProgress") return Promise.resolve({ ...t.progress });
      if (functionName === "bufferedAssets") return Promise.resolve(100n);
      if (functionName === "pendingWithdrawalAssets") return Promise.resolve(t.readContract.mock.calls.length > 4 ? 1n : 0n);
      if (functionName === "canStake") return Promise.resolve((args?.[0] ?? 0n) >= 50n);
      throw new Error("unexpected read");
    });
    await expect(t.executor.rebalance()).rejects.toThrow("state disagreement");
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed on derived canStake disagreement after simulation", async () => {
    const t = setup([[0n, 75n, 0n, 25n]], 13_000_000n, 80n);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    let candidateReads = 0;
    const original = t.readContract.getMockImplementation()!;
    t.readContract.mockImplementation((request: { functionName: string; args?: bigint[] }) => {
      if (request.functionName === "canStake" && request.args?.[0] === 20n) {
        candidateReads++;
        return Promise.resolve(candidateReads > 1);
      }
      return original(request);
    });
    await expect(t.executor.rebalance()).rejects.toThrow("post-simulation canStake disagrees");
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed on a context read RPC failure", async () => {
    const t = setup([stake]);
    t.readContract.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(t.executor.rebalance()).rejects.toThrow("context RPC failed");
    expect(t.simulateContract).not.toHaveBeenCalled();
    expect(t.writeContract).not.toHaveBeenCalled();
  });
});
