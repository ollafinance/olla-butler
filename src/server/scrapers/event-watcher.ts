import { type Address, type PublicClient, formatEther } from "viem";
import { AbstractScraper } from "./base-scraper.js";
import type { ContractAddresses, EventData, RecentEvent } from "../../types/index.js";
import {
  OllaCoreEventAbi,
  OllaVaultEventAbi,
  SafetyModuleEventAbi,
  StakingManagerEventAbi,
  WithdrawalQueueEventAbi,
  RewardsAccumulatorEventAbi,
} from "../../types/index.js";
import { updateEventData } from "../state/index.js";
import { pushEvents } from "../state/event-log.js";
import { addAttester, removeAttester } from "../state/attester-registry.js";
import { getDataDir } from "../../core/config/index.js";
import fs from "fs/promises";
import path from "node:path";

const BREAKER_REASONS = ["RateDrop", "QueueRatio", "AccountingStale"] as const;
const MAX_BLOCK_RANGE = 10_000n;

/** Interval between disk flushes of lastProcessedBlock (every 10 scrape cycles) */
const PERSIST_INTERVAL = 10;

function createEmptyEventData(): EventData {
  return {
    lastProcessedBlock: 0n,
    circuitBreakerTriggeredCount: 0,
    circuitBreakerByReason: { rateDrop: 0, queueRatio: 0, accountingStale: 0 },
    negativeRewardsPeriodCount: 0,
    safetyPausedCount: 0,
    safetyUnpausedCount: 0,
    depositCount: 0,
    depositVolume: 0n,
    redeemRequestCount: 0,
    redeemRequestVolume: 0n,
    instantRedemptionCount: 0,
    instantRedemptionVolume: 0n,
    instantRedemptionFees: 0n,
    withdrawalClaimCount: 0,
    withdrawalClaimVolume: 0n,
    rebalanceCount: 0,
    accountingUpdateCount: 0,
    rewardsHarvestedVolume: 0n,
    stakedCount: 0,
    stakedVolume: 0n,
    unstakeInitiatedCount: 0,
    unstakeInitiatedVolume: 0n,
    unstakeFinalizedCount: 0,
    unstakeFinalizedVolume: 0n,
    attesterRefreshCount: 0,
    attesterRefreshBalanceChangeCount: 0,
    withdrawalRequestedCount: 0,
    withdrawalRequestedVolume: 0n,
    withdrawalFinalizedCount: 0,
    withdrawalFinalizedVolume: 0n,
    withdrawalAdjustedCount: 0,
    configChangeCount: 0,
    lastUpdated: new Date(),
  };
}

/**
 * Polls on-chain events from all Olla protocol contracts.
 * Tracks event counts and volumes for Prometheus metrics.
 * Logs critical safety events (circuit breakers, slashing) immediately.
 */
export class EventWatcher extends AbstractScraper {
  readonly name = "event-watcher";
  readonly network: string;

  private readonly client: PublicClient;
  private readonly addresses: ContractAddresses;
  private lastProcessedBlock = 0n;
  private eventData: EventData;
  private scrapesSinceLastPersist = 0;

  constructor(network: string, client: PublicClient, addresses: ContractAddresses) {
    super();
    this.network = network;
    this.client = client;
    this.addresses = addresses;
    this.eventData = createEmptyEventData();
  }

  private get checkpointPath(): string {
    return path.join(getDataDir(), `event-watcher-${this.network}.json`);
  }

  private async loadCheckpoint(): Promise<bigint | null> {
    try {
      const data = await fs.readFile(this.checkpointPath, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed.lastProcessedBlock) {
        return BigInt(parsed.lastProcessedBlock);
      }
    } catch {
      // No checkpoint file or invalid — start fresh
    }
    return null;
  }

  private async saveCheckpoint(): Promise<void> {
    try {
      const dir = path.dirname(this.checkpointPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        this.checkpointPath,
        JSON.stringify({ lastProcessedBlock: this.lastProcessedBlock.toString() }),
      );
    } catch (error) {
      console.warn(`[${this.name}/${this.network}] Failed to save checkpoint:`, error);
    }
  }

  async init(): Promise<void> {
    const checkpoint = await this.loadCheckpoint();
    if (checkpoint !== null) {
      this.lastProcessedBlock = checkpoint;
      console.log(
        `[${this.name}/${this.network}] Resuming event monitoring from checkpoint block ${this.lastProcessedBlock}`,
      );
    } else {
      this.lastProcessedBlock = await this.client.getBlockNumber();
      console.log(
        `[${this.name}/${this.network}] Starting event monitoring from block ${this.lastProcessedBlock}`,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecentEvent(log: any, contract: string, blockTimestamps: Map<bigint, Date>): RecentEvent {
    const args: Record<string, string> = {};
    if (log.args) {
      for (const [key, value] of Object.entries(log.args)) {
        if (typeof value === "bigint") {
          // Format wei values as human-readable where likely (heuristic: > 1e15 is probably wei)
          args[key] = value > 1_000_000_000_000_000n
            ? `${formatEther(value)} (${value.toString()})`
            : value.toString();
        } else {
          args[key] = String(value);
        }
      }
    }
    return {
      eventName: log.eventName,
      contract,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      timestamp: blockTimestamps.get(log.blockNumber) ?? new Date(),
      args,
    };
  }

  /**
   * Fetches block timestamps for all unique block numbers in the event logs.
   * Uses parallel fetching with deduplication to minimize RPC calls.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchBlockTimestamps(allLogs: any[][]): Promise<Map<bigint, Date>> {
    const blockNumbers = new Set<bigint>();
    for (const logs of allLogs) {
      for (const log of logs) {
        if (log.blockNumber != null) {
          blockNumbers.add(log.blockNumber);
        }
      }
    }

    const timestamps = new Map<bigint, Date>();
    if (blockNumbers.size === 0) return timestamps;

    const results = await Promise.allSettled(
      Array.from(blockNumbers).map(async (blockNumber) => {
        const block = await this.client.getBlock({ blockNumber });
        return { blockNumber, timestamp: Number(block.timestamp) };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        timestamps.set(
          result.value.blockNumber,
          new Date(result.value.timestamp * 1000),
        );
      }
    }

    return timestamps;
  }

  async scrape(): Promise<void> {
    const currentBlock = await this.client.getBlockNumber();
    if (currentBlock <= this.lastProcessedBlock) return;

    const gap = currentBlock - this.lastProcessedBlock;
    if (gap > MAX_BLOCK_RANGE) {
      console.log(
        `[${this.name}/${this.network}] Catching up ${gap} blocks (${Math.ceil(Number(gap) / Number(MAX_BLOCK_RANGE))} chunks)...`,
      );
      // Process in chunks to stay within RPC limits
      let chunkFrom = this.lastProcessedBlock + 1n;
      while (chunkFrom <= currentBlock) {
        const chunkTo = chunkFrom + MAX_BLOCK_RANGE - 1n < currentBlock
          ? chunkFrom + MAX_BLOCK_RANGE - 1n
          : currentBlock;
        await this.scrapeRange(chunkFrom, chunkTo);
        this.lastProcessedBlock = chunkTo;
        this.eventData.lastProcessedBlock = chunkTo;
        chunkFrom = chunkTo + 1n;
      }
      this.eventData.lastUpdated = new Date();
      updateEventData(this.network, { ...this.eventData });
      await this.saveCheckpoint();
      console.log(`[${this.name}/${this.network}] Catch-up complete at block ${currentBlock}`);
      return;
    }

    await this.scrapeRange(this.lastProcessedBlock + 1n, currentBlock);

    // Update state
    this.lastProcessedBlock = currentBlock;
    this.eventData.lastProcessedBlock = currentBlock;
    this.eventData.lastUpdated = new Date();
    updateEventData(this.network, { ...this.eventData });

    // Periodically persist checkpoint to disk so events aren't lost on restart
    this.scrapesSinceLastPersist++;
    if (this.scrapesSinceLastPersist >= PERSIST_INTERVAL) {
      this.scrapesSinceLastPersist = 0;
      await this.saveCheckpoint();
    }
  }

  private async scrapeRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const blockRange = { fromBlock, toBlock };
    const addr = this.addresses;
    const recentEvents: RecentEvent[] = [];

    const [coreResult, vaultResult, safetyResult, stakingResult, wqResult, raResult] =
      await Promise.allSettled([
        this.client.getContractEvents({
          address: addr.core as Address,
          abi: OllaCoreEventAbi,
          strict: true,
          ...blockRange,
        }),
        this.client.getContractEvents({
          address: addr.vault as Address,
          abi: OllaVaultEventAbi,
          strict: true,
          ...blockRange,
        }),
        this.client.getContractEvents({
          address: addr.safetyModule as Address,
          abi: SafetyModuleEventAbi,
          strict: true,
          ...blockRange,
        }),
        this.client.getContractEvents({
          address: addr.stakingManager as Address,
          abi: StakingManagerEventAbi,
          strict: true,
          ...blockRange,
        }),
        this.client.getContractEvents({
          address: addr.withdrawalQueue as Address,
          abi: WithdrawalQueueEventAbi,
          strict: true,
          ...blockRange,
        }),
        this.client.getContractEvents({
          address: addr.rewardsAccumulator as Address,
          abi: RewardsAccumulatorEventAbi,
          strict: true,
          ...blockRange,
        }),
      ]);

    let totalEvents = 0;

    // Fetch block timestamps for all events (for accurate historical timestamps)
    const allFulfilledLogs = [coreResult, vaultResult, safetyResult, stakingResult, wqResult, raResult]
      .filter((r): r is PromiseFulfilledResult<typeof coreResult extends PromiseSettledResult<infer T> ? T : never> => r.status === "fulfilled")
      .map((r) => r.value);
    const blockTimestamps = await this.fetchBlockTimestamps(allFulfilledLogs);

    // -- Core events --
    if (coreResult.status === "fulfilled") {
      totalEvents += coreResult.value.length;
      for (const log of coreResult.value) {
        recentEvents.push(this.toRecentEvent(log, "OllaCore", blockTimestamps));
        switch (log.eventName) {
          case "AccountingUpdated":
            this.eventData.accountingUpdateCount++;
            break;
          case "Rebalanced":
            this.eventData.rebalanceCount++;
            break;
          case "NegativeRewardsPeriod":
            this.eventData.negativeRewardsPeriodCount++;
            console.warn(
              `[${this.name}/${this.network}] WARNING: NegativeRewardsPeriod detected at block ${log.blockNumber}`,
            );
            break;
          case "RebalanceReset":
            console.warn(
              `[${this.name}/${this.network}] WARNING: RebalanceReset at block ${log.blockNumber}`,
            );
            break;
          case "ProtocolFeeUpdated":
          case "TreasuryFeeSplitUpdated":
          case "TargetBufferedAssetsUpdated":
          case "RebalanceGasThresholdUpdated":
          case "SafetyModuleUpdated":
          case "RebalanceCooldownUpdated":
            this.eventData.configChangeCount++;
            console.log(
              `[${this.name}/${this.network}] Config change: ${log.eventName} at block ${log.blockNumber}`,
            );
            break;
        }
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll core events:`,
        coreResult.reason,
      );
    }

    // -- Vault events --
    if (vaultResult.status === "fulfilled") {
      totalEvents += vaultResult.value.length;
      for (const log of vaultResult.value) {
        recentEvents.push(this.toRecentEvent(log, "Vault", blockTimestamps));
        switch (log.eventName) {
          case "Deposit":
            this.eventData.depositCount++;
            this.eventData.depositVolume += log.args.assets;
            break;
          case "RedeemRequest":
            this.eventData.redeemRequestCount++;
            this.eventData.redeemRequestVolume += log.args.assets;
            break;
          case "InstantRedemption":
            this.eventData.instantRedemptionCount++;
            this.eventData.instantRedemptionVolume += log.args.grossAssets;
            this.eventData.instantRedemptionFees += log.args.fee;
            break;
          case "WithdrawalClaimed":
            this.eventData.withdrawalClaimCount++;
            this.eventData.withdrawalClaimVolume += log.args.assets;
            break;
          case "InstantRedemptionFeeUpdated":
            this.eventData.configChangeCount++;
            console.log(
              `[${this.name}/${this.network}] Config change: ${log.eventName} at block ${log.blockNumber}`,
            );
            break;
        }
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll vault events:`,
        vaultResult.reason,
      );
    }

    // -- Safety module events --
    if (safetyResult.status === "fulfilled") {
      totalEvents += safetyResult.value.length;
      for (const log of safetyResult.value) {
        const recentEvent = this.toRecentEvent(log, "SafetyModule", blockTimestamps);
        switch (log.eventName) {
          case "CircuitBreakerTriggered": {
            this.eventData.circuitBreakerTriggeredCount++;
            const reason = Number(log.args.reason);
            if (reason === 0) this.eventData.circuitBreakerByReason.rateDrop++;
            else if (reason === 1) this.eventData.circuitBreakerByReason.queueRatio++;
            else if (reason === 2) this.eventData.circuitBreakerByReason.accountingStale++;
            const reasonName = BREAKER_REASONS[reason] ?? `Unknown(${reason})`;
            recentEvent.args.reason = reasonName;
            console.warn(
              `[${this.name}/${this.network}] WARNING: CircuitBreakerTriggered (${reasonName}) at block ${log.blockNumber}`,
            );
            break;
          }
          case "Paused":
            this.eventData.safetyPausedCount++;
            console.warn(
              `[${this.name}/${this.network}] WARNING: SafetyModule PAUSED at block ${log.blockNumber}`,
            );
            break;
          case "Unpaused":
            this.eventData.safetyUnpausedCount++;
            console.log(
              `[${this.name}/${this.network}] SafetyModule unpaused at block ${log.blockNumber}`,
            );
            break;
          case "DepositCapUpdated":
          case "WithdrawalMinimumUpdated":
          case "RateDropLimitUpdated":
          case "QueueRatioLimitUpdated":
          case "AccountingDelayUpdated":
            this.eventData.configChangeCount++;
            console.log(
              `[${this.name}/${this.network}] Config change: ${log.eventName} at block ${log.blockNumber}`,
            );
            break;
        }
        recentEvents.push(recentEvent);
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll safety module events:`,
        safetyResult.reason,
      );
    }

    // -- Staking events --
    if (stakingResult.status === "fulfilled") {
      totalEvents += stakingResult.value.length;
      for (const log of stakingResult.value) {
        recentEvents.push(this.toRecentEvent(log, "StakingManager", blockTimestamps));
        switch (log.eventName) {
          case "StakedWithProvider":
            this.eventData.stakedCount++;
            this.eventData.stakedVolume += log.args.amount;
            addAttester(this.network, log.args.attester);
            break;
          case "UnstakeInitiated":
            this.eventData.unstakeInitiatedCount++;
            this.eventData.unstakeInitiatedVolume += log.args.amount;
            break;
          case "UnstakeFinalized":
            this.eventData.unstakeFinalizedCount++;
            this.eventData.unstakeFinalizedVolume += log.args.amount;
            break;
          case "RewardsHarvested":
            this.eventData.rewardsHarvestedVolume += log.args.amount;
            break;
          case "AttesterRemoved":
            removeAttester(this.network, log.args.attester);
            break;
          case "AttesterStateRefreshed": {
            this.eventData.attesterRefreshCount++;
            const args = log.args as { attester: string; oldBalance: bigint; newBalance: bigint };
            if (args.oldBalance !== args.newBalance) {
              this.eventData.attesterRefreshBalanceChangeCount++;
              console.log(
                `[${this.name}/${this.network}] AttesterStateRefreshed: ${args.attester} balance ${args.oldBalance} → ${args.newBalance} at block ${log.blockNumber}`,
              );
            }
            break;
          }
        }
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll staking events:`,
        stakingResult.reason,
      );
    }

    // -- Withdrawal queue events --
    if (wqResult.status === "fulfilled") {
      totalEvents += wqResult.value.length;
      for (const log of wqResult.value) {
        recentEvents.push(this.toRecentEvent(log, "WithdrawalQueue", blockTimestamps));
        switch (log.eventName) {
          case "WithdrawalRequested":
            this.eventData.withdrawalRequestedCount++;
            this.eventData.withdrawalRequestedVolume += log.args.assetsExpected;
            break;
          case "WithdrawalFinalized":
            this.eventData.withdrawalFinalizedCount++;
            this.eventData.withdrawalFinalizedVolume += log.args.assets;
            break;
          case "WithdrawalAdjusted":
            this.eventData.withdrawalAdjustedCount++;
            console.warn(
              `[${this.name}/${this.network}] WARNING: WithdrawalAdjusted (slashing) request #${log.args.id} at block ${log.blockNumber}`,
            );
            break;
        }
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll withdrawal queue events:`,
        wqResult.reason,
      );
    }

    // -- Rewards accumulator events --
    if (raResult.status === "fulfilled") {
      totalEvents += raResult.value.length;
      for (const log of raResult.value) {
        recentEvents.push(this.toRecentEvent(log, "RewardsAccumulator", blockTimestamps));
      }
    } else {
      console.error(
        `[${this.name}/${this.network}] Failed to poll rewards accumulator events:`,
        raResult.reason,
      );
    }

    // Update state
    this.lastProcessedBlock = currentBlock;
    this.eventData.lastProcessedBlock = currentBlock;
    this.eventData.lastUpdated = new Date();
    updateEventData(this.network, { ...this.eventData });

    // Store recent events (sorted by block number)
    if (recentEvents.length > 0) {
      recentEvents.sort((a, b) => Number(a.blockNumber - b.blockNumber));
      pushEvents(this.network, recentEvents);
    }

    // Periodically persist checkpoint to disk so events aren't lost on restart
    this.scrapesSinceLastPersist++;
    if (this.scrapesSinceLastPersist >= PERSIST_INTERVAL) {
      this.scrapesSinceLastPersist = 0;
      await this.saveCheckpoint();
    }

    if (totalEvents > 0) {
      console.log(
        `[${this.name}/${this.network}] Blocks ${fromBlock}-${currentBlock} | ${totalEvents} event(s)`,
      );
    }
  }

  async shutdown(): Promise<void> {
    // Save checkpoint on shutdown so we resume from the right block
    await this.saveCheckpoint();
  }
}
