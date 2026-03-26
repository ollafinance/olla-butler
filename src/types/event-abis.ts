/**
 * Event ABIs for Olla protocol contracts.
 * Used by the EventWatcher to monitor on-chain events in near-realtime.
 */

export const OllaCoreEventAbi = [
  {
    type: "event",
    name: "ProtocolFeeUpdated",
    inputs: [
      { name: "oldFeeBP", type: "uint256", indexed: false },
      { name: "newFeeBP", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TreasuryFeeSplitUpdated",
    inputs: [
      { name: "oldSplitBP", type: "uint256", indexed: false },
      { name: "newSplitBP", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TargetBufferedAssetsUpdated",
    inputs: [
      { name: "oldBuffer", type: "uint256", indexed: false },
      { name: "newBuffer", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RebalanceGasThresholdUpdated",
    inputs: [
      { name: "oldThreshold", type: "uint256", indexed: false },
      { name: "newThreshold", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SafetyModuleUpdated",
    inputs: [
      { name: "oldSafetyModule", type: "address", indexed: false },
      { name: "newSafetyModule", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OllaProtocolFeesPaid",
    inputs: [
      { name: "protocolFeeAssets", type: "uint256", indexed: false },
      { name: "treasuryShares", type: "uint256", indexed: false },
      { name: "providerShares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AccountingUpdated",
    inputs: [
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "exchangeRate", type: "uint256", indexed: false },
      { name: "grossRewards", type: "uint256", indexed: false },
      { name: "netFlows", type: "int256", indexed: false },
      { name: "protocolFeeAssets", type: "uint256", indexed: false },
      { name: "treasuryShares", type: "uint256", indexed: false },
      { name: "providerShares", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AttestersStateRead",
    inputs: [
      { name: "rewardsDelta", type: "uint256", indexed: false },
      { name: "slashingDelta", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Rebalanced",
    inputs: [
      { name: "rewardsDelta", type: "uint256", indexed: false },
      { name: "finalizedAmount", type: "uint256", indexed: false },
      { name: "stakedAmount", type: "uint256", indexed: false },
      { name: "resultingBuffer", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnstakedFundsClaimed",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "RewardsAccumulatorFundsPulled",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "WithdrawalFinalized",
    inputs: [
      { name: "available", type: "uint256", indexed: false },
      { name: "finalized", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnstakeInitiated",
    inputs: [
      { name: "requested", type: "uint256", indexed: false },
      { name: "initiated", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "NegativeRewardsPeriod",
    inputs: [{ name: "grossRewardsSigned", type: "int256", indexed: false }],
  },
  {
    type: "event",
    name: "RewardsDelta",
    inputs: [{ name: "delta", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "RebalanceReset",
    inputs: [],
  },
  {
    type: "event",
    name: "RebalanceCooldownUpdated",
    inputs: [
      { name: "oldCooldown", type: "uint256", indexed: true },
      { name: "newCooldown", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "VaultSet",
    inputs: [{ name: "vault", type: "address", indexed: true }],
  },
] as const;

export const OllaVaultEventAbi = [
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalClaimed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalFinalized",
    inputs: [
      { name: "available", type: "uint256", indexed: false },
      { name: "used", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InstantRedemption",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "grossAssets", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "netAssets", type: "uint256", indexed: false },
      { name: "exchangeRate", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InstantRedemptionFeeUpdated",
    inputs: [
      { name: "oldFeeBP", type: "uint256", indexed: false },
      { name: "newFeeBP", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedeemRequest",
    inputs: [
      { name: "controller", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BufferedAssetsReconciled",
    inputs: [
      { name: "delta", type: "uint256", indexed: false },
      { name: "newBufferedAssets", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "StAztecRecovered",
    inputs: [
      { name: "amount", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AssetsTransferredToStaking",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "UnstakedAssetsReceived",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "FeesMinted",
    inputs: [
      { name: "treasuryShares", type: "uint256", indexed: false },
      { name: "providerShares", type: "uint256", indexed: false },
    ],
  },
] as const;

export const SafetyModuleEventAbi = [
  {
    type: "event",
    name: "Paused",
    inputs: [],
  },
  {
    type: "event",
    name: "Unpaused",
    inputs: [],
  },
  {
    type: "event",
    name: "DepositCapUpdated",
    inputs: [{ name: "cap", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "WithdrawalMinimumUpdated",
    inputs: [{ name: "minimumShares", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "CircuitBreakerTriggered",
    inputs: [{ name: "reason", type: "uint8", indexed: false }],
  },
  {
    type: "event",
    name: "RateDropLimitUpdated",
    inputs: [{ name: "minRateDropBps", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "QueueRatioLimitUpdated",
    inputs: [{ name: "maxQueueRatioBps", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "AccountingDelayUpdated",
    inputs: [{ name: "maxAccountingDelay", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "AccountingTimestampUpdated",
    inputs: [{ name: "latestAccountingTimestamp", type: "uint256", indexed: false }],
  },
] as const;

export const StakingManagerEventAbi = [
  {
    type: "event",
    name: "StakedWithProvider",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "UnstakeInitiated",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "UnstakeFinalized",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "UnstakedFundsClaimed",
    inputs: [{ name: "amount", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "RewardsHarvested",
    inputs: [{ name: "amount", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "AttesterRemoved",
    inputs: [{ name: "attester", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "AttesterStateRefreshed",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "oldBalance", type: "uint256", indexed: true },
      { name: "newBalance", type: "uint256", indexed: true },
    ],
  },
] as const;

export const WithdrawalQueueEventAbi = [
  {
    type: "event",
    name: "WithdrawalRequested",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "assetsExpected", type: "uint256", indexed: false },
      { name: "rate", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalFinalized",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalClaimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "assetsExpected", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalAdjusted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "originalAmount", type: "uint256", indexed: false },
      { name: "adjustedAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GasThresholdUpdated",
    inputs: [
      { name: "oldThreshold", type: "uint256", indexed: false },
      { name: "newThreshold", type: "uint256", indexed: false },
    ],
  },
] as const;

export const RewardsAccumulatorEventAbi = [
  {
    type: "event",
    name: "RewardsRecorded",
    inputs: [{ name: "delta", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "RewardsWithdrawn",
    inputs: [{ name: "amount", type: "uint256", indexed: true }],
  },
] as const;

/**
 * ERC-1967 Upgraded event — emitted by all UUPS upgradeable Olla contracts
 * when their implementation is changed.
 */
export const ERC1967UpgradedEventAbi = [
  {
    type: "event",
    name: "Upgraded",
    inputs: [{ name: "implementation", type: "address", indexed: true }],
  },
] as const;
