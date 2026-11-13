import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  encodeFunctionData,
  encodeFunctionResult,
  numberToHex,
  type Address,
} from "viem";
import { TransactionExecutor, TX_GAS_CAP } from "../tx-executor.js";
import { OllaCoreWriteAbi } from "../../../types/write-abis.js";
import { OllaCoreAbi } from "../../../types/olla-abis.js";
import { RebalanceStep, type ContractAddresses } from "../../../types/index.js";

const core = "0x0000000000000000000000000000000000000001";
const vault = "0x0000000000000000000000000000000000000002";
const stakingManager = "0x0000000000000000000000000000000000000003";
const hash = `0x${"a".repeat(64)}`;
const zero = [0n, 0n, 0n, 100n] as const;
const stake = [0n, 0n, 50n, 50n] as const;
const blockHash = `0x${"b".repeat(64)}` as const;
const otherBlockHash = `0x${"c".repeat(64)}` as const;

type Progress = { step: RebalanceStep; stakeRemaining: bigint; unstakeRemaining: bigint };

function sequentialResponse(initial: Progress, final: Progress, outcome: readonly [bigint, bigint, bigint, bigint] = zero, gas = TX_GAS_CAP) {
  const progressResult = (result: Progress) => encodeFunctionResult({
    abi: OllaCoreAbi, functionName: "rebalanceProgress", result,
  });
  const sender = new TransactionExecutor({
    rpcUrl: "http://127.0.0.1:8545", chainId: 1, privateKey: `0x${"1".repeat(64)}`,
    addresses: { core, vault, stakingManager } as ContractAddresses,
  }).getExecutorAddress();
  return [{ transactions: [
    {},
    { from: sender, to: core, input: encodeFunctionData({ abi: OllaCoreWriteAbi, functionName: "rebalance" }), gas: numberToHex(gas) },
    {},
  ], calls: [
    { status: "0x1", returnData: progressResult(initial) },
    { status: "0x1", returnData: encodeFunctionResult({ abi: OllaCoreWriteAbi, functionName: "rebalance", result: outcome }) },
    { status: "0x1", returnData: progressResult(final) },
  ] }];
}

function deterministicRebalanceRevert(sender: Address): ContractFunctionExecutionError {
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      message: "execution reverted",
    }),
    {
      abi: OllaCoreWriteAbi,
      args: [],
      contractAddress: core,
      functionName: "rebalance",
      sender,
    },
  );
}

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
  const getBlock = vi.fn().mockResolvedValue({ number: 42n, hash: blockHash });
  const request = vi.fn().mockImplementation(async ({ params }) => sequentialResponse(progress, {
    ...progress, step: RebalanceStep.InitiateUnstake,
  }, zero, BigInt(params[0].blockStateCalls[0].calls[1].gas)));
  (executor as any).publicClient = {
    estimateContractGas: vi.fn().mockResolvedValue(estimate),
    readContract, simulateContract, waitForTransactionReceipt, getBlock, request,
  };
  (executor as any).walletClient = { writeContract };
  return { executor, progress, readContract, simulateContract, writeContract, waitForTransactionReceipt, getBlock, request };
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

  it("continues after one deterministic EVM revert and sends a later productive candidate exactly once", async () => {
    const t = setup([stake]);
    t.simulateContract.mockRejectedValueOnce(deterministicRebalanceRevert(t.executor.getExecutorAddress()));

    await t.executor.rebalance();

    expect(t.simulateContract.mock.calls.map(([request]) => request.gas)).toEqual([
      TX_GAS_CAP, 13_000_000n,
    ]);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 13_000_000n }));
    expect(t.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("deterministic contract execution revert"));
  });

  it("rejects when every exact-gas candidate deterministically reverts without broadcasting", async () => {
    const t = setup([]);
    t.simulateContract.mockRejectedValue(deterministicRebalanceRevert(t.executor.getExecutorAddress()));

    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");

    expect(t.simulateContract).toHaveBeenCalledTimes(4);
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
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

  it.each([
    ["transport", () => new HttpRequestError({ url: "http://127.0.0.1:8545", details: "connection reset" })],
    ["timeout", () => new TimeoutError({ url: "http://127.0.0.1:8545", body: { method: "eth_call" } })],
    ["unrecognized", () => new Error("unrecognized simulation failure")],
  ])("fails closed on a %s simulation error", async (_label, makeError) => {
    const t = setup([]);
    t.simulateContract.mockRejectedValueOnce(makeError());

    await expect(t.executor.rebalance()).rejects.toThrow("simulation RPC failed");

    expect(t.simulateContract).toHaveBeenCalledTimes(1);
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("fails closed on an ambiguous wrapper around a deterministic revert", async () => {
    const t = setup([]);
    const revert = new ContractFunctionRevertedError({
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      message: "execution reverted",
    });
    const ambiguous = new ContractFunctionExecutionError(
      new BaseError("ambiguous intermediary", { cause: revert }),
      {
        abi: OllaCoreWriteAbi,
        args: [],
        contractAddress: core,
        functionName: "rebalance",
        sender: t.executor.getExecutorAddress(),
      },
    );
    t.simulateContract.mockRejectedValueOnce(ambiguous);

    await expect(t.executor.rebalance()).rejects.toThrow("simulation RPC failed");

    expect(t.simulateContract).toHaveBeenCalledTimes(1);
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed return tuple", async () => {
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

  it.each([RebalanceStep.InitiateUnstake, RebalanceStep.StakeSurplus, RebalanceStep.Done])(
    "accepts a verified all-zero FinalizeWithdrawals transition to step %i",
    async (step) => {
      const t = setup([zero], 10_000_000n, 0n, 200n);
      t.progress.step = RebalanceStep.FinalizeWithdrawals;
      t.request.mockResolvedValue(sequentialResponse(t.progress, { ...t.progress, step }, zero, 13_000_000n));

      expect(await t.executor.rebalance()).toBe(hash);

      const caller = t.executor.getExecutorAddress();
      const progressData = encodeFunctionData({ abi: OllaCoreAbi, functionName: "rebalanceProgress" });
      expect(t.request).toHaveBeenCalledExactlyOnceWith({
        method: "eth_simulateV1",
        params: [{
          blockStateCalls: [{ calls: [
            { from: caller, to: core, data: progressData, gas: numberToHex(100_000n) },
            { from: caller, to: core, data: encodeFunctionData({ abi: OllaCoreWriteAbi, functionName: "rebalance" }), gas: numberToHex(13_000_000n) },
            { from: caller, to: core, data: progressData, gas: numberToHex(100_000n) },
          ] }],
          validation: false,
          returnFullTransactions: true,
        }, numberToHex(42n)],
      });
      expect(t.simulateContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        gas: 13_000_000n, account: expect.objectContaining({ address: caller }),
      }));
      expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        gas: 13_000_000n, account: expect.objectContaining({ address: caller }),
      }));
      expect(t.getBlock).toHaveBeenCalledTimes(5);
      expect(t.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects unchanged sequential progress for every gas candidate", async () => {
    const t = setup([]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockImplementation(async ({ params }) => sequentialResponse(t.progress, t.progress, zero, BigInt(params[0].blockStateCalls[0].calls[1].gas)));

    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");
    expect(t.request).toHaveBeenCalledTimes(4);
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it.each([
    [100n, 0n, 100n],
    [0n, 25n, 75n],
  ])("rejects a verified Done transition when effective stake %i remains actionable", async (remaining, pending, amount) => {
    const t = setup([], 13_000_000n, pending);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockImplementation(async ({ params }) => sequentialResponse(t.progress, {
      ...t.progress, step: RebalanceStep.Done, stakeRemaining: remaining,
    }, zero, BigInt(params[0].blockStateCalls[0].calls[1].gas)));

    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "canStake", args: [amount] }));
    expect(t.request).toHaveBeenCalledTimes(4);
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("rejects an intermediate state transition when effective stake remains actionable", async () => {
    const t = setup([]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    await expect(t.executor.rebalance()).rejects.toThrow("no semantically productive gas candidate");
    expect(t.request).toHaveBeenCalledTimes(4);
    expect(t.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "canStake", args: [100n] }));
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("rechecks the exact post-transition stake amount before broadcast", async () => {
    const t = setup([zero], 13_000_000n, 0n, 200n);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockResolvedValue(sequentialResponse(t.progress, {
      ...t.progress, step: RebalanceStep.InitiateUnstake, stakeRemaining: 25n,
    }));
    let reads = 0;
    const original = t.readContract.getMockImplementation()!;
    t.readContract.mockImplementation((request: { functionName: string; args?: bigint[] }) => {
      if (request.functionName === "canStake" && request.args?.[0] === 25n) return Promise.resolve(++reads > 1);
      return original(request);
    });
    await expect(t.executor.rebalance()).rejects.toThrow("post-simulation canStake disagrees");
    expect(reads).toBe(2);
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it.each([
    "missing transactions", "truncated transactions", "extra transaction", "transaction hash",
    "missing gas", "malformed gas", "clamped gas", "increased gas", "wrong sender", "wrong recipient", "wrong input",
  ])("fails closed on sequential transaction integrity: %s", async (failure) => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    const response = sequentialResponse(t.progress, { ...t.progress, step: RebalanceStep.InitiateUnstake });
    const block = response[0]!;
    const tx = block.transactions[1]!;
    if (failure === "missing transactions") delete (block as { transactions?: unknown }).transactions;
    if (failure === "truncated transactions") block.transactions.pop();
    if (failure === "extra transaction") block.transactions.push({});
    if (failure === "transaction hash") (block.transactions as unknown[])[1] = hash;
    if (failure === "missing gas") delete (tx as { gas?: string }).gas;
    if (failure === "malformed gas") Object.assign(tx, { gas: "0x01" });
    if (failure === "clamped gas") Object.assign(tx, { gas: numberToHex(TX_GAS_CAP - 1n) });
    if (failure === "increased gas") Object.assign(tx, { gas: numberToHex(TX_GAS_CAP + 1n) });
    if (failure === "wrong sender") Object.assign(tx, { from: vault });
    if (failure === "wrong recipient") Object.assign(tx, { to: vault });
    if (failure === "wrong input") Object.assign(tx, { input: "0x" });
    t.request.mockResolvedValue(response);
    await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation failed");
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it.each([
    ["step", { step: RebalanceStep.InitiateUnstake }],
    ["stake remaining", { stakeRemaining: 101n }],
    ["unstake remaining", { unstakeRemaining: 1n }],
  ])("fails closed when the simulated initial %s disagrees with live context", async (_field, change) => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockResolvedValue(sequentialResponse({ ...t.progress, ...change }, {
      ...t.progress, step: RebalanceStep.InitiateUnstake,
    }));

    await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation state or result disagreement");
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed when the sequential rebalance outcome disagrees with eth_call", async () => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockResolvedValue(sequentialResponse(t.progress, {
      ...t.progress, step: RebalanceStep.InitiateUnstake,
    }, [0n, 0n, 0n, 99n]));

    await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation state or result disagreement");
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it.each(["missing blocks", "missing call", "failed status", "call error", "invalid return data", "invalid step"])(
    "fails closed on sequential simulation %s",
    async (failure) => {
      const t = setup([zero]);
      t.progress.step = RebalanceStep.FinalizeWithdrawals;
      const response = sequentialResponse(t.progress, { ...t.progress, step: RebalanceStep.InitiateUnstake });
      if (failure === "missing blocks") t.request.mockResolvedValue([]);
      else {
        if (failure === "missing call") response[0]!.calls.pop();
        if (failure === "failed status") response[0]!.calls[1]!.status = "0x0";
        if (failure === "call error") Object.assign(response[0]!.calls[1]!, { error: { message: "reverted" } });
        if (failure === "invalid return data") response[0]!.calls[2]!.returnData = "0x";
        if (failure === "invalid step") response[0]!.calls[2]!.returnData = encodeFunctionResult({
          abi: OllaCoreAbi, functionName: "rebalanceProgress", result: { ...t.progress, step: 255 },
        });
        t.request.mockResolvedValue(response);
      }

      await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation failed");
      expect(t.request).toHaveBeenCalledTimes(1);
      expect(t.writeContract).not.toHaveBeenCalled();
      expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
    },
  );

  it("fails closed when eth_simulateV1 is unsupported", async () => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockRejectedValue(new Error("method not found: eth_simulateV1"));

    await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation failed");
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it.each([
    ["reorg during simulation", 2, { number: 42n, hash: otherBlockHash }],
    ["new head during simulation", 3, { number: 43n, hash: otherBlockHash }],
    ["reorg before broadcast", 4, { number: 42n, hash: otherBlockHash }],
    ["new head before broadcast", 5, { number: 43n, hash: otherBlockHash }],
  ])("fails closed on %s", async (_label, changedCall, changedBlock) => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    let calls = 0;
    t.getBlock.mockImplementation(async () => ++calls === changedCall ? changedBlock : { number: 42n, hash: blockHash });

    await expect(t.executor.rebalance()).rejects.toThrow("sequential simulation");
    expect(t.writeContract).not.toHaveBeenCalled();
    expect(t.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.filter(([message]) =>
      typeof message === "string" && message.startsWith("[TxExecutor] rebalance simulation safety gate:"),
    )).toHaveLength(1);
  });

  it("rejects a missing canonical block identity before invoking sequential simulation", async () => {
    const t = setup([zero]);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.getBlock.mockResolvedValue({ number: 42n, hash: null });

    await expect(t.executor.rebalance()).rejects.toThrow("missing canonical block identity");
    expect(t.request).not.toHaveBeenCalled();
    expect(t.writeContract).not.toHaveBeenCalled();
  });

  it("tries a lower gas candidate after a verified no-op and sends the verified candidate", async () => {
    const t = setup([zero, zero], 13_000_000n, 0n, 200n);
    t.progress.step = RebalanceStep.FinalizeWithdrawals;
    t.request.mockResolvedValueOnce(sequentialResponse(t.progress, t.progress));

    expect(await t.executor.rebalance()).toBe(hash);
    expect(t.simulateContract.mock.calls.map(([request]) => request.gas)).toEqual([TX_GAS_CAP, 13_000_000n]);
    expect(t.request.mock.calls.map(([request]) => request.params[0].blockStateCalls[0].calls[1].gas)).toEqual([
      numberToHex(TX_GAS_CAP), numberToHex(13_000_000n),
    ]);
    expect(t.writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 13_000_000n }));
  });
});
