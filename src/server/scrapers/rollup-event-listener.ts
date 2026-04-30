import {
  createPublicClient,
  formatEther,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import { createWsTransport, SUPPORTED_CHAINS } from "../../core/components/transport.js";
import type { OllaProtocolClient } from "../../core/components/OllaProtocolClient.js";
import type { AttesterScraper } from "./attester-scraper.js";
import { AztecRollupEventAbi } from "../../types/index.js";

/** Coalesce bursts (e.g. one entry-queue flush emitting many Deposit events). */
const DEBOUNCE_MS = 1_000;

type RollupEventName =
  | "ValidatorQueued"
  | "Deposit"
  | "FailedDeposit"
  | "WithdrawInitiated"
  | "WithdrawFinalized"
  | "Slashed";

type DecodedRollupLog = Log<bigint, number, false, undefined, true, typeof AztecRollupEventAbi> & {
  eventName: RollupEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
};

/**
 * Subscribes via WebSocket to attester lifecycle events on the canonical
 * Aztec rollup (ValidatorQueued, Deposit, FailedDeposit, WithdrawInitiated,
 * WithdrawFinalized, Slashed) and triggers AttesterScraper.scrape() on each.
 *
 * Provider-side topic0 filtering ensures we only see staking events, not L2
 * block proposals or epoch resolution noise. Bursts within DEBOUNCE_MS are
 * coalesced into a single refresh.
 *
 * The 60s AttesterScraper poll remains as a backstop for missed events during
 * transient WS disconnects and to reconcile effectiveBalance drift (which
 * accrues without emitting events).
 */
export class RollupEventListener {
  readonly name = "rollup-event-listener";
  readonly network: string;

  private readonly wsClient: PublicClient;
  private readonly protocolClient: OllaProtocolClient;
  private readonly attesterScraper: AttesterScraper;

  private currentRollupAddress: Address;
  private unwatch: (() => void) | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private pending = false;

  constructor(
    network: string,
    wsUrl: string,
    chainId: number,
    protocolClient: OllaProtocolClient,
    attesterScraper: AttesterScraper,
  ) {
    this.network = network;
    this.protocolClient = protocolClient;
    this.attesterScraper = attesterScraper;

    const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    this.wsClient = createPublicClient({
      transport: createWsTransport(wsUrl),
      chain,
    });

    this.currentRollupAddress = protocolClient.getAddresses().canonicalRollup as Address;
  }

  start(): void {
    this.subscribe();
    console.log(
      `[${this.name}/${this.network}] Subscribed to staking events on rollup ${this.currentRollupAddress}`,
    );
  }

  private subscribe(): void {
    this.unwatch = this.wsClient.watchEvent({
      address: this.currentRollupAddress,
      events: AztecRollupEventAbi,
      strict: true,
      onLogs: (logs) => {
        if (logs.length === 0) return;
        for (const log of logs) {
          this.logRollupEvent(log as DecodedRollupLog);
        }
        this.scheduleRefresh();
      },
      onError: (err) => {
        console.error(`[${this.name}/${this.network}] Subscription error:`, err);
      },
    });
  }

  private logRollupEvent(log: DecodedRollupLog): void {
    const tag = `[${this.name}/${this.network}] block=${log.blockNumber}`;
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
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRefresh();
    }, DEBOUNCE_MS);
  }

  private async runRefresh(): Promise<void> {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.inFlight = true;
    try {
      await this.attesterScraper.scrape();
      const newAddr = this.protocolClient.getAddresses().canonicalRollup;
      if (newAddr.toLowerCase() !== this.currentRollupAddress.toLowerCase()) {
        console.log(
          `[${this.name}/${this.network}] Canonical rollup changed → re-subscribing to ${newAddr}`,
        );
        if (this.unwatch) this.unwatch();
        this.currentRollupAddress = newAddr as Address;
        this.subscribe();
      }
    } catch (err) {
      console.error(`[${this.name}/${this.network}] Triggered scrape failed:`, err);
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.scheduleRefresh();
      }
    }
  }

  shutdown(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
  }
}
