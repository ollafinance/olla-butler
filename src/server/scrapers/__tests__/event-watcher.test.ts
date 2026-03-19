import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventWatcher } from "../event-watcher.js";
import type { ContractAddresses, EventData } from "../../../types/index.js";
import * as stateModule from "../../state/index.js";

// Mock state module to capture updateEventData calls
vi.mock("../../state/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof stateModule>();
  return {
    ...mod,
    updateEventData: vi.fn(),
  };
});

vi.mock("../../state/attester-registry.js", () => ({
  addAttester: vi.fn(),
  removeAttester: vi.fn(),
}));

const mockAddresses: ContractAddresses = {
  core: "0x0000000000000000000000000000000000000001",
  vault: "0x0000000000000000000000000000000000000002",
  stAztec: "0x0000000000000000000000000000000000000003",
  stakingManager: "0x0000000000000000000000000000000000000004",
  rewardsAccumulator: "0x0000000000000000000000000000000000000005",
  safetyModule: "0x0000000000000000000000000000000000000006",
  withdrawalQueue: "0x0000000000000000000000000000000000000007",
  stakingProviderRegistry: "0x0000000000000000000000000000000000000008",
  asset: "0x0000000000000000000000000000000000000009",
  rollupRegistry: "0x000000000000000000000000000000000000000a",
  canonicalRollup: "0x000000000000000000000000000000000000000b",
};

function createMockClient(overrides: {
  blockNumber?: bigint;
  eventResults?: Record<string, unknown[]>;
  failingContracts?: Set<string>;
} = {}) {
  const blockNumber = overrides.blockNumber ?? 100n;
  const eventResults = overrides.eventResults ?? {};
  const failingContracts = overrides.failingContracts ?? new Set();

  return {
    getBlockNumber: vi.fn().mockResolvedValue(blockNumber),
    getContractEvents: vi.fn().mockImplementation(({ address }: { address: string }) => {
      if (failingContracts.has(address)) {
        return Promise.reject(new Error(`RPC error for ${address}`));
      }
      return Promise.resolve(eventResults[address] ?? []);
    }),
  } as unknown as import("viem").PublicClient;
}

describe("EventWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments deposit count and volume on Deposit event", async () => {
    const mockClient = createMockClient({
      blockNumber: 101n,
      eventResults: {
        [mockAddresses.vault]: [
          {
            eventName: "Deposit",
            args: { caller: "0x1", recipient: "0x2", assets: 5_000_000_000_000_000_000n, shares: 5n * 10n ** 18n },
            blockNumber: 101n,
          },
        ],
      },
    });

    const watcher = new EventWatcher("test", mockClient, mockAddresses);
    await watcher.init();

    // Advance block so scrape runs
    (mockClient.getBlockNumber as ReturnType<typeof vi.fn>).mockResolvedValue(102n);

    await watcher.scrape();

    const calls = (stateModule.updateEventData as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const data = calls[0]![1] as EventData;
    expect(data.depositCount).toBe(1);
    expect(data.depositVolume).toBe(5_000_000_000_000_000_000n);
  });

  it("increments circuit breaker counters by reason", async () => {
    const mockClient = createMockClient({
      blockNumber: 101n,
      eventResults: {
        [mockAddresses.safetyModule]: [
          { eventName: "CircuitBreakerTriggered", args: { reason: 0n }, blockNumber: 101n },
          { eventName: "CircuitBreakerTriggered", args: { reason: 1n }, blockNumber: 101n },
        ],
      },
    });

    const watcher = new EventWatcher("test", mockClient, mockAddresses);
    await watcher.init();
    (mockClient.getBlockNumber as ReturnType<typeof vi.fn>).mockResolvedValue(102n);

    await watcher.scrape();

    const calls = (stateModule.updateEventData as ReturnType<typeof vi.fn>).mock.calls;
    const data = calls[0]![1] as EventData;
    expect(data.circuitBreakerTriggeredCount).toBe(2);
    expect(data.circuitBreakerByReason.rateDrop).toBe(1);
    expect(data.circuitBreakerByReason.queueRatio).toBe(1);
    expect(data.circuitBreakerByReason.accountingStale).toBe(0);
  });

  it("handles partial failures without blocking other contracts", async () => {
    const mockClient = createMockClient({
      blockNumber: 101n,
      failingContracts: new Set([mockAddresses.core, mockAddresses.stakingManager]),
      eventResults: {
        [mockAddresses.vault]: [
          {
            eventName: "Deposit",
            args: { caller: "0x1", recipient: "0x2", assets: 1n * 10n ** 18n, shares: 1n * 10n ** 18n },
            blockNumber: 101n,
          },
        ],
      },
    });

    const watcher = new EventWatcher("test", mockClient, mockAddresses);
    await watcher.init();
    (mockClient.getBlockNumber as ReturnType<typeof vi.fn>).mockResolvedValue(102n);

    // Should not throw
    await watcher.scrape();

    const calls = (stateModule.updateEventData as ReturnType<typeof vi.fn>).mock.calls;
    const data = calls[0]![1] as EventData;
    // Deposit from vault still recorded despite core/staking failures
    expect(data.depositCount).toBe(1);
  });

  it("caps block range to MAX_BLOCK_RANGE", async () => {
    const mockClient = createMockClient({ blockNumber: 100n });

    const watcher = new EventWatcher("test", mockClient, mockAddresses);
    await watcher.init();

    // Jump far ahead
    (mockClient.getBlockNumber as ReturnType<typeof vi.fn>).mockResolvedValue(20_000n);

    await watcher.scrape();

    // Verify getContractEvents was called with capped range
    const getContractEventsCalls = (mockClient.getContractEvents as ReturnType<typeof vi.fn>).mock.calls;
    expect(getContractEventsCalls.length).toBeGreaterThan(0);
    const firstCall = getContractEventsCalls[0]![0] as { fromBlock: bigint; toBlock: bigint };
    // fromBlock should be 20000 - 10000 = 10000
    expect(firstCall.fromBlock).toBe(10_000n);
    expect(firstCall.toBlock).toBe(20_000n);
  });
});
