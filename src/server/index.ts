import { loadAllAvailableNetworkConfigs } from "../core/config/index.js";
import type { ButlerConfig } from "../core/config/index.js";
import {
  initMetricsRegistry,
  initProtocolMetrics,
  initVaultMetrics,
  initStakingMetrics,
  initSafetyMetrics,
  initWithdrawalQueueMetrics,
  initEventMetrics,
  initDerivedMetrics,
  initScraperHealthMetrics,
  initAttesterMetrics,
  getMetricsRegistry,
} from "./metrics/index.js";
import {
  ScraperManager,
  CoreScraper,
  VaultScraper,
  StakingScraper,
  SafetyModuleScraper,
  WithdrawalQueueScraper,
  EventWatcher,
  AttesterScraper,
} from "./scrapers/index.js";
import { initNetworkState, updateContractAddresses } from "./state/index.js";
import { initAttesterRegistry } from "./state/attester-registry.js";
import { OllaProtocolClient } from "../core/components/OllaProtocolClient.js";
import type { Address } from "viem";

let logCounter = 0;

const initLog = (str: string) => {
  const counter = ++logCounter;
  console.log(`\n\n=====  [${counter}] ${str}`);
};

async function initializeNetwork(
  network: string,
  config: ButlerConfig,
  scraperManager: ScraperManager,
): Promise<void> {
  console.log(`\n--- Initializing network: ${network} ---`);

  initNetworkState(network);

  // Create protocol client and discover all contract addresses
  const protocolClient = new OllaProtocolClient({
    rpcUrl: config.ETHEREUM_NODE_URL,
    chainId: config.ETHEREUM_CHAIN_ID,
    coreAddress: config.OLLA_CORE_ADDRESS as Address,
  });

  const addresses = await protocolClient.init();
  updateContractAddresses(network, addresses);

  // Register scrapers
  console.log(`[${network}] Registering scrapers...`);

  const coreScraper = new CoreScraper(network, protocolClient);
  scraperManager.register(coreScraper, 30_000); // 30s

  const vaultScraper = new VaultScraper(network, protocolClient);
  scraperManager.register(vaultScraper, 30_000); // 30s

  const stakingScraper = new StakingScraper(network, protocolClient);
  scraperManager.register(stakingScraper, 60_000); // 60s

  const safetyModuleScraper = new SafetyModuleScraper(network, protocolClient);
  scraperManager.register(safetyModuleScraper, 60_000); // 60s

  const withdrawalQueueScraper = new WithdrawalQueueScraper(network, protocolClient);
  scraperManager.register(withdrawalQueueScraper, 30_000); // 30s

  const eventWatcher = new EventWatcher(network, protocolClient.getPublicClient(), addresses);
  scraperManager.register(eventWatcher, 12_000); // 12s — near-realtime event monitoring

  // Attester monitoring (opt-in via ATTESTER_SCAN_START_BLOCK)
  if (config.ATTESTER_SCAN_START_BLOCK !== undefined) {
    console.log(`[${network}] Initializing attester registry from block ${config.ATTESTER_SCAN_START_BLOCK}...`);
    await initAttesterRegistry(
      network,
      protocolClient.getPublicClient(),
      addresses.stakingManager as Address,
      BigInt(config.ATTESTER_SCAN_START_BLOCK),
    );

    const attesterScraper = new AttesterScraper(network, protocolClient);
    scraperManager.register(attesterScraper, 60_000); // 60s
  } else {
    console.log(`[${network}] Attester monitoring disabled (ATTESTER_SCAN_START_BLOCK not set)`);
  }

  console.log(`[${network}] Network initialization complete`);
}

/**
 * Start the olla-butler server.
 * Discovers all Olla protocol contracts from OllaCore and scrapes them periodically.
 *
 * @param specificNetwork - Optional: run only a specific network
 */
export const startServer = async (specificNetwork?: string) => {
  console.log(`
   ____  _ _             ____        _   _
  / __ \\| | |           |  _ \\      | | | |
 | |  | | | | __ _ _____| |_) |_   _| |_| | ___ _ __
 | |  | | | |/ _\` |_____|  _ <| | | | __| |/ _ \\ '__|
 | |__| | | | (_| |     | |_) | |_| | |_| |  __/ |
  \\____/|_|_|\\__,_|     |____/ \\__,_|\\__|_|\\___|_|

`);

  initLog("Loading all available network configurations...");
  const networkConfigs = await loadAllAvailableNetworkConfigs(
    specificNetwork ? { specificNetwork } : undefined,
  );

  if (networkConfigs.size === 0) {
    if (specificNetwork) {
      throw new Error(
        `Network configuration not found for "${specificNetwork}". Please ensure ${specificNetwork}-base.env exists.`,
      );
    }
    throw new Error(
      "No network configurations found. Please ensure at least one network is configured.",
    );
  }

  if (specificNetwork) {
    console.log(`Running in single-network mode: ${specificNetwork}`);
  } else {
    console.log(
      `Found ${networkConfigs.size} network(s): ${Array.from(networkConfigs.keys()).join(", ")}`,
    );
  }

  const firstConfig = Array.from(networkConfigs.values())[0];
  if (!firstConfig) {
    throw new Error("No network configurations available");
  }

  initLog("Initializing Prometheus metrics registry...");
  const metricsPort = firstConfig.METRICS_PORT;
  initMetricsRegistry({
    port: metricsPort,
    bearerToken: firstConfig.METRICS_BEARER_TOKEN,
  });
  console.log(
    `Prometheus metrics available at http://localhost:${metricsPort}/metrics`,
  );

  initLog("Initializing metrics...");
  initProtocolMetrics();
  initVaultMetrics();
  initStakingMetrics();
  initSafetyMetrics();
  initWithdrawalQueueMetrics();
  initEventMetrics();
  initDerivedMetrics();
  initAttesterMetrics();
  initScraperHealthMetrics();

  const scraperManager = new ScraperManager();

  initLog("Initializing all networks...");
  for (const [network, config] of networkConfigs.entries()) {
    try {
      await initializeNetwork(network, config, scraperManager);
    } catch (error) {
      console.error(`[${network}] Failed to initialize network:`, error);
      console.warn(
        `[${network}] Skipping this network due to initialization error`,
      );
    }
  }

  initLog("Initializing and starting all scrapers...");
  await scraperManager.init();
  await scraperManager.start();

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) {
      console.log("Already shutting down, please wait...");
      return;
    }
    isShuttingDown = true;

    console.log("\n\n=== Shutting down gracefully ===");
    try {
      console.log("Shutting down scrapers...");
      await scraperManager.shutdown();
      console.log("Scrapers shut down");

      const { exporter, authServer } = getMetricsRegistry();
      console.log("Shutting down Prometheus exporter...");

      if (authServer) {
        await new Promise<void>((resolve, reject) => {
          authServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      await exporter.shutdown();
      console.log("Prometheus exporter shut down");
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  console.log("\n=== Server is running ===");
  console.log(`
Active networks: ${Array.from(networkConfigs.keys()).join(", ")}

Endpoints:
  - Metrics: http://localhost:${metricsPort}/metrics

All metrics include 'network' label for filtering.
Metric prefix: olla_butler_*

Press Ctrl+C to stop
`);
};
