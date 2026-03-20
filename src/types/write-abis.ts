/**
 * Write function ABIs for Olla protocol contracts.
 * Used by the TransactionExecutor for automated transaction creation and execution.
 */

export const OllaCoreWriteAbi = [
  {
    type: "function",
    name: "updateAccounting",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rebalance",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    name: "OllaCore__RebalanceInProgress",
    inputs: [],
  },
  {
    type: "error",
    name: "OllaCore__RebalanceCooldownActive",
    inputs: [
      { name: "elapsed", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "Rollup__RewardsNotClaimable",
    inputs: [],
  },
] as const;

export const StakingManagerWriteAbi = [
  {
    type: "function",
    name: "refreshAttesterState",
    inputs: [{ name: "attesters", type: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
