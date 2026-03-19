/**
 * Event-derived attester address registry.
 *
 * Maintains a per-network set of known attester addresses by replaying
 * StakedWithProvider (add) and AttesterRemoved (remove) events.
 * On startup, scans historical events from a configurable start block.
 * After init, kept in sync by the EventWatcher.
 */

import { type Address, type PublicClient } from "viem";
import { StakingManagerEventAbi } from "../../types/index.js";

const registries = new Map<string, Set<string>>();

const getRegistry = (network: string): Set<string> => {
  let reg = registries.get(network);
  if (!reg) {
    reg = new Set();
    registries.set(network, reg);
  }
  return reg;
};

export const addAttester = (network: string, address: string): void => {
  getRegistry(network).add(address.toLowerCase());
};

export const removeAttester = (network: string, address: string): void => {
  getRegistry(network).delete(address.toLowerCase());
};

export const getAttesters = (network: string): string[] => {
  return Array.from(getRegistry(network));
};

export const getAttesterCount = (network: string): number => {
  return getRegistry(network).size;
};

const SCAN_CHUNK_SIZE = 10_000n;

/**
 * Scans historical events to build the initial attester set.
 * Replays StakedWithProvider (adds) and AttesterRemoved (removes) in order.
 */
export const initAttesterRegistry = async (
  network: string,
  client: PublicClient,
  stakingManagerAddress: Address,
  startBlock: bigint,
): Promise<void> => {
  const currentBlock = await client.getBlockNumber();
  console.log(
    `[attester-registry/${network}] Scanning events from block ${startBlock} to ${currentBlock}...`,
  );

  let fromBlock = startBlock;
  let totalStaked = 0;
  let totalRemoved = 0;

  while (fromBlock <= currentBlock) {
    const toBlock = fromBlock + SCAN_CHUNK_SIZE - 1n > currentBlock
      ? currentBlock
      : fromBlock + SCAN_CHUNK_SIZE - 1n;

    const events = await client.getContractEvents({
      address: stakingManagerAddress,
      abi: StakingManagerEventAbi,
      fromBlock,
      toBlock,
    });

    for (const event of events) {
      if (event.eventName === "StakedWithProvider") {
        const attester = (event.args as { attester: string }).attester;
        addAttester(network, attester);
        totalStaked++;
      } else if (event.eventName === "AttesterRemoved") {
        const attester = (event.args as { attester: string }).attester;
        removeAttester(network, attester);
        totalRemoved++;
      }
    }

    fromBlock = toBlock + 1n;
  }

  const count = getAttesterCount(network);
  console.log(
    `[attester-registry/${network}] Init complete: ${count} attester(s) tracked ` +
    `(${totalStaked} staked, ${totalRemoved} removed)`,
  );
};
