/**
 * Minimal ABIs for Aztec rollup contracts.
 * Only includes view functions needed for attester state monitoring.
 */

export const AztecRollupRegistryAbi = [
  {
    type: "function",
    name: "getCanonicalRollup",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "numberOfVersions",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getVersion",
    inputs: [{ name: "_index", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRollup",
    inputs: [{ name: "_version", type: "uint256" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

export const AztecRollupAbi = [
  {
    type: "function",
    name: "getAttesterView",
    inputs: [{ name: "_attester", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "effectiveBalance", type: "uint256" },
          {
            name: "exit",
            type: "tuple",
            components: [
              { name: "withdrawalId", type: "uint256" },
              { name: "amount", type: "uint256" },
              { name: "exitableAt", type: "uint256" },
              { name: "recipientOrWithdrawer", type: "address" },
              { name: "isRecipient", type: "bool" },
              { name: "exists", type: "bool" },
            ],
          },
          {
            name: "config",
            type: "tuple",
            components: [
              {
                name: "publicKey",
                type: "tuple",
                components: [
                  { name: "x", type: "uint256" },
                  { name: "y", type: "uint256" },
                ],
              },
              { name: "withdrawer", type: "address" },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getActivationThreshold",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCurrentEpoch",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getNextFlushableEpoch",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getActiveAttesterCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * Events emitted by the Aztec rollup contract for the validator/attester
 * lifecycle (sourced from IStakingCore.sol in aztec-packages/l1-contracts).
 * The Rollup contract inherits IStaking and emits these via StakingLib.
 *
 * Used by RollupEventListener to subscribe via WebSocket and trigger an
 * AttesterScraper refresh on any lifecycle change without polling.
 */
export const AztecRollupEventAbi = [
  {
    type: "event",
    name: "ValidatorQueued",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "withdrawer", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "withdrawer", type: "address", indexed: true },
      {
        name: "publicKeyInG1",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
      {
        name: "publicKeyInG2",
        type: "tuple",
        components: [
          { name: "x0", type: "uint256" },
          { name: "x1", type: "uint256" },
          { name: "y0", type: "uint256" },
          { name: "y1", type: "uint256" },
        ],
      },
      {
        name: "proofOfPossession",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
      { name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FailedDeposit",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "withdrawer", type: "address", indexed: true },
      {
        name: "publicKeyInG1",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
      {
        name: "publicKeyInG2",
        type: "tuple",
        components: [
          { name: "x0", type: "uint256" },
          { name: "x1", type: "uint256" },
          { name: "y0", type: "uint256" },
          { name: "y1", type: "uint256" },
        ],
      },
      {
        name: "proofOfPossession",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WithdrawInitiated",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WithdrawFinalized",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Slashed",
    inputs: [
      { name: "attester", type: "address", indexed: true },
      { name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
] as const;
