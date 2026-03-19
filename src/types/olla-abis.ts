/**
 * Minimal ABIs for Olla protocol contracts.
 * Only includes view functions needed for scraping.
 */

export const OllaCoreAbi = [
  { type: "function", name: "totalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "exchangeRate", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "protocolFeeBP", inputs: [], outputs: [{ type: "uint16" }], stateMutability: "view" },
  { type: "function", name: "treasuryFeeSplitBP", inputs: [], outputs: [{ type: "uint16" }], stateMutability: "view" },
  { type: "function", name: "targetBufferedAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "rebalanceCooldown", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "rebalanceGasThreshold", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "vault", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "stAztec", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "stakingManager", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "rewardsAccumulator", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "safetyModule", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "accountingState",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "stakedPrincipal", type: "uint256" },
          { name: "rewardsAccumulatorBalance", type: "uint256" },
          { name: "claimableRewards", type: "uint256" },
          { name: "rewardsDelta", type: "uint256" },
          { name: "slashingDelta", type: "uint256" },
          { name: "cumulativeRewards", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "latestReport",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalAssets", type: "uint256" },
          { name: "exchangeRate", type: "uint256" },
          { name: "grossRewards", type: "uint256" },
          { name: "netFlows", type: "int256" },
          { name: "rewardsSnapshot", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rebalanceProgress",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "step", type: "uint8" },
          { name: "stakeRemaining", type: "uint256" },
          { name: "unstakeRemaining", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "flowCounters",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "cumulativeDeposits", type: "uint256" },
          { name: "cumulativeWithdrawals", type: "uint256" },
          { name: "latestReportCumulativeDeposits", type: "uint256" },
          { name: "latestReportCumulativeWithdrawals", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const OllaVaultAbi = [
  { type: "function", name: "bufferedAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "pendingWithdrawalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "pendingWithdrawalShares", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "cumulativeDeposits", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "cumulativeWithdrawals", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "instantRedemptionFeeBP", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "availableForInstantRedemption", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "withdrawalQueue", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "core", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "share", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export const StakingManagerAbi = [
  { type: "function", name: "totalStaked", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "pendingUnstakes", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getActivatedAttesterCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getPendingUnstakeCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "hasExitableUnstakes", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "core", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "stakingProviderRegistry", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "rollupRegistry", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "getStakingState",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "slashingDelta", type: "uint256" },
          { name: "stakedAmount", type: "uint256" },
          { name: "pendingUnstakeAmount", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getProviderConfig",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "admin", type: "address" },
          { name: "rewardsRecipient", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const StakingProviderRegistryAbi = [
  { type: "function", name: "getQueueLength", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "getStakingProviderConfig",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "admin", type: "address" },
          { name: "rewardsRecipient", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "stakingManager", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export const SafetyModuleAbi = [
  { type: "function", name: "isPaused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "depositCap", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "CORE", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "VAULT", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export const WithdrawalQueueAbi = [
  { type: "function", name: "nextRequestId", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "nextPendingId", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "totalPendingAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalPendingShares", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "nextUnfinalized", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "gasThreshold", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "vault", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export const ERC20Abi = [
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;
