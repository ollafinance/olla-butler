import { formatEther, type Address } from "viem";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { WithdrawalQueueScraper } from "./withdrawal-queue-scraper.js";
import type { VaultScraper } from "./vault-scraper.js";
import { WithdrawalQueueEventAbi } from "../../types/index.js";
import {
  incrementUnclaimed,
  decrementUnclaimed,
} from "../state/withdrawal-queue-registry.js";
import {
  ContractEventListener,
  type DecodedLog,
  type EventHandler,
} from "./contract-event-listener.js";

/**
 * WS subscription to WithdrawalQueue lifecycle events. WithdrawalFinalized
 * and WithdrawalClaimed update the in-memory unclaimed counter directly
 * (no on-chain aggregate exists for this); all three events trigger a
 * debounced refresh of the queue + vault scrapers to keep aggregate state
 * fresh after a burst settles.
 */
export const createWithdrawalQueueEventListener = (
  network: string,
  wsUrl: string,
  chainId: number,
  protocolClient: OllaProtocolClient,
  withdrawalQueueScraper: WithdrawalQueueScraper,
  vaultScraper: VaultScraper,
): ContractEventListener => {
  const handlers: Record<string, EventHandler> = {
    WithdrawalRequested: {
      onEvent: (log: DecodedLog, ctx) => {
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalRequested ` +
            `id=${log.args.id} recipient=${log.args.recipient} ` +
            `assetsExpected=${formatEther(log.args.assetsExpected)}`,
        );
      },
    },
    WithdrawalFinalized: {
      onEvent: (log: DecodedLog, ctx) => {
        const assets = log.args.assets as bigint;
        incrementUnclaimed(ctx.network, assets);
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalFinalized ` +
            `id=${log.args.id} assets=${formatEther(assets)}`,
        );
      },
    },
    WithdrawalClaimed: {
      onEvent: (log: DecodedLog, ctx) => {
        const assets = log.args.assetsExpected as bigint;
        decrementUnclaimed(ctx.network, assets);
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalClaimed ` +
            `id=${log.args.id} recipient=${log.args.recipient} ` +
            `assets=${formatEther(assets)}`,
        );
      },
    },
  };

  return new ContractEventListener({
    name: "withdrawal-queue-event-listener",
    network,
    wsUrl,
    chainId,
    abi: WithdrawalQueueEventAbi,
    address: () => protocolClient.getAddresses().withdrawalQueue as Address,
    handlers,
    triggerScrapers: [withdrawalQueueScraper, vaultScraper],
  });
};
