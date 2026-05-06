import { formatEther, type Address } from "viem";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { AttesterScraper } from "./attester-scraper.js";
import { AztecRollupEventAbi } from "../../types/index.js";
import {
  ContractEventListener,
  type DecodedLog,
  type EventHandler,
} from "./contract-event-listener.js";

/**
 * WS subscription to attester lifecycle events on the canonical Aztec rollup
 * (ValidatorQueued, Deposit, FailedDeposit, WithdrawInitiated,
 * WithdrawFinalized, Slashed). Each event triggers a debounced
 * AttesterScraper refresh; the canonical-rollup address is re-evaluated on
 * every refresh so a registry rotation re-subscribes automatically.
 *
 * The 60s AttesterScraper poll remains as a backstop for missed events
 * during transient WS disconnects and to reconcile effectiveBalance drift
 * (which accrues without emitting events).
 */
export const createRollupEventListener = (
  network: string,
  wsUrl: string,
  chainId: number,
  protocolClient: OllaProtocolClient,
  attesterScraper: AttesterScraper,
): ContractEventListener => {
  const logEvent = (log: DecodedLog, ctx: { name: string; network: string }): void => {
    const tag = `[${ctx.name}/${ctx.network}] block=${log.blockNumber}`;
    switch (log.eventName) {
      case "ValidatorQueued":
        console.log(`${tag} ValidatorQueued attester=${log.args.attester}`);
        break;
      case "Deposit":
        console.log(
          `${tag} Deposit (flushed → active) attester=${log.args.attester} amount=${formatEther(log.args.amount)}`,
        );
        break;
      case "FailedDeposit":
        console.warn(`${tag} FailedDeposit attester=${log.args.attester} (queue purge)`);
        break;
      case "WithdrawInitiated":
        console.log(
          `${tag} WithdrawInitiated attester=${log.args.attester} amount=${formatEther(log.args.amount)}`,
        );
        break;
      case "WithdrawFinalized":
        console.log(
          `${tag} WithdrawFinalized attester=${log.args.attester} amount=${formatEther(log.args.amount)}`,
        );
        break;
      case "Slashed":
        console.warn(
          `${tag} Slashed attester=${log.args.attester} amount=${formatEther(log.args.amount)}`,
        );
        break;
    }
  };

  const handler: EventHandler = { onEvent: logEvent };
  const handlers: Record<string, EventHandler> = {
    ValidatorQueued: handler,
    Deposit: handler,
    FailedDeposit: handler,
    WithdrawInitiated: handler,
    WithdrawFinalized: handler,
    Slashed: handler,
  };

  return new ContractEventListener({
    name: "rollup-event-listener",
    network,
    wsUrl,
    chainId,
    abi: AztecRollupEventAbi,
    address: () => protocolClient.getAddresses().canonicalRollup as Address,
    handlers,
    triggerScrapers: [attesterScraper],
  });
};
