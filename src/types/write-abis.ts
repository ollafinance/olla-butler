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
] as const;

export const StakingManagerWriteAbi = [
  {
    type: "function",
    name: "refreshAttester",
    inputs: [{ name: "_attester", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
