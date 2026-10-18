import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  TX_GAS_CAP,
  GAS_CAPPED_CHAIN_IDS,
  isGasCappedChain,
  calculateGasLimit,
  type GasLimitResult,
} from "../tx-executor.js";
import { TransactionExecutor } from "../tx-executor.js";
import type { ContractAddresses } from "../../../types/index.js";

const FOUNDRY_PRIVATE_KEY = `0x${"1".repeat(64)}`;
const RPC_URL = "http://127.0.0.1:8545";

function makeExecutor(chainId: number): TransactionExecutor {
  return new TransactionExecutor({
    rpcUrl: RPC_URL,
    chainId,
    privateKey: FOUNDRY_PRIVATE_KEY,
    addresses: {} as ContractAddresses,
  });
}

function mockEstimate(executor: TransactionExecutor, estimate: bigint): void {
  (executor as any).publicClient = {
    estimateContractGas: vi.fn().mockResolvedValue(estimate),
  } as any;
}

describe("EIP-7825 gas cap constants", () => {
  it("TX_GAS_CAP is exactly 2^24 = 16,777,216", () => {
    expect(TX_GAS_CAP).toBe(16_777_216n);
    expect(TX_GAS_CAP).toBe(2n ** 24n);
  });

  it("marks mainnet (1) and Sepolia (11155111) as capped, not Foundry (31337)", () => {
    expect(isGasCappedChain(1)).toBe(true);
    expect(isGasCappedChain(11155111)).toBe(true);
    expect(isGasCappedChain(31337)).toBe(false);
    expect(GAS_CAPPED_CHAIN_IDS).toContain(1);
    expect(GAS_CAPPED_CHAIN_IDS).toContain(11155111);
    expect(GAS_CAPPED_CHAIN_IDS).not.toContain(31337);
  });
});

describe("calculateGasLimit (pure)", () => {
  it("keeps an estimate below the floor at the floor", () => {
    const result = calculateGasLimit({
      estimate: 100n,
      floor: 500_000n,
      chainId: 1,
    });
    expect(result.buffered).toBe(100n);
    expect(result.floored).toBe(500_000n);
    expect(result.gas).toBe(500_000n);
    expect(result.capped).toBe(false);
    expect(result.cap).toBe(16_777_216n);
  });

  it("keeps floor even when a buffer is configured", () => {
    const result = calculateGasLimit({
      estimate: 100n,
      floor: 500_000n,
      bufferBp: 13_000n,
      chainId: 1,
    });
    expect(result.buffered).toBe(130n); // ceil(100 * 1.3)
    expect(result.floored).toBe(500_000n);
    expect(result.gas).toBe(500_000n);
    expect(result.capped).toBe(false);
  });

  it("applies ceiling-rounded buffer below the cap unchanged", () => {
    // 10,000,000 * 130% = 13,000,000, below the cap
    const result = calculateGasLimit({
      estimate: 10_000_000n,
      floor: 500_000n,
      bufferBp: 13_000n,
      chainId: 1,
    });
    expect(result.buffered).toBe(13_000_000n);
    expect(result.floored).toBe(13_000_000n);
    expect(result.gas).toBe(13_000_000n);
    expect(result.capped).toBe(false);
  });

  it("clamps a buffered estimate above the cap to the cap", () => {
    // 13,000,000 * 130% = 16,900,000, above the cap
    const result = calculateGasLimit({
      estimate: 13_000_000n,
      floor: 500_000n,
      bufferBp: 13_000n,
      chainId: 1,
    });
    expect(result.buffered).toBe(16_900_000n);
    expect(result.floored).toBe(16_900_000n);
    expect(result.gas).toBe(16_777_216n);
    expect(result.capped).toBe(true);
    expect(result.cap).toBe(16_777_216n);
  });

  it("does not clamp when the selected limit is exactly the cap", () => {
    const result = calculateGasLimit({
      estimate: 16_777_216n,
      floor: 500_000n,
      chainId: 1,
    });
    expect(result.floored).toBe(16_777_216n);
    expect(result.gas).toBe(16_777_216n);
    expect(result.capped).toBe(false);
  });

  it("clamps one above the cap, proving the max is exactly 16,777,216", () => {
    const result = calculateGasLimit({
      estimate: 16_777_217n,
      floor: 500_000n,
      chainId: 1,
    });
    expect(result.floored).toBe(16_777_217n);
    expect(result.gas).toBe(16_777_216n);
    expect(result.capped).toBe(true);
  });

  it("never exceeds the cap for any estimate above it on a capped chain", () => {
    const estimates = [
      16_777_217n,
      16_900_000n,
      20_000_000n,
      100_000_000n,
      1_000_000_000n,
    ];
    for (const estimate of estimates) {
      const result = calculateGasLimit({
        estimate,
        floor: 500_000n,
        bufferBp: 13_000n,
        chainId: 1,
      });
      expect(result.gas).toBe(16_777_216n);
      expect(result.capped).toBe(true);
      expect(result.gas).toBeLessThanOrEqual(TX_GAS_CAP);
    }
  });

  it("applies the cap on Sepolia (11155111)", () => {
    const result = calculateGasLimit({
      estimate: 20_000_000n,
      floor: 500_000n,
      bufferBp: 13_000n,
      chainId: 11155111,
    });
    expect(result.gas).toBe(16_777_216n);
    expect(result.capped).toBe(true);
  });

  it("leaves local Foundry (31337) uncapped even above the cap", () => {
    const result = calculateGasLimit({
      estimate: 20_000_000n,
      floor: 500_000n,
      bufferBp: 13_000n,
      chainId: 31337,
    });
    expect(result.buffered).toBe(26_000_000n);
    expect(result.floored).toBe(26_000_000n);
    expect(result.cap).toBeUndefined();
    expect(result.capped).toBe(false);
    expect(result.gas).toBe(26_000_000n);
  });
});

describe("TransactionExecutor gas clamping", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clamps gas on mainnet and logs selected limit and cap", async () => {
    const executor = makeExecutor(1);
    mockEstimate(executor, 13_000_000n);

    const { gas } = await (executor as any).estimateGasWithFloor({
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "whatever",
      bufferBp: 13_000n,
    });

    expect(gas).toBe(16_777_216n);
    const messages = logSpy.mock.calls.map((args: unknown[]) => args.join(" "));
    expect(
      messages.some((m: string) => m.includes("16900000") && m.includes("16777216")),
    ).toBe(true);
  });

  it("does not clamp and does not emit a clamp log below the cap", async () => {
    const executor = makeExecutor(1);
    mockEstimate(executor, 100n);

    const { gas } = await (executor as any).estimateGasWithFloor({
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "whatever",
      floor: 500_000n,
    });

    expect(gas).toBe(500_000n);
    const messages = logSpy.mock.calls.map((args: unknown[]) => args.join(" "));
    expect(messages.some((m: string) => m.includes("clamped by EIP-7825 cap"))).toBe(false);
  });

  it("does not clamp local Foundry (31337) above the cap", async () => {
    const executor = makeExecutor(31337);
    mockEstimate(executor, 20_000_000n);

    const { gas } = await (executor as any).estimateGasWithFloor({
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "whatever",
      bufferBp: 13_000n,
    });

    expect(gas).toBe(26_000_000n);
    const messages = logSpy.mock.calls.map((args: unknown[]) => args.join(" "));
    expect(messages.some((m: string) => m.includes("clamped by EIP-7825 cap"))).toBe(false);
  });

  it("applies the cap on Sepolia (11155111) through the executor", async () => {
    const executor = makeExecutor(11155111);
    mockEstimate(executor, 20_000_000n);

    const { gas } = await (executor as any).estimateGasWithFloor({
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "whatever",
      bufferBp: 13_000n,
    });

    expect(gas).toBe(16_777_216n);
    const messages = logSpy.mock.calls.map((args: unknown[]) => args.join(" "));
    expect(
      messages.some((m: string) => m.includes("26000000") && m.includes("16777216")),
    ).toBe(true);
  });
});
