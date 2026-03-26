/**
 * Governance event log — ring buffer of governance and upgrade events per network.
 * Separate from the main event log: higher capacity, richer data (old/new values),
 * and focused on low-frequency, high-importance events.
 */

import type { GovernanceEvent } from "../../types/index.js";

const MAX_GOVERNANCE_EVENTS = 500;

const governanceLogs = new Map<string, GovernanceEvent[]>();

const getLog = (network: string): GovernanceEvent[] => {
  let log = governanceLogs.get(network);
  if (!log) {
    log = [];
    governanceLogs.set(network, log);
  }
  return log;
};

export const pushGovernanceEvent = (network: string, event: GovernanceEvent): void => {
  const log = getLog(network);
  log.push(event);
  if (log.length > MAX_GOVERNANCE_EVENTS) {
    log.shift();
  }
};

export const pushGovernanceEvents = (network: string, events: GovernanceEvent[]): void => {
  const log = getLog(network);
  log.push(...events);
  while (log.length > MAX_GOVERNANCE_EVENTS) {
    log.shift();
  }
};

export const getGovernanceEvents = (network: string): readonly GovernanceEvent[] => {
  return getLog(network);
};

export const getAllGovernanceEvents = (): ReadonlyMap<string, GovernanceEvent[]> => {
  return governanceLogs;
};
