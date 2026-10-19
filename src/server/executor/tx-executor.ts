/**
 * TransactionExecutor - Creates and sends on-chain transactions using a wallet client.
 * Provides methods for each automated transaction type with logging and error handling.
 */

import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createWalletClient,
  createPublicClient,
  getAddress,
  type Address,
  type WalletClient,
  type PublicClient,
  type Chain,
  type Account,
} from "viem";
import type { Counter } from "@opentelemetry/api";
import { privateKeyToAccount } from "viem/accounts";
import { createTransport, SUPPORTED_CHAINS } from "../../core/components/transport.js";
import { OllaCoreWriteAbi, StakingManagerWriteAbi, AztecRollupWriteAbi } from "../../types/write-abis.js";
import { OllaCoreAbi, OllaVaultAbi, StakingManagerAbi } from "../../types/olla-abis.js";
import { getMeter } from "../metrics/registry.js";
import { RebalanceStep, type ContractAddresses } from "../../types/index.js";

/**
 * Minimum gas limit for all transactions.
 * Prevents gas estimation from underestimating for functions that use hasGasLeft() checks.
 * The estimate is still used when it exceeds this floor.
 */
const GAS_FLOOR = 500_000n;
const REBALANCE_GAS_FLOOR = 750_000n;
const GAS_ESTIMATE_BUFFER_BP = 13_000n;
const BP_DENOMINATOR = 10_000n;
let rebalanceRejectionCounter: Counter | undefined;

function spendable(buffer: bigint, pending: bigint): bigint {
  return buffer > pending ? buffer - pending : 0n;
}

function postFinalizationSpendable(buffer: bigint, pending: bigint, finalized: bigint): bigint {
  const simulatedPending = pending > finalized ? pending - finalized : 0n;
  return spendable(buffer, simulatedPending);
}

/** At most four eth_call simulations, including the original policy limit. */
function rebalanceGasCandidates(estimate: bigint, preferred: bigint): bigint[] {
  const candidates = [preferred];
  // These are policy-derived limits, never scraped gas snapshots. Lower gas can change
  // hasGasLeft() branching, so neither gas nor economic progress is assumed monotonic.
  for (const [numerator, denominator] of [[1n, 1n], [3n, 4n], [1n, 2n]] as const) {
    const raw = estimate * numerator / denominator;
    const lower = raw > REBALANCE_GAS_FLOOR ? raw : REBALANCE_GAS_FLOOR;
    if (lower < preferred && !candidates.includes(lower)) candidates.push(lower);
  }
  return candidates;
}

type RebalanceOutcome = readonly [bigint, bigint, bigint, bigint];

function isRebalanceOutcome(value: unknown): value is RebalanceOutcome {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "bigint" && item >= 0n);
}

/**
 * viem's simulateContract wraps a node-recognized EVM revert in exactly this pair.
 * Keep the check deliberately narrow: walking arbitrary cause chains could mistake a
 * transport/RPC wrapper containing stale revert metadata for a deterministic result.
 */
function isDeterministicRebalanceRevert(
  error: unknown,
  coreAddr: Address,
  executorAddress: Address,
): error is ContractFunctionExecutionError {
  return error instanceof ContractFunctionExecutionError &&
    error.cause instanceof ContractFunctionRevertedError &&
    error.functionName === "rebalance" &&
    error.contractAddress === coreAddr &&
    error.sender === executorAddress;
}

/**
 * EIP-7825 transaction gas cap: 2^24 = 16,777,216 gas.
 * Enforced on Ethereum mainnet and Sepolia; local Foundry (31337) is intentionally uncapped.
 */
export const TX_GAS_CAP = 16_777_216n;

/** Chain IDs subject to the EIP-7825 gas cap. */
export const GAS_CAPPED_CHAIN_IDS: readonly number[] = [1, 11155111];

export function isGasCappedChain(chainId: number): boolean {
  return GAS_CAPPED_CHAIN_IDS.includes(chainId);
}

/**
 * Result of the pure gas-limit calculation. Operations apply in order:
 * ceiling-rounded buffer (when configured) -> max with floor -> min with chain cap.
 */
export interface GasLimitResult {
  /** Raw gas estimate returned by the RPC. */
  estimate: bigint;
  /** Estimate after the ceiling-rounded buffer (or the raw estimate when no buffer is configured). */
  buffered: bigint;
  /** Buffered estimate raised to the floor: max(buffered, floor). */
  floored: bigint;
  /** Whether the chain gas cap was applied. */
  capped: boolean;
  /** Chain gas cap when the chain is capped, otherwise undefined. */
  cap: bigint | undefined;
  /** Final gas limit sent with the transaction. */
  gas: bigint;
}

/**
 * Pure gas-limit calculation, isolated so exact behavior (floor, buffer, cap) can be tested
 * without a wallet client or RPC.
 *
 * @param estimate - Raw gas estimate from eth_estimateGas.
 * @param floor - Minimum gas limit (e.g. GAS_FLOOR or REBALANCE_GAS_FLOOR).
 * @param bufferBp - Optional ceiling-rounded buffer in basis points (e.g. 13,000bp = +30%).
 * @param chainId - Chain ID of the transaction; determines whether TX_GAS_CAP applies.
 */
export function calculateGasLimit(args: {
  estimate: bigint;
  floor: bigint;
  bufferBp?: bigint;
  chainId: number;
}): GasLimitResult {
  const { estimate, floor, bufferBp, chainId } = args;
  const buffered = bufferBp
    ? (estimate * bufferBp + BP_DENOMINATOR - 1n) / BP_DENOMINATOR
    : estimate;
  const floored = buffered > floor ? buffered : floor;
  const cap = isGasCappedChain(chainId) ? TX_GAS_CAP : undefined;
  let gas = floored;
  let capped = false;
  if (cap !== undefined && gas > cap) {
    gas = cap;
    capped = true;
  }
  return { estimate, buffered, floored, capped, cap, gas };
}

export interface TransactionExecutorConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  addresses: ContractAddresses;
}

export class TransactionExecutor {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly addresses: ContractAddresses;
  private readonly executorAddress: Address;
  private readonly chain: Chain;
  private readonly account: Account;

  constructor(config: TransactionExecutorConfig) {
    const chain = SUPPORTED_CHAINS.find((c) => c.id === config.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }
    this.chain = chain;

    const account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.account = account;
    this.executorAddress = account.address;

    const transport = createTransport(config.rpcUrl);

    this.walletClient = createWalletClient({
      account,
      chain,
      transport,
    });

    this.publicClient = createPublicClient({
      chain,
      transport,
    });

    this.addresses = config.addresses;
  }

  getExecutorAddress(): Address {
    return this.executorAddress;
  }

  /**
   * Returns the native (ETH) balance of the executor address.
   */
  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.executorAddress });
  }

  /**
   * Estimates gas for a contract call and returns the greater of the estimate or GAS_FLOOR.
   */
  private async estimateGasWithFloor(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    floor?: bigint;
    bufferBp?: bigint;
  }): Promise<{ estimate: bigint; gas: bigint }> {
    const { floor = GAS_FLOOR, bufferBp, ...contractArgs } = args;
    const estimate = await this.publicClient.estimateContractGas({
      account: this.account,
      ...contractArgs,
    });
    const { gas, capped, floored, cap } = calculateGasLimit({
      estimate,
      floor,
      ...(bufferBp !== undefined ? { bufferBp } : {}),
      chainId: this.chain.id,
    });
    if (capped) {
      console.log(
        `[TxExecutor] Gas limit clamped by EIP-7825 cap (chain ${this.chain.id}): ` +
          `selected ${floored} > cap ${cap}; using ${gas}`,
      );
    }
    return {
      estimate,
      gas,
    };
  }

  private getRevertGasHint(receiptGasUsed: bigint, gasLimit: bigint): string {
    if (receiptGasUsed * 100n >= gasLimit * 95n) {
      return ` | possible out-of-gas: gas used ${receiptGasUsed} / limit ${gasLimit}`;
    }
    return "";
  }

  private rejectRebalance(reason: string): never {
    console.error(`[TxExecutor] rebalance simulation safety gate: ${reason}; no transaction sent`);
    try {
      rebalanceRejectionCounter ??= getMeter().createCounter("olla-butler_rebalance_simulation_rejected_total", {
        description: "Rebalance attempts blocked before broadcast by the simulation safety gate",
      });
      rebalanceRejectionCounter.add(1);
    } catch (error) {
      // Safety must not depend on metrics startup order.
      console.error("[TxExecutor] Could not record rebalance rejection metric:", error);
    }
    throw new Error(`rebalance simulation safety gate: ${reason}; no transaction sent`);
  }

  private async readRebalanceContext(coreAddr: Address) {
    const [progress, buffer, pending] = await Promise.all([
      this.publicClient.readContract({ address: coreAddr, abi: OllaCoreAbi, functionName: "rebalanceProgress" }),
      this.publicClient.readContract({ address: getAddress(this.addresses.vault), abi: OllaVaultAbi, functionName: "bufferedAssets" }),
      this.publicClient.readContract({ address: getAddress(this.addresses.vault), abi: OllaVaultAbi, functionName: "pendingWithdrawalAssets" }),
    ]);
    const amount = progress.stakeRemaining > 0n ? progress.stakeRemaining : spendable(buffer, pending);
    const canStake = await this.canStake(amount);
    return { progress, buffer, pending, amount, canStake };
  }

  private async canStake(amount: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: getAddress(this.addresses.stakingManager),
      abi: StakingManagerAbi,
      functionName: "canStake",
      args: [amount],
    });
  }

  /**
   * Calls OllaCore.updateAccounting()
   */
  async updateAccounting(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending updateAccounting() to ${coreAddr}...`);

    const { gas } = await this.estimateGasWithFloor({
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "updateAccounting",
      args: [],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "updateAccounting",
      args: [],
      gas,
    });
    console.log(`[TxExecutor] updateAccounting tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] updateAccounting confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`updateAccounting() reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls OllaCore.rebalance()
   * Rebalance is a multi-step process. Returns the tx hash for one step.
   */
  async rebalance(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending rebalance() to ${coreAddr}...`);

    let estimate: bigint;
    let gas: bigint;
    try {
      ({ estimate, gas } = await this.estimateGasWithFloor({
        address: coreAddr,
        abi: OllaCoreWriteAbi,
        functionName: "rebalance",
        args: [],
        floor: REBALANCE_GAS_FLOOR,
        bufferBp: GAS_ESTIMATE_BUFFER_BP,
      }));
    } catch (error) {
      return this.rejectRebalance(`gas estimate RPC failed: ${String(error)}`);
    }
    console.log(`[TxExecutor] rebalance gas estimate: ${estimate} | gas limit: ${gas}`);

    let before: Awaited<ReturnType<TransactionExecutor["readRebalanceContext"]>>;
    try {
      before = await this.readRebalanceContext(coreAddr);
    } catch (error) {
      return this.rejectRebalance(`context RPC failed: ${String(error)}`);
    }

    let selected: { gas: bigint; outcome: RebalanceOutcome } | undefined;
    for (const candidate of rebalanceGasCandidates(estimate, gas)) {
      let result: unknown;
      try {
        const simulation = await this.publicClient.simulateContract({
          account: this.account,
          address: coreAddr,
          abi: OllaCoreWriteAbi,
          functionName: "rebalance",
          args: [],
          gas: candidate,
        });
        result = simulation.result;
      } catch (error) {
        if (isDeterministicRebalanceRevert(error, coreAddr, this.executorAddress)) {
          console.warn(
            `[TxExecutor] Rejecting rebalance candidate at gas ${candidate}: ` +
            `deterministic contract execution revert (${error.cause.shortMessage})`,
          );
          continue;
        }
        return this.rejectRebalance(`simulation RPC failed at gas ${candidate}: ${String(error)}`);
      }
      if (!isRebalanceOutcome(result)) {
        return this.rejectRebalance(`invalid rebalance return tuple at gas ${candidate}`);
      }
      const [rewardsDelta, finalizedAmount, stakedAmount, resultingBuffer] = result;
      console.log(
        `[TxExecutor] rebalance simulation gas=${candidate}: rewards=${rewardsDelta} ` +
        `finalized=${finalizedAmount} staked=${stakedAmount} buffer=${resultingBuffer}`,
      );
      // A resulting buffer is only a balance, not proof of progress. For rewards
      // or finalization alone, check whether staking remains possible afterwards.
      let stakeStillActionable = false;
      if (stakedAmount === 0n && (rewardsDelta > 0n || finalizedAmount > 0n)) {
        try {
          stakeStillActionable = await this.canStake(
            postFinalizationSpendable(resultingBuffer, before.pending, finalizedAmount),
          );
        } catch (error) {
          return this.rejectRebalance(`canStake RPC failed at gas ${candidate}: ${String(error)}`);
        }
      }

      // StakeSurplus completion: when remaining staking work is exhausted — i.e. canStake(effective
      // amount) is false, covering dust/no keys and a zero spendable amount — the contract clears
      // remaining and advances to Done before the gas-gated staking branch, returning an all-zero
      // economic tuple. That all-zero output is a real completion, not a lack of work — permit it.
      // readRebalanceContext already sets `amount` to stored stakeRemaining when nonzero, otherwise
      // the net spendable buffer, and `before.canStake` tests that effective amount. Stored zero alone
      // is NOT sufficient: OllaCore recomputes freshStakeRemaining from the buffer and, if actionable,
      // the call must stake, so an all-zero outcome there is false progress.
      // Scoped to StakeSurplus: earlier states can return all-zero at gas gates without completing,
      // and Done can be a fresh cycle, so all-zero there stays rejected unless economic progress
      // is returned.
      const stakeSurplusCompletion =
        before.progress.step === RebalanceStep.StakeSurplus &&
        stakedAmount === 0n &&
        rewardsDelta === 0n &&
        finalizedAmount === 0n &&
        before.canStake === false;

      if (
        stakedAmount > 0n ||
        ((rewardsDelta > 0n || finalizedAmount > 0n) && !stakeStillActionable) ||
        stakeSurplusCompletion
      ) {
        selected = { gas: candidate, outcome: result };
        break;
      }
      console.warn(
        `[TxExecutor] Rejecting nonproductive rebalance at gas ${candidate} ` +
        `(step=${before.progress.step}, stakeRemaining=${before.progress.stakeRemaining}, ` +
        `canStake=${before.canStake}, stakeStillActionable=${stakeStillActionable})`,
      );
    }
    if (!selected) return this.rejectRebalance("no semantically productive gas candidate");

    let after: typeof before;
    try {
      after = await this.readRebalanceContext(coreAddr);
    } catch (error) {
      return this.rejectRebalance(`post-simulation context RPC failed: ${String(error)}`);
    }
    if (before.progress.step !== after.progress.step ||
        before.progress.stakeRemaining !== after.progress.stakeRemaining ||
        before.progress.unstakeRemaining !== after.progress.unstakeRemaining ||
        before.buffer !== after.buffer || before.pending !== after.pending ||
        before.amount !== after.amount || before.canStake !== after.canStake) {
      return this.rejectRebalance("RPC context changed during simulation (state disagreement)");
    }
    const stakeSurplusCompletion =
      before.progress.step === RebalanceStep.StakeSurplus &&
      selected.outcome[0] === 0n &&
      selected.outcome[1] === 0n &&
      selected.outcome[2] === 0n &&
      before.canStake === false;

    // StakeSurplus completion is safe by contract semantics (remaining work not actionable), so a
    // post-simulation canStake on the spendable buffer is not the contract's decision criterion and
    // must not falsely reject it. Every other all-zero outcome still fails closed here.
    if (selected.outcome[2] === 0n && !stakeSurplusCompletion) {
      let canStakeAfter: boolean;
      try {
        canStakeAfter = await this.canStake(
          postFinalizationSpendable(selected.outcome[3], after.pending, selected.outcome[1]),
        );
      } catch (error) {
        return this.rejectRebalance(`post-simulation canStake RPC failed: ${String(error)}`);
      }
      if (canStakeAfter) return this.rejectRebalance("post-simulation canStake disagrees with selected outcome");
    }
    console.log(`[TxExecutor] Selected rebalance gas ${selected.gas} with simulated outcome ${selected.outcome.join(",")}`);

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      args: [],
      gas: selected.gas,
    });
    console.log(`[TxExecutor] rebalance tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] rebalance confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(
        `rebalance() reverted in block ${receipt.blockNumber} (tx: ${hash})` +
          this.getRevertGasHint(receipt.gasUsed, selected.gas),
      );
    }

    return hash;
  }

  /**
   * Calls StakingManager.purgeFailedQueueEntry(address)
   * Removes an attester whose deposit failed during the rollup's entry queue flush.
   */
  async purgeFailedQueueEntry(attesterAddress: string): Promise<string> {
    const stakingAddr = getAddress(this.addresses.stakingManager);
    const addr = getAddress(attesterAddress);
    console.log(`[TxExecutor] Sending purgeFailedQueueEntry(${addr}) to ${stakingAddr}...`);

    const { gas } = await this.estimateGasWithFloor({
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "purgeFailedQueueEntry",
      args: [addr],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "purgeFailedQueueEntry",
      args: [addr],
      gas,
    });
    console.log(`[TxExecutor] purgeFailedQueueEntry tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] purgeFailedQueueEntry(${addr}) confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`purgeFailedQueueEntry(${addr}) reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls StakingManager.refreshAttesterState(address[])
   * Accepts one or more attester addresses to refresh in a single tx.
   */
  async refreshAttesters(attesterAddresses: string[]): Promise<string> {
    const stakingAddr = getAddress(this.addresses.stakingManager);
    const addrs = attesterAddresses.map((a) => getAddress(a));
    console.log(`[TxExecutor] Sending refreshAttesterState([${addrs.join(", ")}]) to ${stakingAddr}...`);

    const { gas } = await this.estimateGasWithFloor({
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "refreshAttesterState",
      args: [addrs],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "refreshAttesterState",
      args: [addrs],
      gas,
    });
    console.log(`[TxExecutor] refreshAttesterState tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] refreshAttesterState([${addrs.join(", ")}]) confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`refreshAttesterState([${addrs.join(", ")}]) reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls Rollup.flushEntryQueue() on the canonical rollup contract.
   * Processes pending attesters from the entry queue into the active set.
   */
  async flushEntryQueue(): Promise<string> {
    const rollupAddr = getAddress(this.addresses.canonicalRollup);
    console.log(`[TxExecutor] Sending flushEntryQueue() to ${rollupAddr}...`);

    const { gas } = await this.estimateGasWithFloor({
      address: rollupAddr,
      abi: AztecRollupWriteAbi,
      functionName: "flushEntryQueue",
      args: [],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: rollupAddr,
      abi: AztecRollupWriteAbi,
      functionName: "flushEntryQueue",
      args: [],
      gas,
    });
    console.log(`[TxExecutor] flushEntryQueue tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] flushEntryQueue confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`flushEntryQueue() reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }
}
