/**
 * /events JSON endpoint for Grafana table display.
 *
 * Returns the last 200 on-chain events across all networks.
 * Use with Grafana Infinity datasource (JSON type) to render as a table.
 *
 * Query params:
 *   ?network=sepolia  — filter by network (optional)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getAllRecentEvents } from "../state/event-log.js";

type SerializedEvent = {
  network: string;
  timestamp: string;
  blockNumber: number;
  transactionHash: string;
  contract: string;
  eventName: string;
  args: string;
};

export function handleEventsRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const networkFilter = url.searchParams.get("network");

  const allEvents = getAllRecentEvents();
  const rows: SerializedEvent[] = [];

  for (const [network, events] of allEvents.entries()) {
    if (networkFilter && network !== networkFilter) continue;

    for (const event of events) {
      rows.push({
        network,
        timestamp: event.timestamp.toISOString(),
        blockNumber: Number(event.blockNumber),
        transactionHash: event.transactionHash,
        contract: event.contract,
        eventName: event.eventName,
        args: JSON.stringify(event.args),
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
