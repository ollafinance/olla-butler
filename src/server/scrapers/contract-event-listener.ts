import {
  createPublicClient,
  type AbiEvent,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import { createWsTransport, SUPPORTED_CHAINS } from "../../core/components/transport.js";

/**
 * Anything the listener can trigger a refresh on. Matches the BaseScraper
 * shape but only requires `scrape()` so other refreshable targets fit too.
 */
export interface RefreshTrigger {
  readonly name: string;
  scrape(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DecodedLog = Log<bigint, number, false, AbiEvent, true> & {
  eventName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
};

export type EventHandler = {
  /**
   * Synchronous side effect on butler state for this event. Runs on every
   * matching log before the debounced refresh fires. Throws are caught and
   * logged so a single bad event cannot stall the listener.
   */
  onEvent?: (log: DecodedLog, ctx: { name: string; network: string }) => void;
};

export interface ContractEventListenerOptions {
  /** Listener identifier used in log lines. */
  name: string;
  network: string;
  wsUrl: string;
  chainId: number;
  /** Event-only ABI subset; passed verbatim as the topic0 filter. */
  abi: readonly AbiEvent[];
  /** Re-evaluated after each refresh; re-subscribes if it changes (e.g. canonical contract upgrade). */
  address: () => Address;
  /** Per-event side effects. Events without a handler are still observed and trigger a refresh. */
  handlers?: Record<string, EventHandler>;
  /** Scrapers to refresh on any event burst. Empty array = listener-only mode (handlers only). */
  triggerScrapers?: RefreshTrigger[];
  /** Coalesce window for bursts (e.g. one entry-queue flush emitting many events). */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 1_000;

/**
 * Generic WS event listener. Subscribes to a contract's events, runs
 * per-event synchronous handlers for state updates, and debounces a
 * triggered refresh of one or more scrapers.
 *
 * Polling/event hybrid: handlers absorb per-event deltas immediately;
 * triggerScrapers reconcile aggregate state after a burst settles.
 */
export class ContractEventListener {
  readonly name: string;
  readonly network: string;

  private readonly wsClient: PublicClient;
  private readonly abi: readonly AbiEvent[];
  private readonly addressFn: () => Address;
  private readonly handlers: Record<string, EventHandler>;
  private readonly triggerScrapers: RefreshTrigger[];
  private readonly debounceMs: number;

  private currentAddress: Address;
  private unwatch: (() => void) | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private pending = false;

  constructor(opts: ContractEventListenerOptions) {
    this.name = opts.name;
    this.network = opts.network;
    this.abi = opts.abi;
    this.addressFn = opts.address;
    this.handlers = opts.handlers ?? {};
    this.triggerScrapers = opts.triggerScrapers ?? [];
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    const chain = SUPPORTED_CHAINS.find((c) => c.id === opts.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${opts.chainId}`);
    }
    this.wsClient = createPublicClient({
      transport: createWsTransport(opts.wsUrl),
      chain,
    });

    this.currentAddress = this.addressFn();
  }

  start(): void {
    this.subscribe();
    console.log(
      `[${this.name}/${this.network}] Subscribed at ${this.currentAddress} (${this.abi.length} event(s), ${this.triggerScrapers.length} trigger scraper(s))`,
    );
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

  private subscribe(): void {
    this.unwatch = this.wsClient.watchEvent({
      address: this.currentAddress,
      events: this.abi,
      strict: true,
      onLogs: (logs) => {
        if (logs.length === 0) return;
        for (const log of logs as DecodedLog[]) {
          this.dispatch(log);
        }
        this.scheduleRefresh();
      },
      onError: (err) => {
        console.error(`[${this.name}/${this.network}] Subscription error:`, err);
      },
    });
  }

  private dispatch(log: DecodedLog): void {
    const handler = this.handlers[log.eventName];
    if (!handler?.onEvent) return;
    try {
      handler.onEvent(log, { name: this.name, network: this.network });
    } catch (err) {
      console.error(
        `[${this.name}/${this.network}] Handler for ${log.eventName} threw:`,
        err,
      );
    }
  }

  private scheduleRefresh(): void {
    if (this.triggerScrapers.length === 0) return;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRefresh();
    }, this.debounceMs);
  }

  private async runRefresh(): Promise<void> {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.inFlight = true;
    try {
      await Promise.all(this.triggerScrapers.map((s) => s.scrape()));
      const newAddr = this.addressFn();
      if (newAddr.toLowerCase() !== this.currentAddress.toLowerCase()) {
        console.log(
          `[${this.name}/${this.network}] Address changed → re-subscribing to ${newAddr}`,
        );
        if (this.unwatch) this.unwatch();
        this.currentAddress = newAddr;
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
}
