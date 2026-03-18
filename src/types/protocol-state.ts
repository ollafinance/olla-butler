/**
 * Protocol state types for scraped Olla protocol data.
 */

export enum RebalanceStep {
  Harvest = 0,
  PullUnstaked = 1,
  FinalizeWithdrawals = 2,
  InitiateUnstake = 3,
  StakeSurplus = 4,
  Done = 5,
}

export const RebalanceStepNames: Record<RebalanceStep, string> = {
  [RebalanceStep.Harvest]: "Harvest",
  [RebalanceStep.PullUnstaked]: "PullUnstaked",
  [RebalanceStep.FinalizeWithdrawals]: "FinalizeWithdrawals",
  [RebalanceStep.InitiateUnstake]: "InitiateUnstake",
  [RebalanceStep.StakeSurplus]: "StakeSurplus",
  [RebalanceStep.Done]: "Done",
};

export type AccountingState = {
  stakedPrincipal: bigint;
  rewardsAccumulatorBalance: bigint;
  claimableRewards: bigint;
  rewardsDelta: bigint;
  slashingDelta: bigint;
  cumulativeRewards: bigint;
};

export type LatestReport = {
  totalAssets: bigint;
  exchangeRate: bigint;
  grossRewards: bigint;
  netFlows: bigint;
  rewardsSnapshot: bigint;
  timestamp: bigint;
};

export type RebalanceProgress = {
  step: RebalanceStep;
  stakeRemaining: bigint;
  unstakeRemaining: bigint;
};

export type FlowCounters = {
  cumulativeDeposits: bigint;
  cumulativeWithdrawals: bigint;
  latestReportCumulativeDeposits: bigint;
  latestReportCumulativeWithdrawals: bigint;
};

export type StakingState = {
  slashingDelta: bigint;
  stakedAmount: bigint;
  pendingUnstakeAmount: bigint;
};

export type ProviderConfig = {
  admin: string;
  rewardsRecipient: string;
};

export type CoreData = {
  totalAssets: bigint;
  exchangeRate: bigint;
  protocolFeeBP: number;
  treasuryFeeSplitBP: number;
  targetBufferedAssets: bigint;
  rebalanceCooldown: number;
  accountingState: AccountingState;
  latestReport: LatestReport;
  rebalanceProgress: RebalanceProgress;
  flowCounters: FlowCounters;
  lastUpdated: Date;
};

export type VaultData = {
  bufferedAssets: bigint;
  pendingWithdrawalAssets: bigint;
  pendingWithdrawalShares: bigint;
  cumulativeDeposits: bigint;
  cumulativeWithdrawals: bigint;
  totalAssets: bigint;
  instantRedemptionFeeBP: bigint;
  availableForInstantRedemption: bigint;
  stAztecTotalSupply: bigint;
  lastUpdated: Date;
};

export type StakingData = {
  totalStaked: bigint;
  pendingUnstakes: bigint;
  activatedAttesterCount: bigint;
  pendingUnstakeCount: bigint;
  hasExitableUnstakes: boolean;
  stakingState: StakingState;
  providerConfig: ProviderConfig;
  keyQueueLength: bigint;
  lastUpdated: Date;
};

export type SafetyModuleData = {
  isPaused: boolean;
  depositCap: bigint;
  lastUpdated: Date;
};

export type WithdrawalQueueData = {
  nextRequestId: bigint;
  nextPendingId: bigint;
  totalPendingAssets: bigint;
  totalPendingShares: bigint;
  nextUnfinalized: bigint;
  lastUpdated: Date;
};

export type ContractAddresses = {
  core: string;
  vault: string;
  stAztec: string;
  stakingManager: string;
  rewardsAccumulator: string;
  safetyModule: string;
  withdrawalQueue: string;
  stakingProviderRegistry: string;
  asset: string;
};

export type EventData = {
  lastProcessedBlock: bigint;
  // Critical safety
  circuitBreakerTriggeredCount: number;
  circuitBreakerByReason: { rateDrop: number; queueRatio: number; accountingStale: number };
  negativeRewardsPeriodCount: number;
  safetyPausedCount: number;
  safetyUnpausedCount: number;
  // User flows
  depositCount: number;
  depositVolume: bigint;
  redeemRequestCount: number;
  redeemRequestVolume: bigint;
  instantRedemptionCount: number;
  instantRedemptionVolume: bigint;
  instantRedemptionFees: bigint;
  withdrawalClaimCount: number;
  withdrawalClaimVolume: bigint;
  // Operations
  rebalanceCount: number;
  accountingUpdateCount: number;
  rewardsHarvestedVolume: bigint;
  // Staking
  stakedCount: number;
  stakedVolume: bigint;
  unstakeInitiatedCount: number;
  unstakeInitiatedVolume: bigint;
  unstakeFinalizedCount: number;
  unstakeFinalizedVolume: bigint;
  // Other
  withdrawalAdjustedCount: number;
  configChangeCount: number;
  lastUpdated: Date;
};
