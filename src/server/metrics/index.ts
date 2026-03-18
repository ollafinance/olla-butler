export {
  initMetricsRegistry,
  getMetricsRegistry,
  getMeter,
  type MetricsOptions,
} from "./registry.js";
export { initProtocolMetrics } from "./protocol-metrics.js";
export { initVaultMetrics } from "./vault-metrics.js";
export { initStakingMetrics } from "./staking-metrics.js";
export { initSafetyMetrics } from "./safety-metrics.js";
export { initWithdrawalQueueMetrics } from "./withdrawal-queue-metrics.js";
export { initEventMetrics } from "./event-metrics.js";
export { initDerivedMetrics } from "./derived-metrics.js";
export { initScraperHealthMetrics } from "./scraper-health-metrics.js";
