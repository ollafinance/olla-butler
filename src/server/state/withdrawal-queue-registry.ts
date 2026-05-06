/**
 * Event-derived counter for finalized-but-unclaimed withdrawal requests.
 *
 * The on-chain WithdrawalQueue exposes `nextRequestId` (assigned + 1) and
 * `nextPendingId == nextUnfinalized` (next to finalize), but does NOT
 * expose an aggregate for unclaimed requests — claim state lives on the
 * per-request struct only. To track it without per-request RPC scans we
 * fold the per-event deltas:
 *   WithdrawalFinalized → +1 count, +assets
 *   WithdrawalClaimed   → -1 count, -assetsExpected (== finalized assets)
 *
 * On startup the counter is rebuilt by replaying historical events from a
 * configured start block. After init, the WS event listener keeps it
 * current. A small boundary window between scan-end and subscribe-active
 * may drift by a few events; acceptable for monitoring purposes.
 */

import { type Address, type PublicClient } from "viem";
import { WithdrawalQueueEventAbi } from "../../types/index.js";

type Counters = {
  unclaimedCount: number;
  unclaimedAssets: bigint;
  initialized: boolean;
};

const counters = new Map<string, Counters>();

const getCounters = (network: string): Counters => {
  let c = counters.get(network);
  if (!c) {
    c = { unclaimedCount: 0, unclaimedAssets: 0n, initialized: false };
    counters.set(network, c);
  }
  return c;
};

export const incrementUnclaimed = (network: string, assets: bigint): void => {
  const c = getCounters(network);
  c.unclaimedCount += 1;
  c.unclaimedAssets += assets;
};

export const decrementUnclaimed = (network: string, assets: bigint): void => {
  const c = getCounters(network);
  // Floor at 0 to survive any boundary-window drift; reconciliation would
  // need a per-request scan.
  c.unclaimedCount = Math.max(0, c.unclaimedCount - 1);
  c.unclaimedAssets = c.unclaimedAssets > assets ? c.unclaimedAssets - assets : 0n;
};

export const getUnclaimedCount = (network: string): number => {
  return getCounters(network).unclaimedCount;
};

export const getUnclaimedAssets = (network: string): bigint => {
  return getCounters(network).unclaimedAssets;
};

export const isUnclaimedRegistryInitialized = (network: string): boolean => {
  return getCounters(network).initialized;
};

const SCAN_CHUNK_SIZE = 10_000n;

/**
 * Scans historical WithdrawalQueue events to build the initial unclaimed
 * counter. Replays Finalized (adds) and Claimed (removes) in order.
 */
export const initWithdrawalQueueRegistry = async (
  network: string,
  client: PublicClient,
  withdrawalQueueAddress: Address,
  startBlock: bigint,
): Promise<void> => {
  const currentBlock = await client.getBlockNumber();
  console.log(
    `[withdrawal-queue-registry/${network}] Scanning events from block ${startBlock} to ${currentBlock}...`,
  );

  const c = getCounters(network);
  let fromBlock = startBlock;
  let totalFinalized = 0;
  let totalClaimed = 0;

  while (fromBlock <= currentBlock) {
    const toBlock =
      fromBlock + SCAN_CHUNK_SIZE - 1n > currentBlock
        ? currentBlock
        : fromBlock + SCAN_CHUNK_SIZE - 1n;

    const events = await client.getContractEvents({
      address: withdrawalQueueAddress,
      abi: WithdrawalQueueEventAbi,
      fromBlock,
      toBlock,
    });

    for (const event of events) {
      if (event.eventName === "WithdrawalFinalized") {
        const assets = (event.args as { assets: bigint }).assets;
        c.unclaimedCount += 1;
        c.unclaimedAssets += assets;
        totalFinalized++;
      } else if (event.eventName === "WithdrawalClaimed") {
        const assets = (event.args as { assetsExpected: bigint }).assetsExpected;
        c.unclaimedCount = Math.max(0, c.unclaimedCount - 1);
        c.unclaimedAssets = c.unclaimedAssets > assets ? c.unclaimedAssets - assets : 0n;
        totalClaimed++;
      }
    }

    fromBlock = toBlock + 1n;
  }

  c.initialized = true;
  console.log(
    `[withdrawal-queue-registry/${network}] Init complete: ${c.unclaimedCount} unclaimed ` +
      `(${totalFinalized} finalized, ${totalClaimed} claimed historically)`,
  );
};
