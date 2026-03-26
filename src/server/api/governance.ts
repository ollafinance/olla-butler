/**
 * /governance JSON endpoint for Grafana table display.
 *
 * Returns governance events (config changes, rollup upgrades, safety events)
 * with old/new values for parameter change tracking.
 *
 * Query params:
 *   ?network=sepolia  — filter by network (optional)
 *   ?category=config_change — filter by category (optional)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getAllGovernanceEvents } from "../state/governance-log.js";

type SerializedGovernanceEvent = {
  network: string;
  timestamp: string;
  blockNumber: number;
  transactionHash: string;
  contract: string;
  eventName: string;
  parameter: string;
  oldValue: string | null;
  newValue: string;
  category: string;
};

export function handleGovernanceRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const networkFilter = url.searchParams.get("network");
  const categoryFilter = url.searchParams.get("category");

  const allEvents = getAllGovernanceEvents();
  const rows: SerializedGovernanceEvent[] = [];

  for (const [network, events] of allEvents.entries()) {
    if (networkFilter && network !== networkFilter) continue;

    for (const event of events) {
      if (categoryFilter && event.category !== categoryFilter) continue;

      rows.push({
        network,
        timestamp: event.timestamp.toISOString(),
        blockNumber: Number(event.blockNumber),
        transactionHash: event.transactionHash,
        contract: event.contract,
        eventName: event.eventName,
        parameter: event.parameter,
        oldValue: event.oldValue,
        newValue: event.newValue,
        category: event.category,
      });
    }
  }

  // Most recent first
  rows.sort((a, b) => b.blockNumber - a.blockNumber);

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(rows));
}
