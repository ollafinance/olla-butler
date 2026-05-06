import { formatEther, type Address } from "viem";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { VaultScraper } from "./vault-scraper.js";
import { OllaVaultEventAbi } from "../../types/index.js";
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
 * WS subscription to OllaVault lifecycle events. The withdrawal queue is
 * folded into the vault contract — per-request finalize and claim drive
 * the unclaimed counter (no on-chain aggregate exists for this), and any
 * vault event triggers a debounced refresh of the vault scraper.
 */
export const createVaultEventListener = (
  network: string,
  wsUrl: string,
  chainId: number,
  protocolClient: OllaProtocolClient,
  vaultScraper: VaultScraper,
): ContractEventListener => {
  const handlers: Record<string, EventHandler> = {
    WithdrawalRequested: {
      onEvent: (log: DecodedLog, ctx) => {
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalRequested ` +
            `id=${log.args.id} controller=${log.args.controller} ` +
            `assetsExpected=${formatEther(log.args.assetsExpected)}`,
        );
      },
    },
    WithdrawalRequestFinalized: {
      onEvent: (log: DecodedLog, ctx) => {
        const assets = log.args.assets as bigint;
        incrementUnclaimed(ctx.network, assets);
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalRequestFinalized ` +
            `id=${log.args.id} assets=${formatEther(assets)}`,
        );
      },
    },
    WithdrawalClaimed: {
      onEvent: (log: DecodedLog, ctx) => {
        const assets = log.args.assets as bigint;
        decrementUnclaimed(ctx.network, assets);
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} WithdrawalClaimed ` +
            `id=${log.args.requestId} recipient=${log.args.recipient} ` +
            `assets=${formatEther(assets)}`,
        );
      },
    },
    OperatorSet: {
      onEvent: (log: DecodedLog, ctx) => {
        console.log(
          `[${ctx.name}/${ctx.network}] block=${log.blockNumber} OperatorSet ` +
            `controller=${log.args.controller} operator=${log.args.operator} approved=${log.args.approved}`,
        );
      },
    },
  };

  return new ContractEventListener({
    name: "vault-event-listener",
    network,
    wsUrl,
    chainId,
    abi: OllaVaultEventAbi,
    address: () => protocolClient.getAddresses().vault as Address,
    handlers,
    triggerScrapers: [vaultScraper],
  });
};
