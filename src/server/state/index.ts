/**
 * State module - in-memory state management for scraped protocol data.
 *
 * Manages per-network state for:
 * - Core data (TVL, exchange rate, accounting, rebalance)
 * - Vault data (buffered assets, withdrawals, stAztec supply)
 * - Staking data (attester counts, staking state, key queue)
 * - Safety module data (pause state, deposit cap)
 * - Withdrawal queue data (pending requests)
 * - Contract addresses (discovered from core)
 */

import type {
  CoreData,
  VaultData,
  StakingData,
  SafetyModuleData,
  WithdrawalQueueData,
  ContractAddresses,
  EventData,
  AttesterData,
} from "../../types/index.js";

export type ExecutorData = {
  address: string;
  balance: bigint;
  lastUpdated: Date;
};

export type NetworkState = {
  coreData: CoreData | null;
  vaultData: VaultData | null;
  stakingData: StakingData | null;
  safetyModuleData: SafetyModuleData | null;
  withdrawalQueueData: WithdrawalQueueData | null;
  contractAddresses: ContractAddresses | null;
  eventData: EventData | null;
  attesterData: AttesterData | null;
  executorData: ExecutorData | null;
  previousExchangeRate: bigint | null;
  previousExchangeRateTimestamp: Date | null;
};

const networkStates = new Map<string, NetworkState>();

const getNetworkState = (network: string): NetworkState => {
  let state = networkStates.get(network);
  if (!state) {
    state = {
      coreData: null,
      vaultData: null,
      stakingData: null,
      safetyModuleData: null,
      withdrawalQueueData: null,
      contractAddresses: null,
      eventData: null,
      attesterData: null,
      executorData: null,
      previousExchangeRate: null,
      previousExchangeRateTimestamp: null,
    };
    networkStates.set(network, state);
  }
  return state;
};

export const getAllNetworkStates = (): ReadonlyMap<string, NetworkState> => {
  return networkStates;
};

export const initNetworkState = (network: string) => {
  console.log(`[State] Initializing state for network: ${network}`);
  getNetworkState(network);
};

// Core data
export const updateCoreData = (network: string, data: CoreData) => {
  const state = getNetworkState(network);
  // Snapshot previous exchange rate before overwriting
  if (state.coreData) {
    state.previousExchangeRate = state.coreData.exchangeRate;
    state.previousExchangeRateTimestamp = state.coreData.lastUpdated;
  }
  state.coreData = data;
};

export const getCoreData = (network: string): CoreData | null => {
  return getNetworkState(network).coreData;
};

// Vault data
export const updateVaultData = (network: string, data: VaultData) => {
  const state = getNetworkState(network);
  state.vaultData = data;
};

export const getVaultData = (network: string): VaultData | null => {
  return getNetworkState(network).vaultData;
};

// Staking data
export const updateStakingData = (network: string, data: StakingData) => {
  const state = getNetworkState(network);
  state.stakingData = data;
};

export const getStakingData = (network: string): StakingData | null => {
  return getNetworkState(network).stakingData;
};

// Safety module data
export const updateSafetyModuleData = (network: string, data: SafetyModuleData) => {
  const state = getNetworkState(network);
  state.safetyModuleData = data;
};

export const getSafetyModuleData = (network: string): SafetyModuleData | null => {
  return getNetworkState(network).safetyModuleData;
};

// Withdrawal queue data
export const updateWithdrawalQueueData = (network: string, data: WithdrawalQueueData) => {
  const state = getNetworkState(network);
  state.withdrawalQueueData = data;
};

export const getWithdrawalQueueData = (network: string): WithdrawalQueueData | null => {
  return getNetworkState(network).withdrawalQueueData;
};

// Contract addresses
export const updateContractAddresses = (network: string, addresses: ContractAddresses) => {
  const state = getNetworkState(network);
  state.contractAddresses = addresses;
};

export const getContractAddresses = (network: string): ContractAddresses | null => {
  return getNetworkState(network).contractAddresses;
};

// Event data
export const updateEventData = (network: string, data: EventData) => {
  const state = getNetworkState(network);
  state.eventData = data;
};

export const getEventData = (network: string): EventData | null => {
  return getNetworkState(network).eventData;
};

// Attester data
export const updateAttesterData = (network: string, data: AttesterData) => {
  const state = getNetworkState(network);
  state.attesterData = data;
};

export const getAttesterData = (network: string): AttesterData | null => {
  return getNetworkState(network).attesterData;
};

// Executor data
export const updateExecutorData = (network: string, data: ExecutorData) => {
  const state = getNetworkState(network);
  state.executorData = data;
};

export const getExecutorData = (network: string): ExecutorData | null => {
  return getNetworkState(network).executorData;
};
