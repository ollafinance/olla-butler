import { formatEther, type Address } from "viem";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { CoreScraper } from "./core-scraper.js";
import type { VaultScraper } from "./vault-scraper.js";
import type { StakingScraper } from "./staking-scraper.js";
import { OllaCoreEventAbi } from "../../types/index.js";
import {
  ContractEventListener,
  type DecodedLog,
  type EventHandler,
} from "./contract-event-listener.js";

/**
 * WS subscription to OllaCore protocol events. Drives an immediate refresh
 * of the core/vault/staking scrapers when accounting state changes
 * (AccountingUpdated, Rebalanced) or when governance-mutable parameters
 * change. Closes the polling staleness window for derived metrics — most
 * notably the withdrawal-queue-ratio gauge, which mirrors a SafetyModule
 * check that re-prices pending withdrawals at every accounting update.
 *
 * No per-event state mutations — pure trigger-refresh. The debounced burst
 * coalescing in ContractEventListener absorbs bursts of governance changes
 * or chained accounting/rebalance events into a single scrape pass.
 */
export const createOllaCoreEventListener = (
  network: string,
  wsUrl: string,
  chainId: number,
  protocolClient: OllaProtocolClient,
  coreScraper: CoreScraper,
  vaultScraper: VaultScraper,
  stakingScraper: StakingScraper,
): ContractEventListener => {
  const logEvent: EventHandler = {
    onEvent: (log: DecodedLog, ctx) => {
      const tag = `[${ctx.name}/${ctx.network}] block=${log.blockNumber}`;
      switch (log.eventName) {
        case "AccountingUpdated":
          console.log(
            `${tag} AccountingUpdated totalAssets=${formatEther(log.args.totalAssets)} ` +
              `rate=${formatEther(log.args.exchangeRate)} grossRewards=${formatEther(log.args.grossRewards)} ` +
              `netFlows=${log.args.netFlows} timestamp=${log.args.timestamp}`,
          );
          break;
        case "Rebalanced":
          console.log(
            `${tag} Rebalanced rewardsDelta=${formatEther(log.args.rewardsDelta)} ` +
              `finalized=${formatEther(log.args.finalizedAmount)} ` +
              `staked=${formatEther(log.args.stakedAmount)} ` +
              `buffer=${formatEther(log.args.resultingBuffer)}`,
          );
          break;
        case "WithdrawalFinalized":
          console.log(
            `${tag} WithdrawalFinalized (core) available=${formatEther(log.args.available)} ` +
              `finalized=${formatEther(log.args.finalized)}`,
          );
          break;
        case "UnstakeInitiated":
          console.log(
            `${tag} UnstakeInitiated requested=${formatEther(log.args.requested)} ` +
              `initiated=${formatEther(log.args.initiated)}`,
          );
          break;
        case "OllaProtocolFeesPaid":
          console.log(
            `${tag} OllaProtocolFeesPaid protocolFeeAssets=${formatEther(log.args.protocolFeeAssets)} ` +
              `treasuryShares=${formatEther(log.args.treasuryShares)} ` +
              `providerShares=${formatEther(log.args.providerShares)}`,
          );
          break;
        case "NegativeRewardsPeriod":
          console.warn(
            `${tag} NegativeRewardsPeriod grossRewardsSigned=${log.args.grossRewardsSigned}`,
          );
          break;
        case "ProtocolFeeUpdated":
          console.log(
            `${tag} ProtocolFeeUpdated ${log.args.oldFeeBP} → ${log.args.newFeeBP} bps`,
          );
          break;
        case "TreasuryFeeSplitUpdated":
          console.log(
            `${tag} TreasuryFeeSplitUpdated ${log.args.oldSplitBP} → ${log.args.newSplitBP} bps`,
          );
          break;
        case "TargetBufferedAssetsUpdated":
          console.log(
            `${tag} TargetBufferedAssetsUpdated ${formatEther(log.args.oldBuffer)} → ${formatEther(log.args.newBuffer)}`,
          );
          break;
        case "RebalanceGasThresholdUpdated":
          console.log(
            `${tag} RebalanceGasThresholdUpdated ${log.args.oldThreshold} → ${log.args.newThreshold}`,
          );
          break;
        case "RebalanceCooldownUpdated":
          console.log(
            `${tag} RebalanceCooldownUpdated ${log.args.oldCooldown} → ${log.args.newCooldown}`,
          );
          break;
        case "SafetyModuleUpdated":
          console.warn(
            `${tag} SafetyModuleUpdated ${log.args.oldSafetyModule} → ${log.args.newSafetyModule}`,
          );
          break;
        case "VaultSet":
          console.warn(`${tag} VaultSet vault=${log.args.vault}`);
          break;
      }
    },
  };

  // Single shared logger across every event in the ABI; events without an
  // explicit case fall through silently and still trigger the debounced
  // refresh.
  const handlers: Record<string, EventHandler> = Object.fromEntries(
    OllaCoreEventAbi.filter((e) => e.type === "event").map((e) => [e.name, logEvent]),
  );

  return new ContractEventListener({
    name: "olla-core-event-listener",
    network,
    wsUrl,
    chainId,
    abi: OllaCoreEventAbi,
    address: () => protocolClient.getAddresses().core as Address,
    handlers,
    triggerScrapers: [coreScraper, vaultScraper, stakingScraper],
  });
};
