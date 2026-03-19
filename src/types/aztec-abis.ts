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
] as const;
