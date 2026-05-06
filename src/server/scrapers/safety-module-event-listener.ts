import { formatEther, type Address } from "viem";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { SafetyModuleScraper } from "./safety-module-scraper.js";
import { SafetyModuleEventAbi } from "../../types/index.js";
import {
  ContractEventListener,
  type DecodedLog,
  type EventHandler,
} from "./contract-event-listener.js";

const BREAKER_REASON: Record<number, string> = {
  0: "RateDrop",
  1: "QueueRatio",
  2: "AccountingStale",
};

/**
 * WS subscription to SafetyModule events. Critical for alerting latency:
 * Paused/Unpaused and CircuitBreakerTriggered should propagate to butler in
 * ~1 block instead of waiting up to 60s for the next poll. Governance
 * setters (cap/limit/delay updates) also trigger a refresh so configured
 * thresholds visible in metrics stay current.
 */
export const createSafetyModuleEventListener = (
  network: string,
  wsUrl: string,
  chainId: number,
  protocolClient: OllaProtocolClient,
  safetyModuleScraper: SafetyModuleScraper,
): ContractEventListener => {
  const logEvent: EventHandler = {
    onEvent: (log: DecodedLog, ctx) => {
      const tag = `[${ctx.name}/${ctx.network}] block=${log.blockNumber}`;
      switch (log.eventName) {
        case "Paused":
          console.warn(`${tag} Paused`);
          break;
        case "Unpaused":
          console.warn(`${tag} Unpaused`);
          break;
        case "CircuitBreakerTriggered": {
          const reason = Number(log.args.reason);
          const label = BREAKER_REASON[reason] ?? `unknown(${reason})`;
          console.warn(`${tag} CircuitBreakerTriggered reason=${label}`);
          break;
        }
        case "DepositCapUpdated":
          console.log(`${tag} DepositCapUpdated cap=${formatEther(log.args.cap)}`);
          break;
        case "WithdrawalMinimumUpdated":
          console.log(
            `${tag} WithdrawalMinimumUpdated minimumShares=${formatEther(log.args.minimumShares)}`,
          );
          break;
        case "RateDropLimitUpdated":
          console.log(`${tag} RateDropLimitUpdated minRateDropBps=${log.args.minRateDropBps}`);
          break;
        case "RateHighWaterMarkUpdated":
          console.log(
            `${tag} RateHighWaterMarkUpdated rateHighWaterMark=${formatEther(log.args.rateHighWaterMark)}`,
          );
          break;
        case "QueueRatioLimitUpdated":
          console.log(`${tag} QueueRatioLimitUpdated maxQueueRatioBps=${log.args.maxQueueRatioBps}`);
          break;
        case "AccountingDelayUpdated":
          console.log(
            `${tag} AccountingDelayUpdated maxAccountingDelay=${log.args.maxAccountingDelay}s`,
          );
          break;
        // AccountingTimestampUpdated fires on every accounting update via
        // checkAccountingLiveness — too noisy to log per-event but still
        // triggers the debounced safetyModuleScraper refresh.
      }
    },
  };

  // Single shared logger across every event in the ABI; events without an
  // explicit case fall through silently and still trigger the debounced
  // refresh.
  const handlers: Record<string, EventHandler> = Object.fromEntries(
    SafetyModuleEventAbi.filter((e) => e.type === "event").map((e) => [e.name, logEvent]),
  );

  return new ContractEventListener({
    name: "safety-module-event-listener",
    network,
    wsUrl,
    chainId,
    abi: SafetyModuleEventAbi,
    address: () => protocolClient.getAddresses().safetyModule as Address,
    handlers,
    triggerScrapers: [safetyModuleScraper],
  });
};
