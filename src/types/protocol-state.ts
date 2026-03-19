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
  rollupRegistry: string;
  canonicalRollup: string;
};

export enum AztecAttesterStatus {
  NONE = 0,
  VALIDATING = 1,
  ZOMBIE = 2,
  EXITING = 3,
}

export const AztecAttesterStatusNames: Record<AztecAttesterStatus, string> = {
  [AztecAttesterStatus.NONE]: "None",
  [AztecAttesterStatus.VALIDATING]: "Validating",
  [AztecAttesterStatus.ZOMBIE]: "Zombie",
  [AztecAttesterStatus.EXITING]: "Exiting",
};

export type AttesterExitState = {
  exists: boolean;
  amount: bigint;
  exitableAt: bigint;
  isExitable: boolean;
};

export type AttesterState = {
  address: string;
  status: AztecAttesterStatus;
  effectiveBalance: bigint;
  exit: AttesterExitState;
};

export type AttesterStalenessReason =
  | "slashing"
  | "exit_undetected"
  | "exit_exitable"
  | "zombie"
  | "fully_exited";

export type StaleAttester = {
  address: string;
  reasons: AttesterStalenessReason[];
  slashingLoss: bigint;
};

export type AttesterData = {
  attesters: AttesterState[];
  rollupTotalEffectiveBalance: bigint;
  rollupActiveCount: number;
  rollupExitingCount: number;
  rollupZombieCount: number;
  activationThreshold: bigint;
  cachedVsRollupBalanceDrift: bigint;
  staleAttesters: StaleAttester[];
  exitableAttesterCount: number;
  lastUpdated: Date;
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
  // Attester refresh
  attesterRefreshCount: number;
  attesterRefreshBalanceChangeCount: number;
  // Withdrawal queue
  withdrawalRequestedCount: number;
  withdrawalRequestedVolume: bigint;
  withdrawalFinalizedCount: number;
  withdrawalFinalizedVolume: bigint;
  // Other
  withdrawalAdjustedCount: number;
  configChangeCount: number;
  lastUpdated: Date;
};
