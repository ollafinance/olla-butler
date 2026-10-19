# Decisions

## Rebalance candidate reverts — narrow continuation boundary (t_a8b5ecc9)

### Decision

An exact-gas `rebalance()` simulation may reject only that candidate and continue the existing bounded
search when viem reports its canonical, direct error shape: a `ContractFunctionExecutionError` whose
immediate cause is `ContractFunctionRevertedError`, with matching `rebalance` function, OllaCore address,
and executor sender. This is the installed viem 2.47.0 `simulateContract`/`getContractError` representation
of a node-recognized EVM contract execution revert.

The check intentionally does not inspect message text or recursively walk `cause` chains. A transport,
timeout, network/RPC uncertainty, unknown error, malformed return, mismatched call metadata, or an
intermediary/ambiguous wrapper still aborts the whole operation immediately with no broadcast. A nested
revert somewhere inside an otherwise unrecognized wrapper is not proof that the exact simulation reached
a deterministic EVM result.

Each accepted deterministic revert is logged against its policy-derived gas candidate and consumes one of
the existing maximum four simulations. If every candidate reverts, selection ends as safely nonproductive
and sends nothing. If a later candidate returns a semantically productive result, all existing context
consistency and staking checks still run before the sole permitted send, using the same signer and exact
selected gas. The gas cap, safe non-actionable `StakeSurplus` completion, and all no-send failure paths are
unchanged.

Regression coverage includes one revert followed by one productive candidate, all candidates reverting,
and immediate no-send aborts for transport, timeout, malformed, unrecognized, and ambiguous wrapped errors.

## Rebalance semantic gate — safe StakeSurplus completion (t_af5cbd80)

### Problem

The rebalance simulation safety gate in `src/server/executor/tx-executor.ts` rejected every all-zero
economic tuple `(rewardsDelta=0, finalizedAmount=0, stakedAmount=0, resultingBuffer)`. That is correct
for earlier rebalance steps (which can return all-zero at gas gates without completing) and for a fresh
`Done` cycle, but it is wrong for `StakeSurplus`.

Per OllaCore semantics, in `StakeSurplus` the contract recomputes fresh stake remaining; if it is zero
**or** `StakingManager.canStake(stakeRemaining) == false` (dust or no keys), it clears remaining and
advances to `Done` **before** the gas-gated staking branch, returning an all-zero tuple. The transaction
succeeds and progress advances `StakeSurplus -> Done`. The gate treated that demonstrably safe completion
as nonproductive and rejected it, causing a liveness regression: rebalance stuck in `StakeSurplus` with
dust/no-key residual work that can never be staked.

### Fix

Permit an all-zero outcome as productive only when all of the following hold:

- pre-state step is `StakeSurplus`;
- `stakedAmount === 0 && rewardsDelta === 0 && finalizedAmount === 0`;
- remaining work not actionable: `before.canStake === false`.

`before.canStake` tests `readRebalanceContext`'s effective amount, which is stored `stakeRemaining`
when nonzero and otherwise the net spendable buffer. This correctly covers effective zero, dust, and
no keys. Stored `stakeRemaining === 0` alone is intentionally NOT sufficient: OllaCore recomputes
freshStakeRemaining from the buffer, and if that fresh amount is actionable the call must stake, so
an all-zero outcome there is false progress and must be rejected.

Everything else stays rejected:
- earlier states returning all-zero at gas gates are not treated as completion;
- `Done` as a fresh cycle is not inferred from zeros;
- actionable zero-stake false-Done (e.g. `canStake(stakeRemaining) == true` with all-zero output) is
  still rejected ("no semantically productive gas candidate");
- RPC errors/invalid tuples fail closed; context stability is still checked before the single send;
- <= 4 exact-gas signer simulations, <= 1 write/send, and the EIP-7825 gas cap are preserved.

The post-simulation `canStakeAfter` disagreement check is skipped for a `StakeSurplus` completion because
the contract's decision criterion is `canStake(effective amount)` (`before.canStake`), already verified
false pre-simulation and confirmed unchanged by the context-stability check; measuring `canStake` on the
spendable buffer there is not the contract's criterion and could falsely reject dust/no-key completion.

### Tests

`src/server/executor/__tests__/tx-executor-rebalance.test.ts` covers:

- dust completion: `StakeSurplus`, `stakeRemaining` dust, `canStake` false, all-zero -> one simulation,
  one send, completes.
- no-key completion: `canStake` always false -> all-zero treated as completion.
- actionable zero-stake false-Done rejection: all-zero with `canStake(stakeRemaining) == true` rejected,
  no broadcast (pre-existing test).
- productive partial selection: `stakedAmount > 0` accepted (pre-existing test).
- productive finalization: withdrawal finalization with non-actionable buffer accepted (pre-existing test).

### What was not touched

Olla Core, any other repo, deployment, configuration, or credentials. No fork evidence fabricated.
