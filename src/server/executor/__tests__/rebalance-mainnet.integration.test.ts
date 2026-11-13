import { describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  numberToHex,
  type Account,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";
import { OllaCoreAbi } from "../../../types/olla-abis.js";
import { OllaCoreWriteAbi } from "../../../types/write-abis.js";
import { RebalanceStep, type ContractAddresses } from "../../../types/index.js";
import { TransactionExecutor } from "../tx-executor.js";

// RUN_REBALANCE_MAINNET_INTEGRATION=1 npx vitest run src/server/executor/__tests__/rebalance-mainnet.integration.test.ts
// Optional: REBALANCE_MAINNET_RPC_URL can select another archive RPC supporting eth_simulateV1.
const enabled = process.env.RUN_REBALANCE_MAINNET_INTEGRATION === "1";
const rpcUrl = process.env.REBALANCE_MAINNET_RPC_URL ?? "https://eth.drpc.org";
const blockNumber = 26_409_125n;
const blockHash = "0x1d30633227f6e7978c9eb4844b9096379c9c7b2acadef5ea56aeab8ebc3ad46e";
const core = "0x376d61a13d3b98817c53f8fb0916718183723409";
const implementation = "0x5219d4d59d729e385514af2cef24b3fdf53c38f8";
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const caller = "0x0000000000000000000000000000000000000001";
const outcome = [0n, 0n, 0n, 37_943_580_716_528_410_414_506n] as const;
const implementationCodeHash = "0xad47bc8f38104bf2a38abc1d0292669c062c568629a5ff67b20ced7bf7b9afca";

// Verified deployment source: https://eth.blockscout.com/address/0x5219d4d59d729e385514af2cef24b3fdf53c38f8?tab=contract
// The proxy's historical ERC-1967 slot and runtime code are checked below, not local source files.
describe.skipIf(!enabled)("mainnet rebalance semantic gate", () => {
  it("rejects a 180k no-op and accepts a 1M state advance with the same zero-economic tuple", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }) });
    // Never expose a potentially credential-bearing RPC URL through viem errors.
    const rpc = async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch {
        throw new Error("Mainnet archive RPC request failed (endpoint details redacted)");
      }
    };

    expect(await rpc(() => client.getChainId())).toBe(1);
    const block = await rpc(() => client.getBlock({ blockNumber }));
    expect(block.hash).toBe(blockHash);
    const slot = await rpc(() => client.getStorageAt({ address: core, slot: implementationSlot, blockNumber }));
    expect(slot?.toLowerCase()).toBe(`0x${"0".repeat(24)}${implementation.slice(2)}`);
    const bytecode = await rpc(() => client.getCode({ address: implementation, blockNumber }));
    expect(bytecode).toBeDefined();
    expect(keccak256(bytecode!)).toBe(implementationCodeHash);

    const [vault, stakingManager] = await Promise.all([
      rpc(() => client.readContract({ address: core, abi: OllaCoreAbi, functionName: "vault", blockNumber })),
      rpc(() => client.readContract({ address: core, abi: OllaCoreAbi, functionName: "stakingManager", blockNumber })),
    ]);
    const progressData = encodeFunctionData({ abi: OllaCoreAbi, functionName: "rebalanceProgress" });
    const rebalanceData = encodeFunctionData({ abi: OllaCoreWriteAbi, functionName: "rebalance" });
    const simulations = await Promise.all([180_000n, 1_000_000n].map(async (gas) => {
      const ordinary = await rpc(() => client.call({ account: caller, to: core, data: rebalanceData, gas, blockNumber }));
      const blocks = await rpc(() => client.request({
        method: "eth_simulateV1",
        params: [{ blockStateCalls: [{ calls: [
          { from: caller, to: core, data: progressData },
          { from: caller, to: core, data: rebalanceData, gas: numberToHex(gas) },
          { from: caller, to: core, data: progressData },
        ] }], validation: false }, numberToHex(blockNumber)],
      }));
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.calls).toHaveLength(3);
      for (const call of blocks[0]!.calls) {
        expect(call.status).toBe("0x1");
        expect(call.error).toBeUndefined();
      }
      const [before, rebalance, after] = blocks[0]!.calls;
      return {
        before: decodeFunctionResult({ abi: OllaCoreAbi, functionName: "rebalanceProgress", data: before!.returnData }),
        outcome: decodeFunctionResult({ abi: OllaCoreWriteAbi, functionName: "rebalance", data: rebalance!.returnData }),
        ordinary: decodeFunctionResult({ abi: OllaCoreWriteAbi, functionName: "rebalance", data: ordinary.data! }),
        after: decodeFunctionResult({ abi: OllaCoreAbi, functionName: "rebalanceProgress", data: after!.returnData }),
      };
    }));
    const [low, high] = simulations;
    const historicalProgress = await rpc(() => client.readContract({
      address: core, abi: OllaCoreAbi, functionName: "rebalanceProgress", blockNumber,
    }));
    expect(low!.before).toEqual(historicalProgress);
    expect(low!.before).toEqual(high!.before);
    expect(low!.before.step).toBe(RebalanceStep.FinalizeWithdrawals);
    expect(low!.outcome).toEqual(outcome);
    expect(high!.outcome).toEqual(outcome);
    expect(low!.ordinary).toEqual(low!.outcome);
    expect(high!.ordinary).toEqual(high!.outcome);
    expect(low!.after).toEqual(low!.before);
    expect(high!.after.step).toBeGreaterThan(high!.before.step);

    const executor = new TransactionExecutor({
      rpcUrl: "http://127.0.0.1:8545", chainId: 1, privateKey: `0x${"1".repeat(64)}`,
      addresses: { core, vault, stakingManager } as ContractAddresses,
    });
    // Exercise the production gate at the pinned historical state. Estimation and the
    // wallet are stubbed; a selected candidate cannot be signed or broadcast.
    const writeContract = vi.fn().mockResolvedValue(`0x${"a".repeat(64)}`);
    const executorCaller = executor.getExecutorAddress();
    const historicalClient = {
      estimateContractGas: vi.fn().mockResolvedValue(1_000_000n),
      readContract: (args: Parameters<typeof client.readContract>[0]) => rpc(() => client.readContract({ ...args, blockNumber })),
      simulateContract: vi.fn((args: { account: Account; address: Address; abi: typeof OllaCoreWriteAbi; functionName: "rebalance"; args: readonly []; gas: bigint }) =>
        rpc(() => client.simulateContract({ ...args, blockNumber }))),
      getBlock: () => rpc(() => client.getBlock({ blockNumber })),
      request: vi.fn((args: Parameters<typeof client.request>[0]) => rpc(() => client.request(args))),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber, gasUsed: 0n }),
    };
    Object.assign(executor, { publicClient: historicalClient, walletClient: { writeContract } });
    const logs = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    try {
      expect(await executor.rebalance()).toBe(`0x${"a".repeat(64)}`);
      expect(historicalClient.simulateContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        account: expect.objectContaining({ address: executorCaller }), address: getAddress(core),
        abi: OllaCoreWriteAbi, functionName: "rebalance", args: [], gas: 1_300_000n,
      }));
      expect(historicalClient.request).toHaveBeenCalledTimes(1);
      const request = historicalClient.request.mock.calls[0]![0];
      expect(request).toMatchObject({
        method: "eth_simulateV1",
        params: [{ blockStateCalls: [{ calls: [
          { from: executorCaller, to: getAddress(core), data: progressData },
          { from: executorCaller, to: getAddress(core), data: rebalanceData, gas: numberToHex(1_300_000n) },
          { from: executorCaller, to: getAddress(core), data: progressData },
        ] }], validation: false, returnFullTransactions: true }, numberToHex(blockNumber)],
      });
      const blocks = await historicalClient.request.mock.results[0]!.value;
      expect(blocks[0]!.transactions![1]).toMatchObject({ gas: numberToHex(1_300_000n) });
      expect(writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        account: expect.objectContaining({ address: executorCaller }), address: getAddress(core),
        abi: OllaCoreWriteAbi, functionName: "rebalance", args: [], gas: 1_300_000n,
      }));
    } finally {
      logs.forEach((log) => log.mockRestore());
    }
    expect((await rpc(() => client.getBlock({ blockNumber }))).hash).toBe(blockHash);
  }, 120_000);
});
