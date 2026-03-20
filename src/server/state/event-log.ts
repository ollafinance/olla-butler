/**
 * Recent event log — ring buffer of the last N on-chain events per network.
 * Stores tx hash, block number, timestamp, and decoded args for display in Grafana.
 */

import type { RecentEvent } from "../../types/index.js";

const MAX_EVENTS = 200;

const eventLogs = new Map<string, RecentEvent[]>();

const getLog = (network: string): RecentEvent[] => {
  let log = eventLogs.get(network);
  if (!log) {
    log = [];
    eventLogs.set(network, log);
  }
  return log;
};

export const pushEvent = (network: string, event: RecentEvent): void => {
  const log = getLog(network);
  log.push(event);
  if (log.length > MAX_EVENTS) {
    log.shift();
  }
};

export const pushEvents = (network: string, events: RecentEvent[]): void => {
  const log = getLog(network);
  log.push(...events);
  // Trim from the front if we exceed the cap
  while (log.length > MAX_EVENTS) {
    log.shift();
  }
};

export const getRecentEvents = (network: string): readonly RecentEvent[] => {
  return getLog(network);
};

export const getAllRecentEvents = (): ReadonlyMap<string, RecentEvent[]> => {
  return eventLogs;
};
