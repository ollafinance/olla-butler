import { type Address, type PublicClient } from "viem";
import { AbstractScraper } from "./base-scraper.js";
import type { ContractAddresses, EventData } from "../../types/index.js";
import {
  OllaCoreEventAbi,
  OllaVaultEventAbi,
  SafetyModuleEventAbi,
  StakingManagerEventAbi,
  WithdrawalQueueEventAbi,
  RewardsAccumulatorEventAbi,
} from "../../types/index.js";
import { updateEventData } from "../state/index.js";
import { addAttester, removeAttester } from "../state/attester-registry.js";

const BREAKER_REASONS = ["RateDrop", "QueueRatio", "AccountingStale"] as const;
const MAX_BLOCK_RANGE = 10_000n;

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

  constructor(network: string, client: PublicClient, addresses: ContractAddresses) {
    super();
    this.network = network;
    this.client = client;
    this.addresses = addresses;
    this.eventData = createEmptyEventData();
  }

  async init(): Promise<void> {
    this.lastProcessedBlock = await this.client.getBlockNumber();
    console.log(
      `[${this.name}/${this.network}] Starting event monitoring from block ${this.lastProcessedBlock}`,
    );
  }

  async scrape(): Promise<void> {
    const currentBlock = await this.client.getBlockNumber();
    if (currentBlock <= this.lastProcessedBlock) return;

    let fromBlock = this.lastProcessedBlock + 1n;
    if (currentBlock - fromBlock > MAX_BLOCK_RANGE) {
      fromBlock = currentBlock - MAX_BLOCK_RANGE;
      console.warn(
        `[${this.name}/${this.network}] Large block gap, scanning last ${MAX_BLOCK_RANGE} blocks`,
      );
    }

    const blockRange = { fromBlock, toBlock: currentBlock };
    const addr = this.addresses;

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

    // -- Core events --
    if (coreResult.status === "fulfilled") {
      totalEvents += coreResult.value.length;
      for (const log of coreResult.value) {
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
        switch (log.eventName) {
          case "CircuitBreakerTriggered": {
            this.eventData.circuitBreakerTriggeredCount++;
            const reason = Number(log.args.reason);
            if (reason === 0) this.eventData.circuitBreakerByReason.rateDrop++;
            else if (reason === 1) this.eventData.circuitBreakerByReason.queueRatio++;
            else if (reason === 2) this.eventData.circuitBreakerByReason.accountingStale++;
            const reasonName = BREAKER_REASONS[reason] ?? `Unknown(${reason})`;
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

    // -- Rewards accumulator events (counted for totals only) --
    if (raResult.status === "fulfilled") {
      totalEvents += raResult.value.length;
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

    if (totalEvents > 0) {
      console.log(
        `[${this.name}/${this.network}] Blocks ${fromBlock}-${currentBlock} | ${totalEvents} event(s)`,
      );
    }
  }
}
